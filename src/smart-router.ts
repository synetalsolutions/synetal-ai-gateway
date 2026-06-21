/**
 * Smart Router — like Cloudflare AI Gateway Dynamic Routing
 * Auto-routes prompts to the best model/provider based on content type.
 */

import { ProviderKey } from "./types";
import { log } from "./logger";

export type PromptType = "code" | "reasoning" | "vision" | "general" | "fast";

export interface RoutingDecision {
  provider: ProviderKey;
  model: string;
  promptType: PromptType;
  reason: string;
}

/**
 * Detect prompt type from content
 */
export function detectPromptType(messages: Array<{ role: string; content?: unknown }>): PromptType {
  // Extract all text from messages, including multimodal content arrays
  const allText = messages
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text || "")
          .join(" ");
      }
      return "";
    })
    .join(" ")
    .toLowerCase();

  // ── Image/Vision detection (check BEFORE text patterns) ───
  const hasImage = messages.some((m) => {
    if (Array.isArray(m.content)) {
      return m.content.some((part: any) => part.type === "image_url");
    }
    return false;
  });
  if (hasImage) return "vision";

  // Code detection
  const codePatterns = [
    /\b(code|coding|program|function|class|import|def|const|let|var|async|await|=>)\b/,
    /\b(debug|error|bug|fix|refactor|syntax|compile|build|deploy)\b/,
    /\b(javascript|python|typescript|java|go|ruby|rust|c\+\+|php|sql|html|css)\b/,
    /```[a-z]*\n/, // code blocks
    /\b(git|github|docker|kubernetes|ci\/cd|api|rest|graphql)\b/,
  ];
  if (codePatterns.some((p) => p.test(allText))) {
    return "code";
  }

  // Vision detection
  const visionPatterns = [
    /\b(image|picture|photo|vision|see|look|describe.*image|analyze.*image|screenshot)\b/,
    /\b(design|ui|ux|layout|color|font|icon|logo)\b/,
  ];
  if (visionPatterns.some((p) => p.test(allText))) {
    return "vision";
  }

  // Reasoning detection
  const reasoningPatterns = [
    /\b(reasoning|think|logic|math|calculate|solve|equation|proof|theorem|algorithm)\b/,
    /\b(compare|analyze|evaluate|assess|strategy|plan|decision|predict)\b/,
    /\d+\s*[+\-*/]\s*\d+/, // simple math
    /\b(why|how does|explain.*because|what if|scenario|hypothesis)\b/,
  ];
  if (reasoningPatterns.some((p) => p.test(allText))) {
    return "reasoning";
  }

  // Fast / simple queries
  const simplePatterns = [
    /^(hi|hello|hey|ok|yes|no|thanks|thank you)$/,
    /\b(define|what is|who is|when|where|list|name)\b/,
  ];
  if (simplePatterns.some((p) => p.test(allText.trim()))) {
    return "fast";
  }

  return "general";
}

/**
 * Route to best provider/model based on prompt type.
 * Uses round-robin within each category to distribute load across providers.
 */
export function routePrompt(
  promptType: PromptType,
  preferredProvider?: ProviderKey,
  preferredModel?: string
): RoutingDecision {
  // If explicit provider requested, use it
  if (preferredProvider) {
    const model = preferredModel || getDefaultModelForProvider(preferredProvider);
    return {
      provider: preferredProvider,
      model,
      promptType,
      reason: `Explicit provider: ${preferredProvider}`,
    };
  }

  // Round-robin pools: each prompt type gets multiple provider options
  const pools: Record<PromptType, Array<{ provider: ProviderKey; model: string; reason: string }>> = {
    code: [
      { provider: "kimi",     model: "kimi-k2.7-code",   reason: "Code → kimi-k2.7-code" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Code → deepseek-v4-pro" },
      { provider: "glm",      model: "glm-5.2",           reason: "Code → glm-5.2" },
      { provider: "deepseek", model: "deepseek-v4-flash", reason: "Code → deepseek-v4-flash" },
      { provider: "xiaomi",   model: "mimo-v2.5-pro",     reason: "Code → mimo-v2.5-pro" },
    ],
    reasoning: [
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Reasoning → deepseek-v4-pro" },
      { provider: "glm",      model: "glm-5.2",           reason: "Reasoning → glm-5.2" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Reasoning → kimi-k2.7-code" },
    ],
    vision: [
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Vision → kimi-k2.7-code" },
      { provider: "glm",      model: "glm-5.2",           reason: "Vision → glm-5.2" },
    ],
    fast: [
      { provider: "deepseek", model: "deepseek-v4-flash", reason: "Fast → deepseek-v4-flash" },
      { provider: "xiaomi",   model: "mimo-v2.5-pro",     reason: "Fast → mimo-v2.5-pro" },
    ],
    general: [
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "General → kimi-k2.7-code" },
      { provider: "glm",      model: "glm-5.2",           reason: "General → glm-5.2" },
      { provider: "deepseek", model: "deepseek-v4-pro",    reason: "General → deepseek-v4-pro" },
      { provider: "deepseek", model: "deepseek-v4-flash",  reason: "General → deepseek-v4-flash" },
      { provider: "xiaomi",   model: "mimo-v2.5-pro",      reason: "General → mimo-v2.5-pro" },
    ],
  };

  // Round-robin: use a global counter to cycle through providers
  const pool = pools[promptType] || pools.general;
  rrCounters[promptType] = (rrCounters[promptType] || 0) + 1;
  const pick = pool[(rrCounters[promptType] - 1) % pool.length];

  return {
    provider: pick.provider,
    model: pick.model,
    promptType,
    reason: pick.reason + ` (#${rrCounters[promptType]})`,
  };
}

// Round-robin counters: track how many times each type has been routed
const rrCounters: Record<string, number> = {};

function getDefaultModelForProvider(provider: ProviderKey): string {
  const defaults: Record<ProviderKey, string> = {
    kimi: "kimi-k2.7-code",
    deepseek: "deepseek-v4-pro",
    glm: "glm-5.2",
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-5-20250929",
    xiaomi: "mimo-v2.5-pro",
  };
  return defaults[provider];
}

/**
 * Log routing decision
 */
export function logRouting(decision: RoutingDecision): void {
  log(
    "info",
    `SmartRoute [${decision.promptType}] → ${decision.provider}/${decision.model} (${decision.reason})`
  );
}
