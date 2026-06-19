#!/usr/bin/env node
/**
 * Lightweight proxy for Kimi (Moonshot AI) that:
 *   1. Forces top_p = 0.95, because VS Code's Copilot extension sends a
 *      different value and the API rejects it with:
 *        "invalid top_p: only 0.95 is allowed for this model"
 *   2. Backfills `reasoning_content` on assistant messages that contain
 *      tool_calls, because the thinking model rejects history without it:
 *        "thinking is enabled but reasoning_content is missing in
 *         assistant tool call message at index N"
 */
const http = require("http");
const https = require("https");
const url = require("url");

const PROXY_PORT = 3456;
const TARGET_HOST = "api.moonshot.ai";

const server = http.createServer((req, res) => {
  // Only intercept chat-completions POSTs
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);

        // Force top_p to the only value Moonshot accepts for this model
        payload.top_p = 0.95;

        // Kimi thinking model requires reasoning_content on any assistant
        // message that contains tool_calls. Copilot strips it when replaying
        // history, so we backfill a placeholder to satisfy the API.
        if (Array.isArray(payload.messages)) {
          for (const msg of payload.messages) {
            if (
              msg.role === "assistant" &&
              Array.isArray(msg.tool_calls) &&
              msg.tool_calls.length > 0 &&
              (msg.reasoning_content === undefined ||
                msg.reasoning_content === null)
            ) {
              msg.reasoning_content = "";
            }
          }
        }

        const fixedBody = JSON.stringify(payload);

        const options = {
          hostname: TARGET_HOST,
          port: 443,
          path: "/v1/chat/completions",
          method: "POST",
          headers: {
            ...req.headers,
            host: TARGET_HOST,
            "content-length": Buffer.byteLength(fixedBody),
          },
        };

        const proxyReq = https.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on("error", (err) => {
          console.error("[KimiProxy] upstream error:", err.message);
          res.writeHead(502);
          res.end(JSON.stringify({ error: err.message }));
        });

        proxyReq.write(fixedBody);
        proxyReq.end();
      } catch (err) {
        console.error("[KimiProxy] parse error:", err.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: "bad request" }));
      }
    });
    return;
  }

  // Pass everything else through unchanged
  const targetUrl = url.parse(`https://${TARGET_HOST}${req.url}`);
  const options = {
    hostname: targetUrl.hostname,
    port: 443,
    path: targetUrl.path,
    method: req.method,
    headers: { ...req.headers, host: TARGET_HOST },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    res.writeHead(502);
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log(`[KimiProxy] listening on http://127.0.0.1:${PROXY_PORT}`);
  console.log(`[KimiProxy] forwarding to https://${TARGET_HOST}`);
});