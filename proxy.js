#!/usr/bin/env node
/**
 * Multi-Model LLM Proxy with Headroom Context Compression
 *
 * Supports: OpenAI, Kimi (Moonshot), DeepSeek, GLM-4 (Zhipu), Anthropic, and more.
 * Integrates Headroom AI for 60-95% token savings on context before sending to LLM.
 *
 * Usage:
 *   1. Start Headroom proxy:  headroom proxy --port 8787
 *   2. Start this proxy:      node proxy.js
 *   3. Point your app to:     http://localhost:3456
 *
 * Environment Variables:
 *   - PROXY_PORT              : Port for this proxy (default: 3456)
 *   - HEADROOM_BASE_URL       : Headroom proxy URL (default: http://localhost:8787)
 *   - HEADROOM_API_KEY        : Headroom Cloud API key (optional)
 *   - HEADROOM_ENABLED        : Enable/disable compression (default: true)
 *   - HEADROOM_MODEL          : Model name for Headroom token counting (default: gpt-4o)
 *   - HEADROOM_FALLBACK       : Fallback to uncompressed if Headroom fails (default: true)
 *   - KIMI_API_KEY            : Kimi API key
 *   - DEEPSEEK_API_KEY        : DeepSeek API key
 *   - GLM_API_KEY             : GLM (Zhipu) API key
 *   - OPENAI_API_KEY          : OpenAI API key
 *   - ANTHROPIC_API_KEY       : Anthropic API key
 *   - DEFAULT_PROVIDER        : Default provider if not specified (default: kimi)
 */

const http = require("http");
const https = require("https");
const url = require("url");

// ─── Configuration ──────────────────────────────────────────────────────────
const CONFIG = {
  proxyPort: parseInt(process.env.PROXY_PORT, 10) || 3456,
  headroom: {
    enabled: process.env.HEADROOM_ENABLED !== "false",
    baseUrl: process.env.HEADROOM_BASE_URL || "http://localhost:8787",
    apiKey: process.env.HEADROOM_API_KEY || undefined,
    model: process.env.HEADROOM_MODEL || "gpt-4o",
    fallback: process.env.HEADROOM_FALLBACK !== "false",
  },
  defaultProvider: process.env.DEFAULT_PROVIDER || "kimi",
  providers: {
    kimi: {
      host: "api.moonshot.cn",
      keyEnv: "KIMI_API_KEY",
      // Kimi requires top_p = 0.95 for some models
      forceTopP: 0.95,
      // Kimi thinking model requires reasoning_content on assistant tool_calls
      backfillReasoning: true,
    },
    deepseek: {
      host: "api.deepseek.com",
      keyEnv: "DEEPSEEK_API_KEY",
      // DeepSeek supports reasoning_effort parameter
    },
    glm: {
      host: "open.bigmodel.cn",
      keyEnv: "GLM_API_KEY",
      basePath: "/api/paas/v4",
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
  },
};

// ─── Logging ────────────────────────────────────────────────────────────────
function log(level, ...args) {
  const ts = new Date().toISOString();
  const color = {
    info: "\x1b[36m",    // cyan
    ok: "\x1b[32m",      // green
    warn: "\x1b[33m",    // yellow
    error: "\x1b[31m",   // red
    reset: "\x1b[0m",
  };
  const c = color[level] || color.info;
  console.log(`${c}[${ts}] [${level.toUpperCase()}]${color.reset}`, ...args);
}

// ─── Headroom Compression ───────────────────────────────────────────────────
/**
 * Compress messages using Headroom proxy HTTP API.
 * Falls back to original messages if compression fails (unless configured otherwise).
 */
async function compressWithHeadroom(messages, model) {
  if (!CONFIG.headroom.enabled) {
    return { messages, compressed: false, tokensBefore: 0, tokensAfter: 0, tokensSaved: 0 };
  }

  const compressUrl = `${CONFIG.headroom.baseUrl}/v1/compress`;
  const headers = {
    "Content-Type": "application/json",
  };
  if (CONFIG.headroom.apiKey) {
    headers["Authorization"] = `Bearer ${CONFIG.headroom.apiKey}`;
  }

  const body = JSON.stringify({
    messages,
    model: model || CONFIG.headroom.model,
  });

  try {
    const res = await fetch(compressUrl, {
      method: "POST",
      headers,
      body,
      timeout: 30000,
    });

    if (!res.ok) {
      throw new Error(`Headroom proxy returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();

    log(
      "ok",
      `Headroom: ${data.tokens_before} → ${data.tokens_after} tokens ` +
        `(-${data.tokens_saved}, ${((1 - data.compression_ratio) * 100).toFixed(0)}%) ` +
        `[${data.transforms_applied?.join(", ") || "none"}]`
    );

    return {
      messages: data.messages,
      compressed: true,
      tokensBefore: data.tokens_before,
      tokensAfter: data.tokens_after,
      tokensSaved: data.tokens_saved,
      compressionRatio: data.compression_ratio,
      transformsApplied: data.transforms_applied,
      ccrHashes: data.ccr_hashes,
    };
  } catch (err) {
    log("warn", "Headroom compression failed:", err.message);
    if (!CONFIG.headroom.fallback) {
      throw err;
    }
    return { messages, compressed: false, tokensBefore: 0, tokensAfter: 0, tokensSaved: 0 };
  }
}

// ─── Provider Detection ─────────────────────────────────────────────────────
/**
 * Detect provider from model name or request headers.
 */
function detectProvider(model) {
  if (!model) return CONFIG.defaultProvider;
  const m = model.toLowerCase();

  if (m.includes("kimi") || m.includes("moonshot")) return "kimi";
  if (m.includes("deepseek")) return "deepseek";
  if (m.includes("glm")) return "glm";
  if (m.includes("claude") || m.includes("anthropic")) return "anthropic";
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3")) return "openai";

  return CONFIG.defaultProvider;
}

// ─── Payload Patching ───────────────────────────────────────────────────────
/**
 * Apply provider-specific patches to the request payload.
 */
function patchPayload(payload, providerKey) {
  const provider = CONFIG.providers[providerKey];
  if (!provider) return payload;

  // Deep clone to avoid mutating original
  const p = JSON.parse(JSON.stringify(payload));

  // Kimi: force top_p
  if (provider.forceTopP !== undefined) {
    p.top_p = provider.forceTopP;
  }

  // Kimi: backfill reasoning_content for assistant messages with tool_calls
  if (provider.backfillReasoning && Array.isArray(p.messages)) {
    for (const msg of p.messages) {
      if (
        msg.role === "assistant" &&
        Array.isArray(msg.tool_calls) &&
        msg.tool_calls.length > 0 &&
        (msg.reasoning_content === undefined || msg.reasoning_content === null)
      ) {
        msg.reasoning_content = "";
      }
    }
  }

  // Remove provider-unsupported parameters
  if (providerKey === "anthropic") {
    // Anthropic uses 'max_tokens' not 'max_completion_tokens'
    if (p.max_completion_tokens !== undefined) {
      p.max_tokens = p.max_completion_tokens;
      delete p.max_completion_tokens;
    }
  }

  return p;
}

// ─── Header Building ────────────────────────────────────────────────────────
function buildTargetHeaders(reqHeaders, providerKey, apiKey) {
  const provider = CONFIG.providers[providerKey];
  const headers = {
    "content-type": reqHeaders["content-type"] || "application/json",
    "accept": reqHeaders["accept"] || "application/json",
    "authorization": `Bearer ${apiKey}`,
    "host": provider.host,
  };

  // Copy common headers
  for (const h of ["x-request-id", "x-custom-info", "accept-encoding"]) {
    if (reqHeaders[h]) headers[h] = reqHeaders[h];
  }

  // Provider-specific headers
  if (providerKey === "anthropic" && provider.version) {
    headers["anthropic-version"] = provider.version;
  }

  if (providerKey === "glm") {
    // GLM uses Authorization: Bearer {api_key}
    headers["authorization"] = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
  }

  return headers;
}

// ─── Path Building ──────────────────────────────────────────────────────────
function buildTargetPath(reqUrl, providerKey) {
  const provider = CONFIG.providers[providerKey];
  let path = reqUrl;

  // GLM uses a different base path
  if (provider.basePath && !path.startsWith(provider.basePath)) {
    path = provider.basePath + path;
  }

  return path;
}

// ─── Streaming Helpers ──────────────────────────────────────────────────────
function isStreamingRequest(payload) {
  return payload && payload.stream === true;
}

// ─── Proxy Server ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Provider, X-Model");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "healthy",
      proxy: "multi-model-headroom-proxy",
      version: "1.0.0",
      headroom: CONFIG.headroom.enabled ? "enabled" : "disabled",
      headroomUrl: CONFIG.headroom.baseUrl,
      providers: Object.keys(CONFIG.providers),
      defaultProvider: CONFIG.defaultProvider,
    }));
    return;
  }

  // Stats endpoint
  if (req.url === "/stats" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      totalRequests: stats.totalRequests,
      compressedRequests: stats.compressedRequests,
      totalTokensBefore: stats.totalTokensBefore,
      totalTokensAfter: stats.totalTokensAfter,
      totalTokensSaved: stats.totalTokensSaved,
      providerCounts: stats.providerCounts,
    }));
    return;
  }

  // Only intercept chat-completions POSTs for compression + routing
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        let payload = JSON.parse(body);

        // Detect provider from model, header, or default
        const providerOverride = req.headers["x-provider"];
        const modelOverride = req.headers["x-model"] || payload.model;
        const providerKey = providerOverride || detectProvider(modelOverride);
        const provider = CONFIG.providers[providerKey];

        if (!provider) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Unknown provider: ${providerKey}` }));
          return;
        }

        // Resolve API key
        const apiKey = process.env[provider.keyEnv];
        if (!apiKey) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Missing API key for ${providerKey}. Set ${provider.keyEnv}.` }));
          return;
        }

        log("info", `Request → ${providerKey} (${payload.model || "default"})`);
        stats.totalRequests++;
        stats.providerCounts[providerKey] = (stats.providerCounts[providerKey] || 0) + 1;

        // ── Headroom Compression ─────────────────────────────────────────
        let compressionResult = null;
        if (CONFIG.headroom.enabled && Array.isArray(payload.messages)) {
          try {
            compressionResult = await compressWithHeadroom(
              payload.messages,
              payload.model || CONFIG.headroom.model
            );
            if (compressionResult.compressed) {
              payload.messages = compressionResult.messages;
              stats.compressedRequests++;
              stats.totalTokensBefore += compressionResult.tokensBefore;
              stats.totalTokensAfter += compressionResult.tokensAfter;
              stats.totalTokensSaved += compressionResult.tokensSaved;
            }
          } catch (compressErr) {
            log("warn", "Compression error, proceeding uncompressed:", compressErr.message);
          }
        }

        // ── Provider-Specific Patching ──────────────────────────────────
        payload = patchPayload(payload, providerKey);

        const fixedBody = JSON.stringify(payload);
        const targetPath = buildTargetPath(req.url, providerKey);
        const targetHeaders = buildTargetHeaders(req.headers, providerKey, apiKey);

        log("info", `→ ${provider.host}${targetPath} (${Buffer.byteLength(fixedBody)} bytes)`);

        const options = {
          hostname: provider.host,
          port: 443,
          path: targetPath,
          method: "POST",
          headers: {
            ...targetHeaders,
            "content-length": Buffer.byteLength(fixedBody),
          },
        };

        const proxyReq = https.request(options, (proxyRes) => {
          // Add compression metadata header if compressed
          if (compressionResult && compressionResult.compressed) {
            const meta = {
              tokens_before: compressionResult.tokensBefore,
              tokens_after: compressionResult.tokensAfter,
              tokens_saved: compressionResult.tokensSaved,
              compression_ratio: compressionResult.compressionRatio,
              transforms: compressionResult.transformsApplied,
            };
            proxyRes.headers["x-headroom-meta"] = Buffer.from(JSON.stringify(meta)).toString("base64");
          }

          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on("error", (err) => {
          log("error", "Upstream error:", err.message);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message, provider: providerKey }));
        });

        proxyReq.write(fixedBody);
        proxyReq.end();
      } catch (err) {
        log("error", "Parse/Process error:", err.message);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "bad request", detail: err.message }));
      }
    });
    return;
  }

  // ── Generic Passthrough ──────────────────────────────────────────────────
  // For non-chat endpoints, route based on x-provider header or default
  const providerKey = req.headers["x-provider"] || CONFIG.defaultProvider;
  const provider = CONFIG.providers[providerKey];

  if (!provider) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Unknown provider: ${providerKey}` }));
    return;
  }

  const apiKey = process.env[provider.keyEnv];
  if (!apiKey) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Missing API key for ${providerKey}` }));
    return;
  }

  const targetPath = buildTargetPath(req.url, providerKey);
  const targetHeaders = buildTargetHeaders(req.headers, providerKey, apiKey);

  const options = {
    hostname: provider.host,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: targetHeaders,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    log("error", "Upstream error:", err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
});

// ─── Stats ──────────────────────────────────────────────────────────────────
const stats = {
  totalRequests: 0,
  compressedRequests: 0,
  totalTokensBefore: 0,
  totalTokensAfter: 0,
  totalTokensSaved: 0,
  providerCounts: {},
};

// ─── Graceful Shutdown ──────────────────────────────────────────────────────
process.on("SIGINT", () => {
  log("info", "\nShutting down gracefully...");
  server.close(() => {
    log("ok", "Server closed.");
    process.exit(0);
  });
});

// ─── Startup ────────────────────────────────────────────────────────────────
server.listen(CONFIG.proxyPort, "0.0.0.0", () => {
  log("ok", `Multi-Model Headroom Proxy listening on http://0.0.0.0:${CONFIG.proxyPort}`);
  log("info", `Headroom compression: ${CONFIG.headroom.enabled ? "ENABLED" : "DISABLED"}`);
  if (CONFIG.headroom.enabled) {
    log("info", `  → Headroom proxy: ${CONFIG.headroom.baseUrl}`);
    log("info", `  → Fallback on error: ${CONFIG.headroom.fallback}`);
  }
  log("info", `Supported providers: ${Object.keys(CONFIG.providers).join(", ")}`);
  log("info", `Default provider: ${CONFIG.defaultProvider}`);
  log("info", "");
  log("info", "Usage examples:");
  log("info", `  curl http://localhost:${CONFIG.proxyPort}/health`);
  log("info", `  curl http://localhost:${CONFIG.proxyPort}/v1/chat/completions \\\`);
  log("info", `    -H "Content-Type: application/json" \\\`);
  log("info", `    -H "X-Provider: deepseek" \\\`);
  log("info", `    -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hello"}]}'`);
  log("info", "");
  log("info", "Or let auto-detect from model name:");
  log("info", `  -d '{"model":"kimi-latest",...}'   → routes to Kimi`);
  log("info", `  -d '{"model":"deepseek-chat",...}' → routes to DeepSeek`);
  log("info", `  -d '{"model":"glm-4",...}'         → routes to GLM`);
  log("info", `  -d '{"model":"gpt-4o",...}'        → routes to OpenAI`);
});
