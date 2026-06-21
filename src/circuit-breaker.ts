/**
 * Circuit Breaker — protects against cascading failures
 *
 * When a provider hits rate limits (429) or repeated failures,
 * the circuit "opens" and blocks requests to it for a cooldown period.
 *
 * States (like Kafka's consumer lag protection):
 *   CLOSED    → Normal operation, requests flow
 *   OPEN      → Provider blocked (cooldown period)
 *   HALF_OPEN → Testing recovery (allows 1 probe request)
 *
 * This prevents the proxy from wasting time + money on a broken/rate-limited
 * provider by instantly falling back to the next available provider.
 */

import { ProviderKey } from "./types";
import { log } from "./logger";

interface CircuitState {
  state: "closed" | "open" | "half-open";
  consecutiveFailures: number;
  lastFailureTime: number;
  openedAt: number;
  cooldownMs: number;
  failureReason: string;
}

// Cooldown durations (ms) by error type
const COOLDOWNS = {
  rate_limit: 60_000,     // 60s — GLM gives 60s rate limit windows
  context_limit: 0,       // No cooldown — this is a per-request issue, not provider-wide
  timeout: 10_000,        // 10s
  other: 5_000,           // 5s
};

// How many consecutive failures before tripping (by error type)
const THRESHOLDS = {
  rate_limit: 1,          // Trip immediately on rate limit
  context_limit: 0,       // Never trip (per-request issue)
  timeout: 3,             // 3 timeouts = trip
  other: 5,               // 5 other errors = trip
};

const circuits: Record<string, CircuitState> = {};

function getCircuit(provider: string): CircuitState {
  if (!circuits[provider]) {
    circuits[provider] = {
      state: "closed",
      consecutiveFailures: 0,
      lastFailureTime: 0,
      openedAt: 0,
      cooldownMs: 0,
      failureReason: "",
    };
  }
  return circuits[provider];
}

/**
 * Check if a provider is available to accept requests.
 * Takes circuit breaker state into account.
 *
 * @returns true if requests can be sent to this provider
 */
export function isProviderAvailable(provider: string): boolean {
  const cb = getCircuit(provider);
  const now = Date.now();

  if (cb.state === "open") {
    // Check if cooldown has elapsed
    if (now - cb.openedAt >= cb.cooldownMs) {
      // Transition to half-open — allow 1 probe request
      cb.state = "half-open";
      log("info", `[CircuitBreaker] ${provider}: OPEN → HALF-OPEN (probe)`);
      return true;
    }
    return false; // Still in cooldown — skip this provider
  }

  // closed or half-open → allow request
  return true;
}

/**
 * Record a provider failure. May trip the circuit breaker.
 *
 * @param provider Provider name (e.g. "glm", "deepseek")
 * @param errorType Type of error that occurred
 */
export function recordFailure(
  provider: string,
  errorType: "rate_limit" | "timeout" | "context_limit" | "other"
): void {
  // Context limit errors are per-request, not provider-wide — don't trip
  if (errorType === "context_limit" || THRESHOLDS[errorType] === 0) return;

  const cb = getCircuit(provider);
  cb.consecutiveFailures++;
  cb.lastFailureTime = Date.now();

  const threshold = THRESHOLDS[errorType];
  const cooldownMs = COOLDOWNS[errorType];

  if (cb.consecutiveFailures >= threshold && cb.state !== "open") {
    cb.state = "open";
    cb.openedAt = Date.now();
    cb.cooldownMs = cooldownMs;
    cb.failureReason = errorType;
    log(
      "warn",
      `[CircuitBreaker] ${provider}: → OPEN (${errorType}, ${cb.consecutiveFailures} failures, cooldown ${cooldownMs / 1000}s)`
    );
  }
}

/**
 * Record a provider success. Resets the circuit breaker.
 */
export function recordSuccess(provider: string): void {
  const cb = getCircuit(provider);
  if (cb.state === "half-open") {
    log("ok", `[CircuitBreaker] ${provider}: HALF-OPEN → CLOSED (recovered)`);
  }
  cb.consecutiveFailures = 0;
  cb.state = "closed";
}

/**
 * Get current circuit states for health endpoint.
 */
export function getCircuitStatus(): Record<string, string> {
  const status: Record<string, string> = {};
  for (const [provider, cb] of Object.entries(circuits)) {
    status[provider] = cb.state;
  }
  return status;
}

/**
 * Filter a provider queue to only include available providers.
 * Called before executing the fallback chain to skip blocked providers.
 */
export function filterAvailable(queue: ProviderKey[]): ProviderKey[] {
  return queue.filter(p => isProviderAvailable(p));
}

/**
 * Categorize an HTTP error into breaker error types.
 */
export function categorizeError(
  statusCode: number,
  errorBody: string
): "rate_limit" | "timeout" | "context_limit" | "other" {
  const body = errorBody.toLowerCase();

  if (statusCode === 429 || body.includes("rate limit") || body.includes("insufficient balance")) {
    return "rate_limit";
  }
  if (body.includes("token limit") || body.includes("exceeded") || body.includes("context length")) {
    return "context_limit";
  }
  if (body.includes("timeout") || body.includes("timed out")) {
    return "timeout";
  }
  return "other";
}
