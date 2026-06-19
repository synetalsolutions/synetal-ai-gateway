/**
 * Multi-Model Headroom Proxy Server
 * Supports: fallback, load-balancing, WebSocket, streaming
 */

import * as http from "http";
import * as https from "https";
import * as crypto from "crypto";
import { WebSocketServer } from "ws";

import {
  ProviderKey,
  ProviderConfig,
  ChatCompletionPayload,
  RequestContext,
  CompressionResult,
  HealthStatus,
} from "./types";
import { loadConfig } from "./config";
import { log, logRequest, logError } from "./logger";
import { globalStats } from "./stats";
import { HeadroomClient } from "./headroom";
import { FallbackEngine } from "./fallback";
import {
  patchPayload,
  buildTargetHeaders,
  buildTargetPath,
} from "./patcher";
import {
  isStreamingRequest,
  makeRequest,
  makeStreamingRequest,
} from "./streaming";
import { globalCache } from "./cache";
import { detectPromptType, routePrompt, logRouting } from "./smart-router";
import { globalCostTracker } from "./cost-tracker";
import { isPreprocessEnabled, optimizePrompt, applyOptimizedPrompt, PreprocessResult } from "./preprocessor";

const CONFIG = loadConfig();
const headroomClient = new HeadroomClient(CONFIG.headroom);
const fallbackEngine = new FallbackEngine(CONFIG);

// ─── Request ID Generator ───────────────────────────────────────────────────
function generateRequestId(): string {
  return crypto.randomBytes(4).toString("hex");
}

// ─── CORS Headers ───────────────────────────────────────────────────────────
function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Provider, X-Model, X-Load-Balance, X-Auto-Route, X-Request-Id, X-Cache-Bypass"
  );
}

// ─── Proxy Authentication ───────────────────────────────────────────────────
const PROXY_API_KEY = process.env.PROXY_API_KEY;

function isAuthorized(req: http.IncomingMessage): boolean {
  // If no API key is configured, allow all requests (backward compatible)
  if (!PROXY_API_KEY || PROXY_API_KEY.length < 10) {
    return true;
  }
  const auth = req.headers["authorization"] || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token === PROXY_API_KEY;
}

function sendUnauthorized(res: http.ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: "Unauthorized",
      message: "Invalid or missing API key. Set Authorization: Bearer <your-proxy-api-key>",
    })
  );
}

// ─── Provider Health Check ──────────────────────────────────────────────────
async function checkProviderHealth(
  providerKey: ProviderKey,
  providerConfig: ProviderConfig
): Promise<{ reachable: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const options: https.RequestOptions = {
      hostname: providerConfig.host,
      port: 443,
      path: "/v1/models",
      method: "GET",
      headers: {
        authorization: `Bearer ${process.env[providerConfig.keyEnv] || "test"}`,
        host: providerConfig.host,
      },
      timeout: 5000,
    };

    const { statusCode } = await makeRequest(options, "");
    const latencyMs = Date.now() - start;
    // 401 is fine — means the endpoint exists, just auth needed
    return { reachable: statusCode === 401 || statusCode === 200, latencyMs };
  } catch {
    return { reachable: false, latencyMs: Date.now() - start };
  }
}

// ─── Execute Request to Provider ────────────────────────────────────────────
async function executeProviderRequest(
  providerKey: ProviderKey,
  payload: ChatCompletionPayload,
  reqHeaders: http.IncomingHttpHeaders,
  compressionResult: CompressionResult | null
): Promise<{
  success: boolean;
  statusCode?: number;
  headers?: http.IncomingHttpHeaders;
  body?: string;
  error?: string;
  streamingRes?: http.IncomingMessage;
}> {
  const providerConfig = CONFIG.providers[providerKey];
  const apiKey = process.env[providerConfig.keyEnv];

  if (!apiKey) {
    return { success: false, error: `Missing API key for ${providerKey}` };
  }

  const targetPath = buildTargetPath("/v1/chat/completions", providerConfig);
  const targetHeaders = buildTargetHeaders(reqHeaders, providerKey, apiKey, providerConfig);
  const patchedPayload = patchPayload(payload, providerKey);
  const body = JSON.stringify(patchedPayload);

  const options: https.RequestOptions = {
    hostname: providerConfig.host,
    port: 443,
    path: targetPath,
    method: "POST",
    headers: {
      ...targetHeaders,
      "content-length": Buffer.byteLength(body),
    },
    timeout: 60000,
  };

  try {
    if (isStreamingRequest(patchedPayload)) {
      const streamingRes = await makeStreamingRequest(options, body);
      return {
        success: streamingRes.statusCode === 200,
        statusCode: streamingRes.statusCode || undefined,
        headers: streamingRes.headers,
        streamingRes,
      };
    } else {
      const start = Date.now();
      const { statusCode, headers, body: responseBody } = await makeRequest(options, body);
      const latencyMs = Date.now() - start;

      globalStats.recordLatency(providerKey, latencyMs);

      const success = statusCode >= 200 && statusCode < 300;
      if (!success) {
        globalStats.recordError(providerKey, statusCode);
      }

      return {
        success,
        statusCode,
        headers,
        body: responseBody,
        error: success ? undefined : `HTTP ${statusCode}: ${responseBody.slice(0, 500)}`,
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    globalStats.recordError(providerKey);
    return { success: false, error: msg };
  }
}

// ─── Fallback Chain Execution ───────────────────────────────────────────────
async function executeWithFallback(
  queue: ProviderKey[],
  payload: ChatCompletionPayload,
  reqHeaders: http.IncomingHttpHeaders,
  compressionResult: CompressionResult | null,
  ctx: RequestContext
): Promise<{
  success: boolean;
  provider: ProviderKey;
  statusCode?: number;
  headers?: http.IncomingHttpHeaders;
  body?: string;
  streamingRes?: http.IncomingMessage;
  attempts: RequestContext["attempts"];
}> {
  const attempts = ctx.attempts;

  for (let i = 0; i < queue.length; i++) {
    const provider = queue[i];
    const attemptStart = Date.now();

    logRequest(ctx.requestId, provider, payload.model, i === 0 ? "Primary" : `Fallback[${i}]`);

    const result = await executeProviderRequest(provider, payload, reqHeaders, compressionResult);
    const latencyMs = Date.now() - attemptStart;

    attempts.push({
      provider,
      success: result.success,
      latencyMs,
      error: result.error,
      statusCode: result.statusCode,
    });

    if (result.success) {
      if (i > 0) {
        globalStats.recordFallback(queue[0], provider);
        log("warn", `[${ctx.requestId}] Fallback succeeded: ${queue[0]} → ${provider}`);
      }
      return { ...result, provider, attempts };
    }

    log("warn", `[${ctx.requestId}] ${provider} failed: ${result.error}`);

    // If retryable and not last in chain, wait before next attempt
    if (i < queue.length - 1 && fallbackEngine.isRetryableError(result.statusCode, result.error)) {
      log("info", `[${ctx.requestId}] Waiting ${CONFIG.retryDelayMs}ms before fallback...`);
      await fallbackEngine.sleep(CONFIG.retryDelayMs * (i + 1));
    }
  }

  return {
    success: false,
    provider: queue[queue.length - 1],
    attempts,
  };
}

// ─── Build HTTP Server ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ─── Proxy Authentication ─────────────────────────────────────────────────
  // Health check and public endpoints skip auth
  const publicPaths = ["/health", "/", "/stats"];
  const isPublic = publicPaths.includes(req.url || "");
  if (!isPublic && !isAuthorized(req)) {
    sendUnauthorized(res);
    return;
  }

  // ─── Health Check ────────────────────────────────────────────────────────
  if (req.url === "/health" || req.url === "/") {
    const providerHealth: HealthStatus["providerHealth"] = {} as any;

    await Promise.all(
      Object.entries(CONFIG.providers).map(async ([key, cfg]) => {
        const health = await checkProviderHealth(key as ProviderKey, cfg);
        providerHealth[key as ProviderKey] = health;
      })
    );

    const headroomHealth = await headroomClient.health();

    const overallStatus = Object.values(providerHealth).some((h) => h.reachable)
      ? "healthy"
      : "unhealthy";

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: overallStatus,
        proxy: "multi-model-headroom-proxy",
        version: "2.1.0",
        features: ["fallback", "load-balancing", "caching", "smart-routing", "cost-tracking"],
        headroom: headroomHealth ? "connected" : "disconnected",
        headroomUrl: CONFIG.headroom.baseUrl,
        providers: Object.keys(CONFIG.providers) as ProviderKey[],
        defaultProvider: CONFIG.defaultProvider,
        providerHealth,
      } as HealthStatus)
    );
    return;
  }

  // ─── Stats Endpoint ──────────────────────────────────────────────────────
  if (req.url === "/stats" && req.method === "GET") {
    const stats = globalStats.getStats();
    const latencySummary: Record<string, ReturnType<typeof globalStats.getProviderLatency>> = {};

    for (const provider of Object.keys(CONFIG.providers)) {
      latencySummary[provider] = globalStats.getProviderLatency(provider);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          ...stats,
          latencySummary,
          cache: globalCache.getStats(),
          rateLimit: {
            enabled: false,
            note: "Rate limiting disabled",
          },
        },
        null,
        2
      )
    );
    return;
  }

  // ─── Analytics / Cost Tracking Endpoint ───────────────────────────────────
  if (req.url === "/analytics" && req.method === "GET") {
    const summary = globalCostTracker.getSummary();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(summary, null, 2));
    return;
  }

  // ─── Cache Stats Endpoint ─────────────────────────────────────────────────
  if (req.url === "/cache/stats" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(globalCache.getStats(), null, 2));
    return;
  }

  // ─── Cache Clear Endpoint ─────────────────────────────────────────────────
  if (req.url === "/cache/clear" && req.method === "POST") {
    globalCache.clear();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", message: "Cache cleared" }));
    return;
  }

  // ─── Chat Completions with Fallback ──────────────────────────────────────
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const requestId = generateRequestId();

      try {
        let payload: ChatCompletionPayload = JSON.parse(body);
        const isStream = isStreamingRequest(payload);

        const ctx: RequestContext = {
          requestId,
          providerKey: CONFIG.defaultProvider,
          model: payload.model || "unknown",
          startTime: Date.now(),
          attempts: [],
          isStreaming: isStream,
        };

        // ── AI Gateway: Rate Limiting (DISABLED) ─────────────────────────
        const rateLimitKey = req.headers["authorization"] || `ip:${req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown"}`;
        const rateLimit = { allowed: true, remaining: 9999, resetInMs: 0 };
        const rateLimitStatus = { limit: 9999, remaining: 9999, resetInMs: 0 };

        // "synetal-ai" or "auto" triggers smart routing & preprocessing
        const modelIsAuto = payload.model === "synetal-ai" || payload.model === "auto" || payload.model === "automatic" || !payload.model;

        // ── AI Gateway: Prompt Preprocessor ──────────────────────────────
        // Optimizes raw/vague/hindi dev prompts using deepseek-flash before main agent sees them.
        // Auto-active for "synetal-ai" model, or via X-Preprocess: true header.
        const usePreprocess = req.headers["x-preprocess"] === "true" || modelIsAuto;
        let preprocessResult: PreprocessResult | null = null;
        if (isPreprocessEnabled() && usePreprocess && Array.isArray(payload.messages)) {
          preprocessResult = await optimizePrompt(payload.messages);
          if (preprocessResult.optimized) {
            payload = applyOptimizedPrompt(payload, preprocessResult);
            log("info", `[${requestId}] Preprocessor: optimized (${preprocessResult.latencyMs}ms)`);
          } else if (preprocessResult.skipped) {
            log("info", `[${requestId}] Preprocessor: skipped (${preprocessResult.skipReason})`);
          }
        }

        // ── AI Gateway: Smart Auto-Routing ───────────────────────────────
        const autoRoute = req.headers["x-auto-route"] === "true" || modelIsAuto;
        const cacheBypass = req.headers["x-cache-bypass"] === "true";
        let routingDecision = null;

        let queue: ProviderKey[] = [];

        if (autoRoute && Array.isArray(payload.messages)) {
          const promptType = detectPromptType(payload.messages);
          routingDecision = routePrompt(promptType, undefined, modelIsAuto ? undefined : payload.model);
          payload.model = routingDecision.model;
          logRouting(routingDecision);
          // Smart route: use detected provider as primary, then try ALL other working providers as fallback
          const primary = routingDecision.provider;
          const allOthers = (Object.keys(CONFIG.providers) as ProviderKey[]).filter(p => p !== primary);
          queue = [primary, ...allOthers.filter(p => CONFIG.providers[p])];
          ctx.providerKey = primary;
          log("info", `[${requestId}] SmartRoute(${modelIsAuto ? 'auto' : 'manual'}): ${promptType} → ${routingDecision.provider}/${routingDecision.model} | Fallback: ${queue.slice(1).join(',')}`);
        } else {
          // Build provider queue (with load balancing or explicit selection)
          const result = fallbackEngine.buildProviderQueue(payload, req.headers);
          queue = result.queue;
          ctx.providerKey = queue[0];
          log("info", `[${requestId}] Strategy: ${result.strategy}, Queue: ${queue.join(" → ")}`);
        }

        globalStats.recordRequest(ctx.providerKey);

        // ── AI Gateway: Response Caching ─────────────────────────────────
        if (!cacheBypass && !isStream) {
          const cached = globalCache.get(body, ctx.providerKey, payload.model);
          if (cached) {
            log("ok", `[${requestId}] Cache HIT for ${ctx.providerKey}/${payload.model}`);
            res.writeHead(cached.statusCode, {
              ...cached.headers,
              "x-cache": "HIT",
              "x-request-id": requestId,
            });
            res.end(cached.response);
            globalCostTracker.record(ctx.providerKey, payload.model, 0, 0, Date.now() - ctx.startTime, true);
            return;
          }
        }

        // ── Headroom Compression ──────────────────────────────────────────
        let compressionResult: CompressionResult | null = null;
        if (CONFIG.headroom.enabled && Array.isArray(payload.messages)) {
          try {
            compressionResult = await headroomClient.compress(
              payload.messages,
              payload.model
            );
            if (compressionResult.compressed) {
              payload.messages = compressionResult.messages;
              globalStats.recordCompression(compressionResult);
            }
          } catch (compressErr: unknown) {
            const msg = compressErr instanceof Error ? compressErr.message : String(compressErr);
            log("warn", `[${requestId}] Compression error, proceeding uncompressed: ${msg}`);
          }
        }

        // ── Execute with Fallback ─────────────────────────────────────────
        const result = await executeWithFallback(
          queue,
          payload,
          req.headers,
          compressionResult,
          ctx
        );

        if (!result.success) {
          const lastAttempt = result.attempts[result.attempts.length - 1];
          logError(requestId, `All providers failed. Last: ${lastAttempt?.error || "unknown"}`);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "All providers failed",
              requestId,
              attempts: result.attempts.map((a) => ({
                provider: a.provider,
                success: a.success,
                statusCode: a.statusCode,
                error: a.error,
                latencyMs: a.latencyMs,
              })),
            })
          );
          return;
        }

        // ── Streaming Response ────────────────────────────────────────────
        if (result.streamingRes) {
          // Add compression metadata header
          const outHeaders: Record<string, string | string[]> = { ...(result.headers as Record<string, string | string[]>) };
          delete outHeaders["content-length"]; // streaming has no fixed length

          if (compressionResult?.compressed) {
            const meta = {
              tokens_before: compressionResult.tokensBefore,
              tokens_after: compressionResult.tokensAfter,
              tokens_saved: compressionResult.tokensSaved,
              compression_ratio: compressionResult.compressionRatio,
              transforms: compressionResult.transformsApplied,
            };
            outHeaders["x-headroom-meta"] = Buffer.from(JSON.stringify(meta)).toString("base64");
          }
          outHeaders["x-request-id"] = requestId;
          outHeaders["x-provider"] = result.provider;

          res.writeHead(result.statusCode || 200, outHeaders);
          result.streamingRes.pipe(res);
          return;
        }

        // ── Non-Streaming Response ────────────────────────────────────────
        if (result.body) {
          // Try to inject metadata into response body
          let responseBody = result.body;
          try {
            const parsed = JSON.parse(result.body);

            // ── Strip reasoning_content: users only need final answer, not model's thought process ──
            if (Array.isArray(parsed.choices)) {
              for (const choice of parsed.choices) {
                if (choice.message) {
                  delete choice.message.reasoning_content;
                }
              }
            }

            if (compressionResult?.compressed) {
              parsed._headroom = {
                request_id: requestId,
                tokens_before: compressionResult.tokensBefore,
                tokens_after: compressionResult.tokensAfter,
                tokens_saved: compressionResult.tokensSaved,
                compression_ratio: compressionResult.compressionRatio,
                transforms: compressionResult.transformsApplied,
              };
            }
            parsed._proxy = {
              provider: result.provider,
              request_id: requestId,
              attempts: result.attempts.map((a) => ({
                provider: a.provider,
                success: a.success,
                latency_ms: a.latencyMs,
                status_code: a.statusCode,
              })),
            };
            responseBody = JSON.stringify(parsed);
          } catch {
            // If body isn't valid JSON, return as-is
          }

          const outHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            "x-request-id": requestId,
            "x-provider": result.provider,
            "x-cache": "MISS",
          };

          if (compressionResult?.compressed) {
            const meta = {
              tokens_before: compressionResult.tokensBefore,
              tokens_after: compressionResult.tokensAfter,
              tokens_saved: compressionResult.tokensSaved,
            };
            outHeaders["x-headroom-meta"] = Buffer.from(JSON.stringify(meta)).toString("base64");
          }

          // Store in cache
          if (!cacheBypass && !isStream) {
            globalCache.set(body, result.provider, payload.model, responseBody, result.statusCode || 200, outHeaders);
          }

          // Track cost
          try {
            const parsed = JSON.parse(result.body || "{}");
            const usage = parsed.usage || {};
            globalCostTracker.record(
              result.provider,
              payload.model,
              usage.prompt_tokens || 0,
              usage.completion_tokens || 0,
              Date.now() - ctx.startTime,
              false
            );
          } catch {
            // ignore parse errors
          }

          res.writeHead(result.statusCode || 200, outHeaders);
          res.end(responseBody);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(requestId, msg);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "bad request", detail: msg, requestId }));
      }
    });
    return;
  }

  // ─── Multi-Model: Send to multiple models simultaneously ────────────────
  if (req.url === "/v1/chat/completions/multi" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const requestId = generateRequestId();

      try {
        const payload: ChatCompletionPayload = JSON.parse(body);

        // Models list from header or body
        const modelsHeader = req.headers["x-models"] as string;
        const models: Array<{ provider: ProviderKey; model: string }> = [];

        if (modelsHeader) {
          // Format: "kimi:kimi-k2.6,deepseek:deepseek-v4-pro,xiaomi:mimo-v2.5-pro"
          for (const entry of modelsHeader.split(",")) {
            const [prov, mod] = entry.trim().split(":");
            if (prov && mod) {
              models.push({ provider: prov.trim() as ProviderKey, model: mod.trim() });
            }
          }
        }

        // Fallback: body.models array
        if (models.length === 0 && Array.isArray((payload as any).models)) {
          for (const entry of (payload as any).models) {
            if (typeof entry === "string") {
              const [prov, mod] = entry.split(":");
              models.push({ provider: (prov || CONFIG.defaultProvider) as ProviderKey, model: mod || entry });
            } else if (entry.provider && entry.model) {
              models.push({ provider: entry.provider as ProviderKey, model: entry.model });
            }
          }
        }

        if (models.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "No models specified",
            usage: 'Header: X-Models: "kimi:kimi-k2.6,deepseek:deepseek-v4-pro" or Body: {"models": ["kimi:kimi-k2.6"]}'
          }));
          return;
        }

        log("info", `[${requestId}] Multi-model request to ${models.length} models: ${models.map(m => `${m.provider}/${m.model}`).join(", ")}`);

        // Send to all models in parallel
        const results = await Promise.allSettled(
          models.map(async ({ provider, model }) => {
            const start = Date.now();
            const msgPayload: ChatCompletionPayload = { ...payload, model };
            const result = await executeProviderRequest(provider, msgPayload, req.headers, null);
            const latencyMs = Date.now() - start;

            return {
              provider,
              model,
              success: result.success,
              statusCode: result.statusCode,
              latencyMs,
              content: result.body ? (() => {
                try {
                  const parsed = JSON.parse(result.body);
                  return parsed.choices?.[0]?.message?.content || null;
                } catch { return null; }
              })() : null,
              reasoning: result.body ? (() => {
                try {
                  const parsed = JSON.parse(result.body);
                  return parsed.choices?.[0]?.message?.reasoning_content || null;
                } catch { return null; }
              })() : null,
              usage: result.body ? (() => {
                try {
                  return JSON.parse(result.body).usage || null;
                } catch { return null; }
              })() : null,
              error: result.error || undefined,
            };
          })
        );

        const responses = results.map((r) =>
          r.status === "fulfilled" ? r.value : { success: false, error: r.reason?.message || "Unknown error" }
        );

        const elapsed = Date.now();
        res.writeHead(200, { "Content-Type": "application/json", "x-request-id": requestId });
        res.end(JSON.stringify({
          requestId,
          models_requested: models.length,
          models_responded: responses.filter((r) => r.success).length,
          responses,
        }, null, 2));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(requestId, msg);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "bad request", detail: msg, requestId }));
      }
    });
    return;
  }

  // ─── Generic Passthrough ─────────────────────────────────────────────────
  const providerKey = (req.headers["x-provider"] as ProviderKey) || CONFIG.defaultProvider;
  const providerConfig = CONFIG.providers[providerKey];

  if (!providerConfig) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Unknown provider: ${providerKey}` }));
    return;
  }

  const apiKey = process.env[providerConfig.keyEnv];
  if (!apiKey) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Missing API key for ${providerKey}` }));
    return;
  }

  const targetPath = buildTargetPath(req.url || "/", providerConfig);
  const targetHeaders = buildTargetHeaders(req.headers, providerKey, apiKey, providerConfig);

  const options: https.RequestOptions = {
    hostname: providerConfig.host,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: targetHeaders,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    log("error", "Upstream error:", err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
});

// ─── WebSocket Server ───────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

interface WSMessage {
  type: "chat" | "ping" | "subscribe";
  id?: string;
  payload?: ChatCompletionPayload;
  model?: string;
  provider?: ProviderKey;
}

wss.on("connection", (ws, req) => {
  const clientId = generateRequestId();

  // WebSocket auth: check query param ?token=xxx or header
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const wsToken = url.searchParams.get("token") || "";
  const wsAuthHeader = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
  if (PROXY_API_KEY && PROXY_API_KEY.length >= 10) {
    if (wsToken !== PROXY_API_KEY && wsAuthHeader !== PROXY_API_KEY) {
      log("warn", `WebSocket auth failed from ${req.socket.remoteAddress}`);
      ws.send(JSON.stringify({ type: "error", error: "Unauthorized: invalid or missing token" }));
      ws.close(1008, "Unauthorized");
      return;
    }
  }

  log("ok", `WebSocket client connected: ${clientId} from ${req.socket.remoteAddress}`);

  ws.send(
    JSON.stringify({
      type: "connected",
      clientId,
      providers: Object.keys(CONFIG.providers),
      defaultProvider: CONFIG.defaultProvider,
    })
  );

  ws.on("message", async (data) => {
    try {
      const msg: WSMessage = JSON.parse(data.toString());

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        return;
      }

      if (msg.type === "chat" && msg.payload) {
        const requestId = generateRequestId();
        const payload = msg.payload;
        const isStream = isStreamingRequest(payload);

        const providerKey =
          msg.provider || fallbackEngine.detectProvider(msg.model || payload.model);
        const queue = fallbackEngine.getFallbackChain(providerKey);

        const ctx: RequestContext = {
          requestId,
          providerKey,
          model: payload.model || "unknown",
          startTime: Date.now(),
          attempts: [],
          isStreaming: isStream,
        };

        // Compression
        let compressionResult: CompressionResult | null = null;
        if (CONFIG.headroom.enabled && Array.isArray(payload.messages)) {
          try {
            compressionResult = await headroomClient.compress(payload.messages, payload.model);
            if (compressionResult.compressed) {
              payload.messages = compressionResult.messages;
            }
          } catch {
            // proceed uncompressed
          }
        }

        const result = await executeWithFallback(queue, payload, {}, compressionResult, ctx);

        if (!result.success) {
          ws.send(
            JSON.stringify({
              type: "error",
              requestId,
              error: "All providers failed",
              attempts: result.attempts,
            })
          );
          return;
        }

        if (result.streamingRes) {
          ws.send(
            JSON.stringify({
              type: "stream_start",
              requestId,
              provider: result.provider,
              compression: compressionResult?.compressed
                ? {
                    tokens_before: compressionResult.tokensBefore,
                    tokens_after: compressionResult.tokensAfter,
                    tokens_saved: compressionResult.tokensSaved,
                  }
                : null,
            })
          );

          result.streamingRes.on("data", (chunk: Buffer) => {
            ws.send(
              JSON.stringify({
                type: "stream_chunk",
                requestId,
                data: chunk.toString(),
              })
            );
          });

          result.streamingRes.on("end", () => {
            ws.send(JSON.stringify({ type: "stream_end", requestId }));
          });

          result.streamingRes.on("error", (err: Error) => {
            ws.send(
              JSON.stringify({ type: "stream_error", requestId, error: err.message })
            );
          });
        } else if (result.body) {
          ws.send(
            JSON.stringify({
              type: "response",
              requestId,
              provider: result.provider,
              payload: JSON.parse(result.body),
              compression: compressionResult?.compressed
                ? {
                    tokens_before: compressionResult.tokensBefore,
                    tokens_after: compressionResult.tokensAfter,
                    tokens_saved: compressionResult.tokensSaved,
                  }
                : null,
            })
          );
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      ws.send(JSON.stringify({ type: "error", error: msg }));
    }
  });

  ws.on("close", () => {
    log("info", `WebSocket client disconnected: ${clientId}`);
  });

  ws.on("error", (err) => {
    log("error", `WebSocket error for ${clientId}:`, err.message);
  });
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────
process.on("SIGINT", () => {
  log("info", "\nShutting down gracefully...");
  wss.close(() => {
    log("ok", "WebSocket server closed.");
  });
  server.close(() => {
    log("ok", "HTTP server closed.");
    process.exit(0);
  });
});

// ─── Startup ────────────────────────────────────────────────────────────────
server.listen(CONFIG.proxyPort, "0.0.0.0", () => {
  log("ok", `Multi-Model Headroom Proxy v2.0.0 listening on http://0.0.0.0:${CONFIG.proxyPort}`);
  log("info", `WebSocket endpoint: ws://0.0.0.0:${CONFIG.proxyPort}/ws`);
  log("info", `Headroom compression: ${CONFIG.headroom.enabled ? "ENABLED" : "DISABLED"}`);
  if (CONFIG.headroom.enabled) {
    log("info", `  → Headroom proxy: ${CONFIG.headroom.baseUrl}`);
    log("info", `  → Fallback on error: ${CONFIG.headroom.fallback}`);
  }
  log("info", `Supported providers: ${Object.keys(CONFIG.providers).join(", ")}`);
  log("info", `Default provider: ${CONFIG.defaultProvider}`);
  log("info", `Fallback chain: ${CONFIG.fallbackChain.join(" → ")}`);
  log("info", `Load balance groups: ${JSON.stringify(CONFIG.loadBalanceGroups)}`);
  log("info", "");
  log("info", "Usage examples:");
  log("info", `  curl http://localhost:${CONFIG.proxyPort}/health`);
  log("info", `  curl http://localhost:${CONFIG.proxyPort}/v1/chat/completions -H "Content-Type: application/json" -H "X-Provider: deepseek" -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hello"}]}'`);
  log("info", "");
  log("info", "Load balancing:");
  log("info", `  curl ... -H "X-Load-Balance: true" -d '{"model":"deepseek-chat",...}'`);
  log("info", "");
  log("info", "WebSocket:");
  log("info", `  ws://localhost:${CONFIG.proxyPort}/ws`);
});
