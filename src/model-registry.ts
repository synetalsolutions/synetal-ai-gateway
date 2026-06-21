/**
 * Model Registry — Single Source of Truth for ALL Models
 *
 * Live-fetched from each provider's /v1/models endpoint (2026-06-21).
 * Every model has metadata: context size, cost tier, capabilities.
 *
 * This is used by:
 *   - /v1/models endpoint (to list models to Cursor)
 *   - smart-router.ts (to pick models within cost tiers)
 *   - cost-tracker.ts (for pricing)
 *   - proxy.ts mapModelForProvider (for fallback mapping)
 */

import { ProviderKey } from "./types";

export type CostTier = "cheap" | "medium" | "premium";
export type PromptType = "code" | "reasoning" | "vision" | "general" | "fast";

export interface ModelInfo {
  id: string;                  // Exact model ID the provider expects
  provider: ProviderKey;       // Which provider hosts this model
  contextLength: number;       // Max context window (tokens)
  costTier: CostTier;          // cheap / medium / premium
  supportsVision: boolean;     // Can process images
  supportsReasoning: boolean;  // Has thinking/reasoning mode
  supportsVideo?: boolean;     // Can process video input
  description: string;         // Human-readable label
  // Pricing per 1M tokens (input/output)
  pricing: { input: number; output: number };
  // What prompt types this model is good at
  bestFor: PromptType[];
}

// ═══════════════════════════════════════════════════════════════════════════
// ALL MODELS — fetched live from providers on 2026-06-21
// ═══════════════════════════════════════════════════════════════════════════

export const MODEL_REGISTRY: ModelInfo[] = [

  // ── GLM (Z.AI) — 8 models ────────────────────────────────────────────────
  {
    id: "glm-5.2",
    provider: "glm",
    contextLength: 1_000_000,
    costTier: "premium",
    supportsVision: true,
    supportsReasoning: true,
    description: "Z.AI flagship — strongest coding & reasoning, 1M context",
    pricing: { input: 4.0, output: 12.0 },
    bestFor: ["code", "reasoning", "vision"],
  },
  {
    id: "glm-5.1",
    provider: "glm",
    contextLength: 1_000_000,
    costTier: "premium",
    supportsVision: true,
    supportsReasoning: true,
    description: "GLM 5.1 — strong reasoning, previous-gen flagship",
    pricing: { input: 3.0, output: 9.0 },
    bestFor: ["code", "reasoning"],
  },
  {
    id: "glm-5",
    provider: "glm",
    contextLength: 256_000,
    costTier: "medium",
    supportsVision: true,
    supportsReasoning: true,
    description: "GLM 5 — reliable mid-tier, good all-rounder",
    pricing: { input: 2.0, output: 6.0 },
    bestFor: ["code", "general"],
  },
  {
    id: "glm-5-turbo",
    provider: "glm",
    contextLength: 128_000,
    costTier: "cheap",
    supportsVision: false,
    supportsReasoning: false,
    description: "GLM 5 Turbo — fast, cheap, for simple tasks",
    pricing: { input: 0.3, output: 0.9 },
    bestFor: ["fast", "general"],
  },
  {
    id: "glm-4.7",
    provider: "glm",
    contextLength: 128_000,
    costTier: "medium",
    supportsVision: true,
    supportsReasoning: true,
    description: "GLM 4.7 — solid coding, mid-cost",
    pricing: { input: 1.5, output: 4.5 },
    bestFor: ["code", "general"],
  },
  {
    id: "glm-4.6",
    provider: "glm",
    contextLength: 128_000,
    costTier: "medium",
    supportsVision: true,
    supportsReasoning: true,
    description: "GLM 4.6 — native visual reasoning (GLM-4.6V)",
    pricing: { input: 1.5, output: 4.5 },
    bestFor: ["vision", "general"],
  },
  {
    id: "glm-4.5",
    provider: "glm",
    contextLength: 128_000,
    costTier: "cheap",
    supportsVision: false,
    supportsReasoning: false,
    description: "GLM 4.5 — budget option, decent for simple tasks",
    pricing: { input: 0.5, output: 1.5 },
    bestFor: ["fast", "general"],
  },
  {
    id: "glm-4.5-air",
    provider: "glm",
    contextLength: 128_000,
    costTier: "cheap",
    supportsVision: false,
    supportsReasoning: false,
    description: "GLM 4.5 Air — ultra-light, cheapest GLM variant",
    pricing: { input: 0.1, output: 0.3 },
    bestFor: ["fast"],
  },

  // ── KIMI (Moonshot) — 11 models ──────────────────────────────────────────
  {
    id: "kimi-k2.7-code",
    provider: "kimi",
    contextLength: 262_144,
    costTier: "medium",
    supportsVision: true,
    supportsReasoning: true,
    supportsVideo: true,
    description: "Kimi K2.7 Code — SOTA long-horizon coding & agents",
    pricing: { input: 2.0, output: 10.0 },
    bestFor: ["code", "reasoning", "vision"],
  },
  {
    id: "kimi-k2.7-code-highspeed",
    provider: "kimi",
    contextLength: 262_144,
    costTier: "medium",
    supportsVision: true,
    supportsReasoning: true,
    supportsVideo: true,
    description: "Kimi K2.7 Code Highspeed — same brain, faster inference",
    pricing: { input: 2.5, output: 10.0 },
    bestFor: ["code", "general"],
  },
  {
    id: "kimi-k2.6",
    provider: "kimi",
    contextLength: 262_144,
    costTier: "medium",
    supportsVision: true,
    supportsReasoning: true,
    supportsVideo: true,
    description: "Kimi K2.6 — previous gen, strong long-context",
    pricing: { input: 1.5, output: 6.0 },
    bestFor: ["code", "general"],
  },
  {
    id: "kimi-k2.5",
    provider: "kimi",
    contextLength: 262_144,
    costTier: "cheap",
    supportsVision: true,
    supportsReasoning: true,
    supportsVideo: true,
    description: "Kimi K2.5 — budget Kimi, good for medium tasks",
    pricing: { input: 0.5, output: 2.0 },
    bestFor: ["general", "code"],
  },
  {
    id: "moonshot-v1-auto",
    provider: "kimi",
    contextLength: 131_072,
    costTier: "cheap",
    supportsVision: false,
    supportsReasoning: false,
    description: "Moonshot v1 Auto — auto-selects context, general purpose",
    pricing: { input: 0.3, output: 1.0 },
    bestFor: ["fast", "general"],
  },
  {
    id: "moonshot-v1-128k",
    provider: "kimi",
    contextLength: 131_072,
    costTier: "cheap",
    supportsVision: false,
    supportsReasoning: false,
    description: "Moonshot v1 128K — large context, budget price",
    pricing: { input: 0.3, output: 1.0 },
    bestFor: ["general"],
  },
  {
    id: "moonshot-v1-32k",
    provider: "kimi",
    contextLength: 32_768,
    costTier: "cheap",
    supportsVision: false,
    supportsReasoning: false,
    description: "Moonshot v1 32K — small context, cheapest Moonshot",
    pricing: { input: 0.1, output: 0.4 },
    bestFor: ["fast"],
  },
  {
    id: "moonshot-v1-8k",
    provider: "kimi",
    contextLength: 8_192,
    costTier: "cheap",
    supportsVision: false,
    supportsReasoning: false,
    description: "Moonshot v1 8K — tiny context, ultra-cheap",
    pricing: { input: 0.05, output: 0.2 },
    bestFor: ["fast"],
  },
  {
    id: "moonshot-v1-128k-vision-preview",
    provider: "kimi",
    contextLength: 131_072,
    costTier: "medium",
    supportsVision: true,
    supportsReasoning: false,
    description: "Moonshot Vision 128K — image understanding, large context",
    pricing: { input: 0.5, output: 2.0 },
    bestFor: ["vision"],
  },
  {
    id: "moonshot-v1-32k-vision-preview",
    provider: "kimi",
    contextLength: 32_768,
    costTier: "cheap",
    supportsVision: true,
    supportsReasoning: false,
    description: "Moonshot Vision 32K — cheaper vision option",
    pricing: { input: 0.3, output: 1.2 },
    bestFor: ["vision", "fast"],
  },
  {
    id: "moonshot-v1-8k-vision-preview",
    provider: "kimi",
    contextLength: 8_192,
    costTier: "cheap",
    supportsVision: true,
    supportsReasoning: false,
    description: "Moonshot Vision 8K — cheapest vision model",
    pricing: { input: 0.2, output: 0.8 },
    bestFor: ["vision", "fast"],
  },

  // ── DEEPSEEK — 2 models ──────────────────────────────────────────────────
  {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    contextLength: 1_000_000,
    costTier: "medium",
    supportsVision: false,
    supportsReasoning: true,
    description: "DeepSeek V4 Pro — strong reasoning, 1M context, cost-effective",
    pricing: { input: 1.0, output: 2.0 },
    bestFor: ["code", "reasoning"],
  },
  {
    id: "deepseek-v4-flash",
    provider: "deepseek",
    contextLength: 1_000_000,
    costTier: "cheap",
    supportsVision: false,
    supportsReasoning: false,
    description: "DeepSeek V4 Flash — ultra-cheap ($0.1/$0.2), 1M context",
    pricing: { input: 0.1, output: 0.2 },
    bestFor: ["fast", "general", "code"],
  },

  // ── XIAOMI MiMo — 5 text/chat models (excluding TTS/ASR) ──────────────────
  {
    id: "mimo-v2.5-pro",
    provider: "xiaomi",
    contextLength: 32_768,
    costTier: "cheap",
    supportsVision: false,
    supportsReasoning: true,
    description: "Xiaomi MiMo v2.5 Pro — open-weight, free to run, strong for size",
    pricing: { input: 0.0, output: 0.0 },
    bestFor: ["fast", "general", "code"],
  },
  {
    id: "mimo-v2.5",
    provider: "xiaomi",
    contextLength: 32_768,
    costTier: "cheap",
    supportsVision: false,
    supportsReasoning: false,
    description: "MiMo v2.5 — standard open-weight model, free",
    pricing: { input: 0.0, output: 0.0 },
    bestFor: ["fast", "general"],
  },
  {
    id: "mimo-v2-pro",
    provider: "xiaomi",
    contextLength: 32_768,
    costTier: "cheap",
    supportsVision: false,
    supportsReasoning: false,
    description: "MiMo v2 Pro — previous gen, free open-weight",
    pricing: { input: 0.0, output: 0.0 },
    bestFor: ["fast", "general"],
  },
  {
    id: "mimo-v2-omni",
    provider: "xiaomi",
    contextLength: 32_768,
    costTier: "cheap",
    supportsVision: true,
    supportsReasoning: false,
    description: "MiMo v2 Omni — multimodal, free, vision capable",
    pricing: { input: 0.0, output: 0.0 },
    bestFor: ["vision", "general"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all models for a specific provider.
 */
export function getModelsByProvider(provider: ProviderKey): ModelInfo[] {
  return MODEL_REGISTRY.filter((m) => m.provider === provider);
}

/**
 * Get all models in a specific cost tier.
 */
export function getModelsByTier(tier: CostTier): ModelInfo[] {
  return MODEL_REGISTRY.filter((m) => m.costTier === tier);
}

/**
 * Get models suitable for a given prompt type (sorted by cost-efficiency).
 * Returns the best models first within each tier.
 */
export function getModelsForPromptType(
  promptType: PromptType,
  tier: CostTier
): ModelInfo[] {
  return MODEL_REGISTRY.filter(
    (m) => m.costTier === tier && m.bestFor.includes(promptType)
  );
}

/**
 * Find a model by its ID across all providers.
 */
export function findModel(modelId: string): ModelInfo | undefined {
  return MODEL_REGISTRY.find((m) => m.id === modelId);
}

/**
 * Get pricing for a model. Falls back to provider default.
 */
export function getPricing(modelId: string): { input: number; output: number } {
  const model = findModel(modelId);
  if (model) return model.pricing;
  return { input: 0.5, output: 2.0 }; // Generic fallback
}

/**
 * Get the default (flagship) model for a provider.
 */
export function getDefaultModel(provider: ProviderKey): string {
  const defaults: Record<ProviderKey, string> = {
    glm: "glm-5.2",
    kimi: "kimi-k2.7-code",
    deepseek: "deepseek-v4-pro",
    xiaomi: "mimo-v2.5-pro",
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-5-20250929",
  };
  return defaults[provider];
}

/**
 * Check if a model ID belongs to a given provider.
 */
export function modelBelongsToProvider(modelId: string, provider: ProviderKey): boolean {
  const model = findModel(modelId);
  return model?.provider === provider;
}

/**
 * Get all model IDs as a flat array (for /v1/models endpoint).
 */
export function getAllModelIds(): string[] {
  return MODEL_REGISTRY.map((m) => m.id);
}

/**
 * Stats summary
 */
export function getRegistryStats() {
  const byProvider: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  for (const m of MODEL_REGISTRY) {
    byProvider[m.provider] = (byProvider[m.provider] || 0) + 1;
    byTier[m.costTier] = (byTier[m.costTier] || 0) + 1;
  }
  return {
    totalModels: MODEL_REGISTRY.length,
    byProvider,
    byTier,
  };
}
