/**
 * Cost tracker — like Cloudflare AI Gateway Analytics
 * Tracks tokens, costs, latency per provider/model.
 */

export interface CostEntry {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  timestamp: number;
  cached: boolean;
}

// Rough pricing per 1M tokens (input/output) — update with actual pricing
const PRICING: Record<string, { input: number; output: number }> = {
  "deepseek-v4-pro": { input: 0.5, output: 2.0 },
  "deepseek-v4-flash": { input: 0.1, output: 0.5 },
  "mimo-v2.5-pro": { input: 0.3, output: 1.2 },
  "mimo-v2.5": { input: 0.2, output: 0.8 },
  "kimi-k2.6": { input: 0.5, output: 2.0 },
  "kimi-k2.5": { input: 0.3, output: 1.2 },
  "kimi-k2.7-code": { input: 0.5, output: 2.0 },
  "moonshot-v1-auto": { input: 0.3, output: 1.0 },
  "moonshot-v1-32k-vision-preview": { input: 0.5, output: 2.0 },
  "glm-5.2": { input: 0.3, output: 1.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
};

export class CostTracker {
  private entries: CostEntry[] = [];
  private maxEntries: number = 10_000;

  record(
    provider: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    latencyMs: number,
    cached: boolean = false
  ): CostEntry {
    const pricing = PRICING[model] || { input: 0.5, output: 2.0 };
    const promptCost = (promptTokens / 1_000_000) * pricing.input;
    const completionCost = (completionTokens / 1_000_000) * pricing.output;
    const estimatedCostUsd = cached ? 0 : promptCost + completionCost;

    const entry: CostEntry = {
      provider,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUsd,
      latencyMs,
      timestamp: Date.now(),
      cached,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    return entry;
  }

  getSummary(): {
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
    avgLatencyMs: number;
    byProvider: Record<string, { requests: number; tokens: number; cost: number }>;
    byModel: Record<string, { requests: number; tokens: number; cost: number }>;
  } {
    const byProvider: Record<string, { requests: number; tokens: number; cost: number }> = {};
    const byModel: Record<string, { requests: number; tokens: number; cost: number }> = {};

    let totalTokens = 0;
    let totalCost = 0;
    let totalLatency = 0;

    for (const e of this.entries) {
      totalTokens += e.totalTokens;
      totalCost += e.estimatedCostUsd;
      totalLatency += e.latencyMs;

      if (!byProvider[e.provider]) {
        byProvider[e.provider] = { requests: 0, tokens: 0, cost: 0 };
      }
      byProvider[e.provider].requests++;
      byProvider[e.provider].tokens += e.totalTokens;
      byProvider[e.provider].cost += e.estimatedCostUsd;

      if (!byModel[e.model]) {
        byModel[e.model] = { requests: 0, tokens: 0, cost: 0 };
      }
      byModel[e.model].requests++;
      byModel[e.model].tokens += e.totalTokens;
      byModel[e.model].cost += e.estimatedCostUsd;
    }

    return {
      totalRequests: this.entries.length,
      totalTokens,
      totalCostUsd: totalCost,
      avgLatencyMs: this.entries.length > 0 ? totalLatency / this.entries.length : 0,
      byProvider,
      byModel,
    };
  }

  getRecent(limit: number = 50): CostEntry[] {
    return this.entries.slice(-limit);
  }
}

export const globalCostTracker = new CostTracker();
