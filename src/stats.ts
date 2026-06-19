/**
 * In-memory statistics tracker for the proxy
 */

import { ProxyStats, FallbackAttempt, CompressionResult } from "./types";

export class StatsTracker {
  private stats: ProxyStats;

  constructor() {
    this.stats = {
      totalRequests: 0,
      compressedRequests: 0,
      totalTokensBefore: 0,
      totalTokensAfter: 0,
      totalTokensSaved: 0,
      providerCounts: {},
      fallbackCounts: {},
      errorCounts: {},
      latencyMs: {},
    };
  }

  recordRequest(provider: string): void {
    this.stats.totalRequests++;
    this.stats.providerCounts[provider] = (this.stats.providerCounts[provider] || 0) + 1;
  }

  recordCompression(result: CompressionResult): void {
    if (!result.compressed) return;
    this.stats.compressedRequests++;
    this.stats.totalTokensBefore += result.tokensBefore;
    this.stats.totalTokensAfter += result.tokensAfter;
    this.stats.totalTokensSaved += result.tokensSaved;
  }

  recordFallback(fromProvider: string, toProvider: string): void {
    const key = `${fromProvider}→${toProvider}`;
    this.stats.fallbackCounts[key] = (this.stats.fallbackCounts[key] || 0) + 1;
  }

  recordError(provider: string, statusCode?: number): void {
    const key = statusCode ? `${provider}:${statusCode}` : provider;
    this.stats.errorCounts[key] = (this.stats.errorCounts[key] || 0) + 1;
  }

  recordLatency(provider: string, latencyMs: number): void {
    if (!this.stats.latencyMs[provider]) {
      this.stats.latencyMs[provider] = [];
    }
    this.stats.latencyMs[provider].push(latencyMs);
    // Keep last 1000 entries to prevent unbounded growth
    if (this.stats.latencyMs[provider].length > 1000) {
      this.stats.latencyMs[provider] = this.stats.latencyMs[provider].slice(-1000);
    }
  }

  getStats(): ProxyStats {
    return { ...this.stats };
  }

  getProviderLatency(provider: string): { avg: number; p50: number; p95: number; p99: number } | null {
    const arr = this.stats.latencyMs[provider];
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    return { avg, p50, p95, p99 };
  }

  reset(): void {
    this.stats = {
      totalRequests: 0,
      compressedRequests: 0,
      totalTokensBefore: 0,
      totalTokensAfter: 0,
      totalTokensSaved: 0,
      providerCounts: {},
      fallbackCounts: {},
      errorCounts: {},
      latencyMs: {},
    };
  }
}

export const globalStats = new StatsTracker();
