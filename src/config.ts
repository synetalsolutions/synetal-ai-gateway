/**
 * Configuration loader and builder for Multi-Model Proxy
 */

import {
  ProviderKey,
  ProviderConfig,
  ProxyConfig,
} from "./types";

const DEFAULT_PROXY_PORT = 3456;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

function env(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

function envBool(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  return val.toLowerCase() === "true" || val === "1";
}

function envInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function buildProviderConfig(key: ProviderKey): ProviderConfig {
  const configs: Record<ProviderKey, ProviderConfig> = {
    kimi: {
      host: "api.moonshot.ai",
      defaultModel: "kimi-k2.7-code",
      keyEnv: "KIMI_API_KEY",
      forceTopP: 0.95,
      backfillReasoning: true,
    },
    deepseek: {
      host: "api.deepseek.com",
      keyEnv: "DEEPSEEK_API_KEY",
    },
    glm: {
      host: "api.z.ai",
      keyEnv: "GLM_API_KEY",
      basePath: "/api/coding/paas/v4",
      pathTransform: (path: string) => path.replace(/^\/v1/, ""),
    },
    openai: {
      host: "api.openai.com",
      keyEnv: "OPENAI_API_KEY",
    },
    anthropic: {
      host: "api.anthropic.com",
      keyEnv: "ANTHROPIC_API_KEY",
      version: "2023-06-01",
    },
    xiaomi: {
      host: "token-plan-sgp.xiaomimimo.com",
      keyEnv: "XIAOMI_API_KEY",
    },
  };
  return configs[key];
}

export function loadConfig(): ProxyConfig {
  const defaultProvider = (env("DEFAULT_PROVIDER", "kimi") as ProviderKey) ?? "kimi";

  const providers: Record<ProviderKey, ProviderConfig> = {
    kimi: buildProviderConfig("kimi"),
    deepseek: buildProviderConfig("deepseek"),
    glm: buildProviderConfig("glm"),
    openai: buildProviderConfig("openai"),
    anthropic: buildProviderConfig("anthropic"),
    xiaomi: buildProviderConfig("xiaomi"),
  };

  // ── Filter out providers without API keys ──────────────────────────────
  const activeProviders: Record<string, ProviderConfig> = {};
  for (const [key, cfg] of Object.entries(providers)) {
    const apiKey = process.env[cfg.keyEnv];
    if (apiKey && apiKey.length > 10) {
      activeProviders[key] = cfg;
    } else {
      console.log("[WARN] Skipping provider \"" + key + "\": no API key set (" + cfg.keyEnv + ")");
    }
  }

  // Fallback chain: try primary, then fallbacks in order
  const rawFallbackChain = env("FALLBACK_CHAIN", "deepseek,xiaomi,kimi")!;
  const fallbackChain = rawFallbackChain
    .split(",")
    .map((s) => s.trim() as ProviderKey)
    .filter((k) => k in activeProviders);

  // Load balance groups: model family -> provider list
  const loadBalanceGroups: Record<string, ProviderKey[]> = {
    "reasoning": ["deepseek", "kimi", "xiaomi"],
    "coding": ["kimi", "deepseek", "xiaomi"],
    "general": ["kimi", "deepseek", "xiaomi"],
    "vision": ["kimi", "xiaomi"],
  };

  // Override from env if provided: LOADBALANCE_REASONING=deepseek,openai
  for (const [group, _] of Object.entries(loadBalanceGroups)) {
    const envKey = `LOADBALANCE_${group.toUpperCase()}`;
    const envVal = process.env[envKey];
    if (envVal) {
      loadBalanceGroups[group] = envVal
        .split(",")
        .map((s) => s.trim() as ProviderKey)
        .filter((k) => k in activeProviders);
    }
  }

  return {
    proxyPort: envInt("PROXY_PORT", DEFAULT_PROXY_PORT),
    defaultProvider,
    providers: activeProviders as Record<ProviderKey, ProviderConfig>,
    fallbackChain: fallbackChain.filter(k => k in activeProviders),
    loadBalanceGroups,
    maxRetries: envInt("MAX_RETRIES", DEFAULT_MAX_RETRIES),
    retryDelayMs: envInt("RETRY_DELAY_MS", DEFAULT_RETRY_DELAY_MS),
  };
}
