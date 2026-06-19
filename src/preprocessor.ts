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

const SYSTEM_PROMPT = `You are a prompt optimizer for an AI coding agent. 

Your job: take the developer's raw message and transform it into a **clear, structured task**.

Rules:
- Extract the REAL intent — what does the developer actually want?
- If the message is vague ("fix this", "ye kya he", "better krdo"), infer the intent.
- If the message references an image/screenshot, phrase the prompt to describe what to look for in the image.
- Add necessary technical constraints (language, framework, files to touch).
- If the message is in Hindi/mixed language, output in English.
- Remove fluff, greetings, emojis, and random text.
- Keep it CONCISE — max 3-4 sentences.
- Output ONLY the improved prompt. No explanations, no markdown headers.`;

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

/**
 * Determine if a prompt needs preprocessing (vague/short/mixed language).
 * For image+text: evaluates only the text portion, image is always preserved.
 */
function needsOptimization(messages: Array<{ role: string; content?: unknown }>): boolean {
  // Extract text-only from all messages (including multimodal)
  const text = messages.map((m) => {
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content.filter((p: any) => p.type === "text").map((p: any) => p.text || "").join(" ");
    }
    return "";
  }).join(" ");

  // Check if has image — if so, only optimize if text itself is vague
  const hasImage = messages.some((m) => {
    if (Array.isArray(m.content)) {
      return m.content.some((part: any) => part.type === "image_url");
    }
    return false;
  });

  // Skip if very short (just "hi", "yes", "ok", "continue", "thanks")
  if (/^(hi|hello|hey|yes|no|ok|okay|thanks|thank you|continue|go on|next|bye)[.!]*$/i.test(text.trim())) {
    return false;
  }

  // Skip if already structured (has markdown, code blocks, numbered lists)
  if (/```|\*\*|^#|^\d+\.|^\-\s/m.test(text)) {
    return false;
  }

  // Skip if very detailed (>300 chars, likely already clear)
  if (text.length > 300) {
    return false;
  }

  // For image+text: optimize if text is vague regardless of length
  if (hasImage && text.length < 100) {
    return true;
  }

  // Optimize if: short, vague keywords, Hindi/mixed language, or ambiguous
  const vaguePatterns = [
    /\b(fix|change|update|modify|add|remove|delete)\s+(it|this|that)\b/i,
    /\b(better|improve|enhance|optimize)\s+(karo|krdo|karde|karna|do)\b/i,
    /\b(sahi|galat|kam|nahi|hai|karo|krdo|dalo|hatao|banao)\b/i,
    /[\u0900-\u097F]/, // Devanagari (Hindi)
  ];

  return vaguePatterns.some((p) => p.test(text)) || text.length < 50;
}

/**
 * Call deepseek-v4-flash to optimize the prompt
 */
export async function optimizePrompt(
  messages: Array<{ role: string; content?: unknown }>
): Promise<PreprocessResult> {
  const start = Date.now();
  const originalText = messages.map((m) => {
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content.filter((p: any) => p.type === "text").map((p: any) => p.text || "").join(" ");
    }
    return "";
  }).join("\n");

  // Quick check: skip if not needed
  if (!needsOptimization(messages)) {
    return {
      optimized: false,
      originalPrompt: originalText,
      optimizedPrompt: originalText,
      latencyMs: 0,
      modelUsed: PREPROCESS_MODEL,
      skipped: true,
      skipReason: "prompt already clear",
    };
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
