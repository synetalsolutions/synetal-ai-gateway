/**
 * Smart Router — Cost-Aware Intelligent Routing (like Kafka message routing)
 *
 * Auto-routes prompts based on TWO dimensions:
 *   1. Prompt Type (code/vision/reasoning/general/fast)
 *   2. Complexity Score (0-100 → cheap/medium/premium tier)
 *
 * This ensures "hi" messages go to DeepSeek Flash ($0.1/M), not GLM-5.2 ($4/M).
 *
 * Also integrates Circuit Breaker — rate-limited providers are automatically
 * skipped until they recover.
 */

import { ProviderKey } from "./types";
import { log } from "./logger";
import { isProviderAvailable } from "./circuit-breaker";
import { scoreComplexity, tierLabel, CostTier } from "./complexity-scorer";
import { getDefaultModel as getDefaultModelForProvider } from "./model-registry";

export type PromptType = "code" | "reasoning" | "vision" | "general" | "fast";

export interface RoutingDecision {
  provider: ProviderKey;
  model: string;
  promptType: PromptType;
  reason: string;
  complexityScore?: number;   // 0-100
  costTier?: CostTier;        // cheap/medium/premium
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
 * Route to best provider/model based on prompt type AND complexity.
 *
 * Two-dimensional routing:
 *   - Prompt type determines the CATEGORY of models suitable
 *   - Complexity score determines the COST TIER (cheap vs premium)
 *
 * Simple requests → cheap models (DeepSeek Flash, MiMo)
 * Complex requests → premium models (GLM-5.2, Kimi)
 *
 * Circuit breaker ensures rate-limited providers are skipped.
 */
export function routePrompt(
  promptType: PromptType,
  preferredProvider?: ProviderKey,
  preferredModel?: string,
  complexity?: { score: number; tier: CostTier; factors: string[] }
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

  // ── COST-AWARE ROUTING POOLS ─────────────────────────────────────────────
  //
  // Three tiers based on COST, not just capability:
  //
  //   💎 PREMIUM  — GLM-5.2 ($4/$12/M): Complex algorithms, architecture, vision
  //   💵 MEDIUM   — Kimi ($2/$10/M), DeepSeek-pro ($1/$2/M): General programming
  //   💰 CHEAP    — DeepSeek-flash ($0.1/$0.2/M), MiMo (free): Simple tasks
  //
  // Within each tier, pools are weighted by capability for the prompt type.
  // This ensures "hi" → flash ($0.1) and "refactor microservices" → GLM ($4).
  //
  // Cost data (verified 2026-06-21):
  //   GLM-5.2  → Z.AI: $4/$12 per M tokens (PREMIUM)
  //   Kimi K2.7 → platform.kimi.ai: $2/$10 per M tokens (MEDIUM)
  //   DeepSeek V4 Pro  → api-docs: $1/$2 per M tokens (MEDIUM-CHEAP)
  //   DeepSeek V4 Flash → api-docs: $0.1/$0.2 per M tokens (CHEAP)
  //   Xiaomi MiMo → open-weight, free to run (FREE)

  type PoolEntry = { provider: ProviderKey; model: string; reason: string };

  const cheapPool: Record<PromptType, PoolEntry[]> = {
    code: [
      { provider: "deepseek", model: "deepseek-v4-flash", reason: "Cheap/Code → flash" },
      { provider: "deepseek", model: "deepseek-v4-flash", reason: "Cheap/Code → flash" },
      { provider: "xiaomi",   model: "mimo-v2.5-pro",     reason: "Cheap/Code → mimo" },
    ],
    reasoning: [
      { provider: "deepseek", model: "deepseek-v4-flash", reason: "Cheap/Reasoning → flash" },
      { provider: "deepseek", model: "deepseek-v4-flash", reason: "Cheap/Reasoning → flash" },
      { provider: "xiaomi",   model: "mimo-v2.5-pro",     reason: "Cheap/Reasoning → mimo" },
    ],
    vision: [
      // Vision needs real models — no cheap option, fall through to medium
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Vision(no-cheap) → kimi" },
    ],
    fast: [
      { provider: "xiaomi",   model: "mimo-v2.5-pro",     reason: "Fast → mimo" },
      { provider: "xiaomi",   model: "mimo-v2.5-pro",     reason: "Fast → mimo" },
      { provider: "deepseek", model: "deepseek-v4-flash", reason: "Fast → flash" },
    ],
    general: [
      { provider: "deepseek", model: "deepseek-v4-flash", reason: "Cheap/General → flash" },
      { provider: "deepseek", model: "deepseek-v4-flash", reason: "Cheap/General → flash" },
      { provider: "xiaomi",   model: "mimo-v2.5-pro",     reason: "Cheap/General → mimo" },
    ],
  };

  const mediumPool: Record<PromptType, PoolEntry[]> = {
    code: [
      // Kimi 50% — SOTA long-horizon coding, code-specialized
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/Code → kimi" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/Code → kimi" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/Code → kimi" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/Code → kimi" },
      // DeepSeek-pro 50% — strong general-purpose coding
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/Code → ds-pro" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/Code → ds-pro" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/Code → ds-pro" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/Code → ds-pro" },
    ],
    reasoning: [
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/Reasoning → ds-pro" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/Reasoning → ds-pro" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/Reasoning → ds-pro" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/Reasoning → ds-pro" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/Reasoning → kimi" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/Reasoning → kimi" },
    ],
    vision: [
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/Vision → kimi" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/Vision → kimi" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/Vision → kimi" },
    ],
    fast: [
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/Fast → ds-pro" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/Fast → ds-pro" },
      { provider: "deepseek", model: "deepseek-v4-flash", reason: "Med/Fast → flash" },
    ],
    general: [
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/General → kimi" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/General → kimi" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Med/General → kimi" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/General → ds-pro" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Med/General → ds-pro" },
    ],
  };

  const premiumPool: Record<PromptType, PoolEntry[]> = {
    code: [
      // GLM-5.2 60% — official "strongest coding model", 1M context
      { provider: "glm",      model: "glm-5.2",           reason: "Prem/Code → glm-5.2" },
      { provider: "glm",      model: "glm-5.2",           reason: "Prem/Code → glm-5.2" },
      { provider: "glm",      model: "glm-5.2",           reason: "Prem/Code → glm-5.2" },
      // Kimi 40% — SOTA long-horizon coding as backup
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Prem/Code → kimi" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Prem/Code → kimi" },
    ],
    reasoning: [
      // GLM-5.2 60% — strongest reasoning, supports reasoning_effort
      { provider: "glm",      model: "glm-5.2",           reason: "Prem/Reasoning → glm-5.2" },
      { provider: "glm",      model: "glm-5.2",           reason: "Prem/Reasoning → glm-5.2" },
      { provider: "glm",      model: "glm-5.2",           reason: "Prem/Reasoning → glm-5.2" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Prem/Reasoning → ds-pro" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Prem/Reasoning → ds-pro" },
    ],
    vision: [
      // GLM-5.2 100% — native visual reasoning (GLM-4.6V is SOTA at scale)
      { provider: "glm",      model: "glm-5.2",           reason: "Prem/Vision → glm-5.2" },
      { provider: "glm",      model: "glm-5.2",           reason: "Prem/Vision → glm-5.2" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Prem/Vision → kimi (backup)" },
    ],
    fast: [
      // "fast" + premium is unusual, but don't waste GLM on it
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Prem/Fast → ds-pro" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Prem/Fast → kimi" },
    ],
    general: [
      { provider: "glm",      model: "glm-5.2",           reason: "Prem/General → glm-5.2" },
      { provider: "glm",      model: "glm-5.2",           reason: "Prem/General → glm-5.2" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Prem/General → kimi" },
      { provider: "kimi",     model: "kimi-k2.7-code",    reason: "Prem/General → kimi" },
      { provider: "deepseek", model: "deepseek-v4-pro",   reason: "Prem/General → ds-pro" },
    ],
  };

  // ── SELECT POOL BY COST TIER ─────────────────────────────────────────────
  let tier: CostTier = complexity?.tier || "medium";
  let pool: PoolEntry[];

  // If no complexity provided, score from messages (but we don't have them here)
  // Default to medium for safety
  if (tier === "cheap") {
    pool = cheapPool[promptType] || cheapPool.general;
  } else if (tier === "premium") {
    pool = premiumPool[promptType] || premiumPool.general;
  } else {
    pool = mediumPool[promptType] || mediumPool.general;
  }

  // ── FILTER BY CIRCUIT BREAKER ────────────────────────────────────────────
  // Remove providers that are in OPEN state (rate-limited / failing)
  const available = pool.filter((entry) => isProviderAvailable(entry.provider));

  let pick: PoolEntry;
  if (available.length > 0) {
    // Use the filtered pool
    pool = available;
  } else {
    // ALL providers in this tier are down — escalate to next tier
    log("warn", `[SmartRouter] All ${tier} providers unavailable for ${promptType}, escalating tier`);

    // Try other tiers as fallback
    const fallbackTiers: CostTier[] = tier === "cheap"
      ? ["medium", "premium"]
      : tier === "medium"
      ? ["premium", "cheap"]
      : ["medium", "cheap"];

    for (const ft of fallbackTiers) {
      const altPool = ft === "cheap" ? cheapPool : ft === "medium" ? mediumPool : premiumPool;
      const altAvailable = (altPool[promptType] || altPool.general).filter(
        (e) => isProviderAvailable(e.provider)
      );
      if (altAvailable.length > 0) {
        pool = altAvailable;
        tier = ft; // Update tier for the log
        log("info", `[SmartRouter] Escalated to ${tier} tier (${pool.length} providers available)`);
        break;
      }
    }
  }

  // ── ROUND-ROBIN WITHIN TIER ──────────────────────────────────────────────
  const rrKey = `${promptType}:${tier}`;
  rrCounters[rrKey] = (rrCounters[rrKey] || 0) + 1;
  pick = pool[(rrCounters[rrKey] - 1) % pool.length];

  return {
    provider: pick.provider,
    model: pick.model,
    promptType,
    reason: pick.reason + ` [${tierLabel(tier)} score=${complexity?.score ?? "?"}]`,
    complexityScore: complexity?.score,
    costTier: tier,
  };
}

// Round-robin counters: track how many times each type has been routed
const rrCounters: Record<string, number> = {};

/**
 * Combined routing: score complexity from messages + route to best model.
 *
 * This is the main entry point for proxy.ts — it does everything in one call:
 *   1. Detect prompt type (code/reasoning/vision/general/fast)
 *   2. Score complexity (0-100 → cheap/medium/premium tier)
 *   3. Select the right cost-tier pool
 *   4. Filter by circuit breaker (skip rate-limited providers)
 *   5. Round-robin within the tier
 *   6. Return the routing decision
 *
 * @param messages Chat messages from the request
 * @param preferredModel Optional model override from client
 * @returns RoutingDecision
 */
export function routeWithComplexity(
  messages: Array<{ role: string; content?: unknown }>,
  preferredModel?: string
): RoutingDecision {
  const promptType = detectPromptType(messages);
  const complexity = scoreComplexity(messages, promptType);

  log(
    "info",
    `[SmartRouter] Complexity: ${complexity.score}/100 → ${tierLabel(complexity.tier)} | ${promptType} | ~${complexity.tokenEstimate} tokens | ${complexity.factors.join(", ")}`
  );

  return routePrompt(promptType, undefined, preferredModel, complexity);
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
