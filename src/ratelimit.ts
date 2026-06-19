/**
 * Rate limiter — like Cloudflare AI Gateway Rate Limiting
 * Prevents API quota exhaustion and controls costs.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimitConfig {
  requestsPerWindow: number;
  windowMs: number;
}

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = { requestsPerWindow: 60, windowMs: 60_000 }) {
    this.config = config;
    // Cleanup every window interval
    setInterval(() => this.cleanup(), this.config.windowMs);
  }

  /**
   * Check if request is allowed. Returns true if within limit.
   */
  isAllowed(key: string): { allowed: boolean; remaining: number; resetInMs: number } {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.windowStart + this.config.windowMs) {
      // New window
      this.store.set(key, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: this.config.requestsPerWindow - 1,
        resetInMs: this.config.windowMs,
      };
    }

    if (entry.count >= this.config.requestsPerWindow) {
      return {
        allowed: false,
        remaining: 0,
        resetInMs: entry.windowStart + this.config.windowMs - now,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: this.config.requestsPerWindow - entry.count,
      resetInMs: entry.windowStart + this.config.windowMs - now,
    };
  }

  /**
   * Get current rate limit status for a key
   */
  getStatus(key: string): { limit: number; remaining: number; resetInMs: number } {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.windowStart + this.config.windowMs) {
      return { limit: this.config.requestsPerWindow, remaining: this.config.requestsPerWindow, resetInMs: 0 };
    }

    return {
      limit: this.config.requestsPerWindow,
      remaining: Math.max(0, this.config.requestsPerWindow - entry.count),
      resetInMs: Math.max(0, entry.windowStart + this.config.windowMs - now),
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.windowStart + this.config.windowMs) {
        this.store.delete(key);
      }
    }
  }
}

export const globalRateLimiter = new RateLimiter({
  requestsPerWindow: parseInt(process.env.RATE_LIMIT_RPM || "500", 10),
  windowMs: 60_000,
});
