/**
 * Fallback and load-balancing engine
 */

import {
  ProviderKey,
  ProviderConfig,
  FallbackAttempt,
  ProxyConfig,
  ChatCompletionPayload,
} from "./types";
import { log } from "./logger";
import { globalStats } from "./stats";

export class FallbackEngine {
  private config: ProxyConfig;
  /** Round-robin indices per load-balance group */
  private lbIndices: Map<string, number> = new Map();

  constructor(config: ProxyConfig) {
    this.config = config;
  }

  /**
   * Detect provider from model name, header, or default
   */
  detectProvider(model?: string, headerProvider?: string): ProviderKey {
    if (headerProvider && headerProvider in this.config.providers) {
      return headerProvider as ProviderKey;
    }
    if (!model) return this.config.defaultProvider;

    const m = model.toLowerCase();
    if (m.includes("kimi") || m.includes("moonshot")) return "kimi";
    if (m.includes("deepseek")) return "deepseek";
    if (m.includes("glm")) return "glm";
    if (m.includes("claude") || m.includes("anthropic")) return "anthropic";
    if (m.includes("gpt") || m.includes("o1") || m.includes("o3")) return "openai";
    if (m.includes("xiaomi") || m.includes("mimo")) return "xiaomi";
    if (m.includes("k2.7-code") || m.includes("k2.7")) return "kimi";

    return this.config.defaultProvider;
  }

  /**
   * Determine load-balance group from model characteristics
   */
  private getLoadBalanceGroup(model: string): string | null {
    const m = model.toLowerCase();
    if (m.includes("reasoner") || m.includes("thinking") || m.includes("o1") || m.includes("o3")) {
      return "reasoning";
    }
    if (m.includes("code") || m.includes("coder")) {
      return "coding";
    }
    if (m.includes("vision") || m.includes("image") || m.includes("gpt-4o")) {
      return "vision";
    }
    return "general";
  }

  /**
   * Select provider via load balancing for a model
   */
  selectLoadBalancedProvider(model: string): ProviderKey {
    const group = this.getLoadBalanceGroup(model);
    if (!group) {
      return this.detectProvider(model);
    }
    const candidates = this.config.loadBalanceGroups[group];

    if (!candidates || candidates.length === 0) {
      return this.detectProvider(model);
    }

    // Round-robin selection
    const current = this.lbIndices.get(group) || 0;
    const selected = candidates[current % candidates.length];
    this.lbIndices.set(group, current + 1);

    log("info", `LoadBalance [${group}]: selected ${selected} (round ${current + 1})`);
    return selected;
  }

  /**
   * Get fallback chain for a provider.
   * The chain starts with the primary, then tries configured fallbacks.
   */
  getFallbackChain(primary: ProviderKey): ProviderKey[] {
    const chain = [primary];
    for (const fb of this.config.fallbackChain) {
      if (fb !== primary && !chain.includes(fb)) {
        chain.push(fb);
      }
    }
    return chain;
  }

  /**
   * Check if an error is retryable
   */
  isRetryableError(statusCode?: number, errorMessage?: string): boolean {
    if (statusCode) {
      // 429 = rate limit, 502/503/504 = gateway errors, 500 = server error
      if ([429, 500, 502, 503, 504].includes(statusCode)) return true;
    }
    if (errorMessage) {
      const retryablePatterns = [
        "rate limit",
        "too many requests",
        "timeout",
        "econnreset",
        "socket hang up",
        "temporary",
        "overloaded",
      ];
      const lower = errorMessage.toLowerCase();
      return retryablePatterns.some((p) => lower.includes(p));
    }
    return false;
  }

  /**
   * Build the list of providers to try, in order.
   * Supports:
   *   - Load balancing (if X-Load-Balance: true)
   *   - Direct provider selection
   *   - Fallback chain
   */
  buildProviderQueue(
    payload: ChatCompletionPayload,
    headers: Record<string, string | string[] | undefined>
  ): { queue: ProviderKey[]; strategy: string } {
    const headerProvider = headers["x-provider"] as string | undefined;
    const useLoadBalance = headers["x-load-balance"] === "true";

    if (headerProvider) {
      // Explicit provider requested
      const chain = this.getFallbackChain(headerProvider as ProviderKey);
      return { queue: chain, strategy: "explicit" };
    }

    if (useLoadBalance) {
      const selected = this.selectLoadBalancedProvider(payload.model);
      const chain = this.getFallbackChain(selected);
      return { queue: chain, strategy: "loadbalance" };
    }

    // Auto-detect from model name
    const detected = this.detectProvider(payload.model);
    const chain = this.getFallbackChain(detected);
    return { queue: chain, strategy: "auto" };
  }

  /**
   * Sleep helper for retry delays
   */
  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
