/**
 * Sliding-window context truncation.
 *
 * When a request's messages exceed the provider's context limit, we trim
 * older messages from the middle of the conversation — keeping the system
 * prompt (first message) and the most recent messages (the active context).
 *
 * This is the same strategy every LLM client uses (Cursor, Claude Code, etc.)
 * when conversation history grows too long.
 */

import { ChatMessage } from "./types";
import { log } from "./logger";

/**
 * Extract all text content from a message's `content` field, whether it's
 * a plain string or an array of content blocks (OpenAI vision/multipart format).
 *
 * Cursor routinely sends content as:
 *   "content": [{"type":"text","text":"..."},{"type":"text","text":"..."}]
 * If we only check `typeof content === "string"` we silently miss ALL the text,
 * causing massive underestimation and no truncation.
 */
function extractContentText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
      } else if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (typeof b.text === "string") parts.push(b.text);
        // Also stringify image_url, tool_result blocks, etc.
        if (typeof b.type === "string" && b.type !== "text") {
          parts.push(JSON.stringify(b));
        }
      }
    }
    return parts.join("\n");
  }
  // Fallback: stringify objects
  if (typeof content === "object") return JSON.stringify(content);
  return String(content);
}

/** Provider context limits (in tokens). */
const PROVIDER_CONTEXT_LIMITS: Record<string, number> = {
  kimi: 262144,
  "kimi-k2.7-code": 262144,
  deepseek: 65536,
  "deepseek-chat": 65536,
  "deepseek-v4-flash": 65536,
  xiaomi: 32768,
  "mimo-v2.5-pro": 32768,
  glm: 128000,
  "glm-5.2": 128000,
  "glm-5.1": 128000,
  "glm-5": 128000,
  "glm-4-flash": 128000,
  openai: 128000,
  "gpt-4o": 128000,
  anthropic: 200000,
};

/** Tokens reserved for the model's response (output budget). */
const OUTPUT_RESERVE_TOKENS = 16384;

/** Safety margin multiplier — our estimate must be this much UNDER the limit
 * to account for tokenizer differences, JSON serialization overhead, etc.
 * Set to 0.90 so we target 90% of the provider limit at most. */
const SAFETY_MARGIN = 0.90;

/**
 * Estimate token count for a message using char-based approximation.
 * Average English/code: ~4 chars per token. But JSON/structured content
 * (which Cursor sends a LOT of) tokenizes less efficiently — each bracket,
 * quote, and key name is a separate token.
 *
 * Empirically calibrated against Kimi's actual token counts:
 * Our raw payload was 2MB, we estimated 253K tokens, Kimi counted 337K.
 * Ratio: 1.33x underestimate. So we use 2.85 chars/token (very conservative)
 * to ensure we truncate early enough rather than getting a 400.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // 1 token ≈ 2.85 chars for mixed JSON/code/prose content (conservative)
  return Math.ceil(text.length / 2.85);
}

/**
 * Estimate total tokens for an entire message list.
 * Counts content + tool_calls + reasoning_content for each message.
 */
/**
 * Estimate token count for a payload's `tools` (function definitions).
 * Cursor sends large JSON schemas here — often 50-80K tokens worth.
 * These are counted by the provider toward the context limit but are NOT
 * part of `messages`. Must be added separately.
 */
export function estimateToolsTokens(tools: unknown): number {
  if (!tools) return 0;
  if (!Array.isArray(tools)) return 0;
  let total = 0;
  for (const tool of tools) {
    // Each tool definition is a JSON object with type, function, parameters schema
    total += estimateTokens(JSON.stringify(tool));
    total += 8; // overhead per tool definition
  }
  return total;
}

export function estimateMessageTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    // Per-message overhead: more tokens than raw text due to role tags, delimiters
    total += 4;

    // Use extractContentText to handle both string and array content
    total += estimateTokens(extractContentText(msg.content));

    if (msg.reasoning_content && typeof msg.reasoning_content === "string") {
      total += estimateTokens(msg.reasoning_content);
    }

    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        const fnText = tc.function?.name + tc.function?.arguments;
        total += estimateTokens(fnText) + 8; // tool call overhead
      }
    }
    if (msg.tool_call_id) {
      total += 3;
    }
  }
  return total;
}

/**
 * Get the context limit for a given model/provider.
 * Falls back to a conservative default if unknown.
 */
export function getContextLimit(model: string): number {
  // Check exact model match first
  if (PROVIDER_CONTEXT_LIMITS[model]) {
    return PROVIDER_CONTEXT_LIMITS[model];
  }
  // Check by prefix
  for (const [key, limit] of Object.entries(PROVIDER_CONTEXT_LIMITS)) {
    if (model.startsWith(key) || key.startsWith(model.split("-")[0])) {
      return limit;
    }
  }
  // Conservative default
  return 65536;
}

/**
 * Result of a truncation operation.
 */
export interface TruncationResult {
  messages: ChatMessage[];
  truncated: boolean;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  messagesRemoved: number;
  strategy: string;
}

/**
 * Truncate messages to fit within a context limit using sliding window.
 *
 * Strategy:
 * 1. Keep the system prompt(s) at the start (always — they contain instructions)
 * 2. Keep the last N messages (the active conversation context)
 * 3. Remove messages from the middle (oldest non-system messages first)
 * 4. If still over limit, truncate the largest individual messages
 *
 * @param messages Original message list
 * @param model Model name (to determine context limit)
 * @param options Optional overrides: knownTokenCount from headroom, tools array
 * @returns TruncationResult with possibly trimmed messages
 */
export function truncateToContextLimit(
  messages: ChatMessage[],
  model: string,
  options?: {
    knownTokenCount?: number; // From headroom's precise tokenizer
    tools?: unknown;          // payload.tools (function definitions)
  }
): TruncationResult {
  const contextLimit = getContextLimit(model);
  const maxInputTokens = Math.floor((contextLimit - OUTPUT_RESERVE_TOKENS) * SAFETY_MARGIN);

  // Use headroom's precise token count if available; otherwise estimate
  // and add tool definition tokens (which providers count toward limit).
  let tokensBefore: number;
  if (options?.knownTokenCount && options.knownTokenCount > 0) {
    // Headroom counted message tokens with real tokenizer. But it does NOT
    // count payload.tools. Add our estimate for tools.
    const toolTokens = estimateToolsTokens(options.tools);
    tokensBefore = options.knownTokenCount + toolTokens;
  } else {
    const msgTokens = estimateMessageTokens(messages);
    const toolTokens = estimateToolsTokens(options?.tools);
    tokensBefore = msgTokens + toolTokens;
  }

  // No truncation needed
  if (tokensBefore <= maxInputTokens) {
    return {
      messages,
      truncated: false,
      tokensBefore,
      tokensAfter: tokensBefore,
      tokensSaved: 0,
      messagesRemoved: 0,
      strategy: "none",
    };
  }

  // We also need to account for tools tokens eating into the budget
  const fixedToolTokens = estimateToolsTokens(options?.tools);
  const maxInputTokensForMessages = maxInputTokens - fixedToolTokens;

  log(
    "warn",
    `Context truncation: ${tokensBefore} tokens > ${maxInputTokens} limit for ${model}${fixedToolTokens > 0 ? ` (incl. ${fixedToolTokens} tool def tokens)` : ""}, truncating...`
  );

  // Step 1: Separate system prompts from conversation
  const systemMsgs: ChatMessage[] = [];
  const conversationMsgs: ChatMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "system" && i < 5) {
      // Keep only early system messages as "system" (first 5)
      systemMsgs.push(messages[i]);
    } else {
      conversationMsgs.push(messages[i]);
    }
  }

  const systemTokens = estimateMessageTokens(systemMsgs);
  const budgetForConversation = maxInputTokensForMessages - systemTokens;

  // Step 2: Work backwards from the most recent message, adding until we hit budget
  const keptConversation: ChatMessage[] = [];
  let keptTokens = 0;

  for (let i = conversationMsgs.length - 1; i >= 0; i--) {
    const msg = conversationMsgs[i];
    const msgTokens = estimateMessageTokens([msg]);

    if (keptTokens + msgTokens > budgetForConversation) {
      // This message would overflow — stop here
      break;
    }

    keptConversation.unshift(msg);
    keptTokens += msgTokens;
  }

  // Step 3: If we couldn't keep ANY conversation messages (system prompt alone is too big),
  // truncate the system message itself — but never destroy it completely.
  // The old code would sometimes reduce the system prompt to 0 chars, leaving
  // the model with just "[context truncated...]" — effectively useless.
  if (keptConversation.length === 0 && systemMsgs.length > 0) {
    // Emergency: truncate the largest system message, but keep at least 2K chars
    // so the model still has meaningful instructions to follow.
    const MIN_SYS_CHARS = 2048;
    const sysMsgIdx = systemMsgs.findIndex(m => {
      const text = extractContentText(m.content);
      return text.length > 100;
    });
    if (sysMsgIdx >= 0) {
      const sysContent = extractContentText(systemMsgs[sysMsgIdx].content);
      // Target: leave at least MIN_SYS_CHARS, but try to fit as much as budget allows
      const availableBudget = Math.max(maxInputTokensForMessages, 1000) - 200;
      const targetChars = Math.max(MIN_SYS_CHARS, Math.floor(availableBudget * 2.85));
      const maxSysChars = Math.min(sysContent.length, targetChars);

      if (sysContent.length > maxSysChars) {
        systemMsgs[sysMsgIdx] = {
          ...systemMsgs[sysMsgIdx],
          content:
            sysContent.slice(0, maxSysChars) +
            "\n\n[... earlier context truncated to fit ...]",
        };
        log("warn", `Emergency system prompt truncation: ${sysContent.length} → ${maxSysChars} chars`);
      }
    }
  }

  // Step 4: Check if the last message was a tool_call — if so, we may need to
  // also keep the preceding assistant message that initiated the tool call
  // (otherwise providers reject the request with "tool message without preceding tool_call")
  const finalMessages = [...systemMsgs, ...keptConversation];
  fixToolCallPairs(finalMessages);

  const messagesRemoved = messages.length - finalMessages.length;
  const tokensAfter = estimateMessageTokens(finalMessages);
  const tokensSaved = tokensBefore - tokensAfter;

  if (tokensSaved > 0) {
    const pct = ((tokensSaved / tokensBefore) * 100).toFixed(1);
    log(
      "ok",
      `Context truncated: ${tokensBefore} → ${tokensAfter} tokens (saved ${tokensSaved}, ${pct}%; removed ${messagesRemoved} msgs) for ${model}`
    );
  } else {
    log("warn", `Context truncation FAILED to reduce tokens: ${tokensBefore} → ${tokensAfter}`);
  }

  return {
    messages: finalMessages,
    truncated: true,
    tokensBefore,
    tokensAfter,
    tokensSaved,
    messagesRemoved,
    strategy: "sliding_window",
  };
}

/**
 * Fix orphaned tool messages: if a tool message is at the start (or after a
 * gap), prepend its corresponding assistant tool_call message or remove it.
 * OpenAI/Kimi require: assistant(tool_calls) → tool(tool_call_id) pairing.
 */
function fixToolCallPairs(messages: ChatMessage[]): void {
  // Build set of tool_call_ids that have a preceding assistant message
  const validToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        validToolCallIds.add(tc.id);
      }
    }
  }

  // Remove tool messages whose tool_call_id has no matching assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "tool") {
      const tcId = messages[i].tool_call_id;
      if (!tcId || !validToolCallIds.has(tcId)) {
        messages.splice(i, 1);
      }
    }
  }

  // Also check: is the first conversation message (after system) a "tool" message?
  // If so, remove it — it has no preceding assistant message
  while (messages.length > 0) {
    const firstNonSystem = messages.find((m) => m.role !== "system");
    if (!firstNonSystem) break;
    if (firstNonSystem.role === "tool") {
      const idx = messages.indexOf(firstNonSystem);
      messages.splice(idx, 1);
    } else {
      break;
    }
  }
}
