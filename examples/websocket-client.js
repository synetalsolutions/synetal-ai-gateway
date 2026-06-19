#!/usr/bin/env node
/**
 * WebSocket client example for Multi-Model Headroom Proxy
 *
 * Usage:
 *   node examples/websocket-client.js [provider] [model] [message]
 *
 * Examples:
 *   node examples/websocket-client.js deepseek deepseek-chat "Hello!"
 *   node examples/websocket-client.js kimi kimi-latest "Explain Node.js"
 *   node examples/websocket-client.js "" "" "Use auto-detect"
 */

const WebSocket = require("ws");

const PROXY_URL = process.env.PROXY_WS_URL || "ws://localhost:3456/ws";
const provider = process.argv[2] || "";
const model = process.argv[3] || "deepseek-chat";
const message = process.argv[4] || "Hello, how are you?";

function log(type, text) {
  const colors = {
    connect: "\x1b[36m",
    message: "\x1b[32m",
    error: "\x1b[31m",
    chunk: "\x1b[35m",
    reset: "\x1b[0m",
  };
  const c = colors[type] || colors.message;
  console.log(`${c}[${type.toUpperCase()}]${colors.reset} ${text}`);
}

const ws = new WebSocket(PROXY_URL);

ws.on("open", () => {
  log("connect", `Connected to ${PROXY_URL}`);

  const payload = {
    model,
    messages: [{ role: "user", content: message }],
    stream: true,
  };

  const msg = {
    type: "chat",
    payload,
    ...(provider && { provider }),
    model,
  };

  log("message", `Sending: ${JSON.stringify(msg).slice(0, 200)}...`);
  ws.send(JSON.stringify(msg));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case "connected":
      log("connect", `Client ID: ${msg.clientId}`);
      log("connect", `Available providers: ${msg.providers.join(", ")}`);
      break;

    case "stream_start":
      log("message", `Stream started → ${msg.provider}`);
      if (msg.compression) {
        log("message", `Compression: ${msg.compression.tokens_before} → ${msg.compression.tokens_after} ` +
          `(-${msg.compression.tokens_saved} tokens)`);
      }
      break;

    case "stream_chunk": {
      // Parse SSE chunk to extract content
      const lines = msg.data.split("\n");
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const dataStr = line.slice(5).trim();
          if (dataStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(dataStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) process.stdout.write(content);
          } catch {
            // Ignore parse errors for malformed chunks
          }
        }
      }
      break;
    }

    case "stream_end":
      console.log("\n");
      log("message", "Stream ended");
      ws.close();
      break;

    case "stream_error":
      log("error", `Stream error: ${msg.error}`);
      ws.close();
      break;

    case "response": {
      log("message", `Response from ${msg.provider}`);
      if (msg.compression) {
        log("message", `Compression saved: ${msg.compression.tokens_saved} tokens`);
      }
      const content = msg.payload?.choices?.[0]?.message?.content;
      if (content) console.log(content);
      ws.close();
      break;
    }

    case "error":
      log("error", msg.error);
      ws.close();
      break;

    default:
      log("message", JSON.stringify(msg).slice(0, 200));
  }
});

ws.on("close", () => {
  log("connect", "Disconnected");
  process.exit(0);
});

ws.on("error", (err) => {
  log("error", err.message);
  process.exit(1);
});
