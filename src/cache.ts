/**
 * Response cache — like Cloudflare AI Gateway Caching
 * Stores responses for identical requests, reduces latency & cost.
 */

import * as crypto from "crypto";

interface CacheEntry {
  response: string;
  statusCode: number;
  headers: Record<string, string>;
  expiresAt: number;
  hits: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  bytesStored: number;
}

export class ResponseCache {
  private store: Map<string, CacheEntry> = new Map();
  private stats: CacheStats = { hits: 0, misses: 0, size: 0, bytesStored: 0 };
  private defaultTtlMs: number;
  private maxSize: number;
  private maxBytes: number;

  constructor(options: { defaultTtlMs?: number; maxSize?: number; maxBytes?: number } = {}) {
    this.defaultTtlMs = options.defaultTtlMs || 5 * 60 * 1000; // 5 minutes
    this.maxSize = options.maxSize || 1000;
    this.maxBytes = options.maxBytes || 50 * 1024 * 1024; // 50MB

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60_000);
  }

  /**
   * Generate cache key from request body + provider + model
   */
  private makeKey(body: string, provider: string, model: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(`${provider}:${model}:${body}`);
    return hash.digest("hex");
  }

  /**
   * Get cached response if available and not expired
   */
  get(body: string, provider: string, model: string): { response: string; statusCode: number; headers: Record<string, string> } | null {
    const key = this.makeKey(body, provider, model);
    const entry = this.store.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.stats.misses++;
      return null;
    }

    entry.hits++;
    this.stats.hits++;
    return {
      response: entry.response,
      statusCode: entry.statusCode,
      headers: entry.headers,
    };
  }

  /**
   * Store response in cache
   */
  set(body: string, provider: string, model: string, response: string, statusCode: number, headers: Record<string, string>, ttlMs?: number): void {
    // Don't cache error responses or streaming
    if (statusCode >= 400) return;
    if (body.includes('"stream":true')) return;

    const key = this.makeKey(body, provider, model);
    const ttl = ttlMs || this.defaultTtlMs;

    // Evict oldest if at max size
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }

    this.store.set(key, {
      response,
      statusCode,
      headers,
      expiresAt: Date.now() + ttl,
      hits: 0,
    });

    this.stats.size = this.store.size;
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.store.clear();
    this.stats.size = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { hitRate: string } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) : "0.0";
    return { ...this.stats, hitRate: `${hitRate}%` };
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
    this.stats.size = this.store.size;
  }
}

export const globalCache = new ResponseCache();
