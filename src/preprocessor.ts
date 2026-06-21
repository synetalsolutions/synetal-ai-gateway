/**
 * Prompt Preprocessor — Optimizes raw developer prompts before AI agent sees them.
 * Uses deepseek-v4-flash (fast & cheap) to turn vague/hindi/mixed messages
 * into clean, structured prompts the main AI agent can understand.
 */

import * as https from "https";
import { ChatCompletionPayload } from "./types";
import { log } from "./logger";

const PREPROCESS_MODEL = process.env.PREPROCESS_MODEL || "deepseek-v4-flash";
const PREPROCESS_ENABLED = process.env.PREPROCESS_ENABLED !== "false"; // default ON

const SYSTEM_PROMPT = `You are a prompt rephraser for an AI coding agent.

Your ONLY job: rephrase ambiguous messages into clearer instructions.

CRITICAL RULES:
- NEVER answer the question. You are rephrasing, NOT solving.
- NEVER add technical details, file names, or constraints not in the original.
- If in Hindi/mixed language, translate to English.
- If already clear and specific, return it almost unchanged (minor tidying only).
- Keep it CONCISE — same length or shorter than original.
- Output ONLY the rephrased message. No explanations.

GOOD examples:
- "ye kya he" → "What is this code doing?"
- "better krdo" → "Improve this code quality"
- "fix this" → "Fix the bug in this code"
- "What is 2+2?" → "What is 2+2?" (already clear, unchanged)
- "add login" → "Add a login feature" (already clear, unchanged)`;

export interface PreprocessResult {
  optimized: boolean;
  originalPrompt: string;
  optimizedPrompt: string;
  latencyMs: number;
  modelUsed: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Check if preprocessing is enabled
 */
export function isPreprocessEnabled(): boolean {
  return PREPROCESS_ENABLED;
}

type Msg = { role: string; content?: unknown };

interface LastUserMessage {
  index: number;
  text: string;
  hasImage: boolean;
}

/**
 * Extract the most recent user message and its plain text.
 * Returns null if that message is actually a tool result disguised as a
 * user message (Anthropic-style tool_result blocks) — those are agent turns.
 */
function getLastUserMessage(messages: Msg[]): LastUserMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;

    if (typeof m.content === "string") {
      return { index: i, text: m.content, hasImage: false };
    }
    if (Array.isArray(m.content)) {
      // A "user" message carrying tool_result/tool_use parts is an agent loop step
      const hasToolResult = m.content.some(
        (p: any) => p?.type === "tool_result" || p?.type === "tool_use"
      );
      if (hasToolResult) return null;

      const text = m.content
        .filter((p: any) => p?.type === "text")
        .map((p: any) => p.text || "")
        .join(" ");
      const hasImage = m.content.some((p: any) => p?.type === "image_url");
      return { index: i, text, hasImage };
    }
    return null;
  }
  return null;
}

/**
 * Decide whether this request is a genuine user-initiated turn (a human just
 * typed something) versus an agent interaction (tool result / agentic loop
 * continuation). The preprocessor must ONLY run on real user input — never on
 * the agent's internal back-and-forth.
 */
export function isUserTurn(messages: Msg[]): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;

  const last = messages[messages.length - 1];

  // Agent loop signals: last message is a tool result or the assistant's own
  // continuation. Only a trailing "user" message means the human just spoke.
  if (last.role !== "user") return false;

  // OpenAI-style tool results come back as role "tool"; if any tool message
  // appears AFTER the last real user text, we're still mid agent loop.
  if (Array.isArray(last.content)) {
    const hasToolResult = last.content.some(
      (p: any) => p?.type === "tool_result" || p?.type === "tool_use"
    );
    if (hasToolResult) return false;
  }

  return true;
}

/**
 * Determine if the user's prompt needs preprocessing (vague/short/mixed language).
 * Operates ONLY on the latest user message text — not the whole conversation —
 * so the big system prompt and history never skew the decision.
 * For image+text: evaluates only the text portion, image is always preserved.
 */
function needsOptimization(text: string, hasImage: boolean): boolean {
  const trimmed = text.trim();

  // Nothing to optimize
  if (!trimmed) return false;

  // Skip if very short (just "hi", "yes", "ok", "continue", "thanks")
  if (/^(hi|hello|hey|yes|no|ok|okay|thanks|thank you|continue|go on|next|bye|done|perfect|great)[.!]*$/i.test(trimmed)) {
    return false;
  }

  // Skip clear questions — they are already precise
  // "What is X?", "How do I Y?", "Why does Z happen?"
  if (/^(what|how|why|when|where|who)\s.*(is|are|do|does|did|can|should|would|will|happen|work)\b/i.test(trimmed) && trimmed.length < 100) {
    return false;
  }

  // Skip code-containing messages (code blocks, inline code)
  if (/```|\*\*|^#|^\d+\.|^\-\s/m.test(text)) {
    return false;
  }

  // Skip if already detailed enough (likely already clear)
  if (text.length > 200) {
    return false;
  }

  // For image+text: optimize if text is vague regardless of length
  if (hasImage && text.length < 80) {
    return true;
  }

  // Optimize ONLY if: Hindi/Devanagari present (translate needed), or
  // extremely vague command keywords without context
  const hindiPatterns = [
    /\b(sahi|galat|kam|nahi|hai|karo|krdo|karde|karna|dalo|hatao|banao|chahiye|kya|mujhe|mera|aap|ye|wo|ka|ki|ne|se|ko|par|aur|toh)\b/i,
    /[\u0900-\u097F]/, // Devanagari script
  ];

  // Only optimize if Hindi is detected — this is the primary use case
  if (hindiPatterns.some((p) => p.test(text))) {
    return true;
  }

  // VERY short vague commands in English (under 30 chars, no question/code)
  if (text.length < 30 && !(/[?]/.test(text))) {
    const shortVague = /^(fix|update|change|better|improve|broken|error|help|test|deploy|build)$/i;
    if (shortVague.test(trimmed)) return true;
  }

  return false;
}

/**
 * Call deepseek-v4-flash to optimize the prompt
 */
export async function optimizePrompt(
  messages: Array<{ role: string; content?: unknown }>
): Promise<PreprocessResult> {
  const start = Date.now();

  const skip = (reason: string, original = ""): PreprocessResult => ({
    optimized: false,
    originalPrompt: original,
    optimizedPrompt: original,
    latencyMs: 0,
    modelUsed: PREPROCESS_MODEL,
    skipped: true,
    skipReason: reason,
  });

  // Only act on a genuine user turn — never on agent loop / tool interactions.
  if (!isUserTurn(messages)) {
    return skip("agent interaction (not user input)");
  }

  const lastUser = getLastUserMessage(messages);
  if (!lastUser) {
    return skip("no user message");
  }

  const originalText = lastUser.text;

  // Quick check: skip if not needed (evaluated on the user prompt only)
  if (!needsOptimization(originalText, lastUser.hasImage)) {
    return skip("prompt already clear", originalText);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    log("warn", "Preprocessor: DEEPSEEK_API_KEY not set, skipping");
    return {
      optimized: false,
      originalPrompt: originalText,
      optimizedPrompt: originalText,
      latencyMs: 0,
      modelUsed: PREPROCESS_MODEL,
      skipped: true,
      skipReason: "missing API key",
    };
  }

  const body = JSON.stringify({
    model: PREPROCESS_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: originalText },
    ],
    max_tokens: 300,
    temperature: 0.1,
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.deepseek.com",
        port: 443,
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const latencyMs = Date.now() - start;
          try {
            const parsed = JSON.parse(data);
            const optimized = parsed.choices?.[0]?.message?.content?.trim() || originalText;
            log("ok", `Preprocessor: optimized in ${latencyMs}ms | "${originalText.slice(0, 50)}..." → "${optimized.slice(0, 80)}..."`);
            resolve({
              optimized: true,
              originalPrompt: originalText,
              optimizedPrompt: optimized,
              latencyMs,
              modelUsed: PREPROCESS_MODEL,
            });
          } catch {
            log("warn", `Preprocessor: failed to parse response in ${latencyMs}ms`);
            resolve({
              optimized: false,
              originalPrompt: originalText,
              optimizedPrompt: originalText,
              latencyMs,
              modelUsed: PREPROCESS_MODEL,
              skipped: true,
              skipReason: "parse error",
            });
          }
        });
      }
    );

    req.on("error", (err) => {
      log("warn", `Preprocessor: request failed: ${err.message}`);
      resolve({
        optimized: false,
        originalPrompt: originalText,
        optimizedPrompt: originalText,
        latencyMs: Date.now() - start,
        modelUsed: PREPROCESS_MODEL,
        skipped: true,
        skipReason: err.message,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        optimized: false,
        originalPrompt: originalText,
        optimizedPrompt: originalText,
        latencyMs: Date.now() - start,
        modelUsed: PREPROCESS_MODEL,
        skipped: true,
        skipReason: "timeout",
      });
    });

    req.write(body);
    req.end();
  });
}

/**
 * Apply optimized prompt to payload messages.
 * For text-only messages: replaces the content.
 * For image+text (multimodal): optimizes ONLY the text part, preserves images.
 */
export function applyOptimizedPrompt(
  payload: ChatCompletionPayload,
  result: PreprocessResult
): ChatCompletionPayload {
  if (!result.optimized) return payload;

  const p = { ...payload, messages: [...payload.messages] };

  // Find the last user message and optimize it
  for (let i = p.messages.length - 1; i >= 0; i--) {
    const msg = p.messages[i];
    
    if (msg.role !== "user") continue;

    // Case 1: Plain text message — simple replacement
    if (typeof msg.content === "string") {
      p.messages[i] = { ...msg, content: result.optimizedPrompt };
      break;
    }

    // Case 2: Multimodal (image+text) — optimize only text parts, keep images
    if (Array.isArray(msg.content)) {
      const parts = msg.content as Array<{ type: string; text?: string; image_url?: unknown }>;
      const updated = parts.map((part) => {
        if (part.type === "text") {
          return { ...part, text: result.optimizedPrompt };
        }
        // Keep image_url parts untouched
        return part;
      });
      p.messages[i] = { ...msg, content: updated as unknown as string };
      break;
    }
  }

  return p;
}
