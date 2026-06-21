/**
 * WebSocket and SSE streaming utilities
 */

import * as http from "http";
import * as https from "https";
import { ChatCompletionPayload, CompressionResult } from "./types";
import { log } from "./logger";

/**
 * Check if request is streaming
 */
export function isStreamingRequest(payload: ChatCompletionPayload): boolean {
  return payload.stream === true;
}

/**
 * Parse SSE chunk from buffer
 */
export function parseSSEChunk(chunk: string): Array<{ data: string; event?: string }> {
  const lines = chunk.split("\n");
  const events: Array<{ data: string; event?: string }> = [];
  let currentEvent: string | undefined;
  let currentData = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      currentData = line.slice(5).trim();
    } else if (line === "" && currentData) {
      events.push({ data: currentData, event: currentEvent });
      currentEvent = undefined;
      currentData = "";
    }
  }

  if (currentData) {
    events.push({ data: currentData, event: currentEvent });
  }

  return events;
}

/**
 * Create SSE stream transformer that injects compression metadata
 */
export function createSSETransformer(
  compressionResult: CompressionResult | null,
  requestId: string
): TransformStream<Uint8Array, Uint8Array> {
  let injected = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (!injected && compressionResult?.compressed) {
        // Inject metadata as a comment in the first chunk
        const meta = {
          _headroom: {
            request_id: requestId,
            tokens_before: compressionResult.tokensBefore,
            tokens_after: compressionResult.tokensAfter,
            tokens_saved: compressionResult.tokensSaved,
            compression_ratio: compressionResult.compressionRatio,
            transforms: compressionResult.transformsApplied,
          },
        };
        const metaLine = `: ${JSON.stringify(meta)}\n\n`;
        controller.enqueue(new TextEncoder().encode(metaLine));
        injected = true;
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * Pipe an upstream HTTPS response to an HTTP response with optional transformation
 */
export function pipeResponse(
  proxyRes: http.IncomingMessage,
  res: http.ServerResponse,
  _transform?: TransformStream<Uint8Array, Uint8Array>
): void {
  // Remove content-length because we may transform
  const headers = { ...proxyRes.headers };
  delete headers["content-length"];

  res.writeHead(proxyRes.statusCode || 200, headers);
  proxyRes.pipe(res);
}

/**
 * Simple promise-based HTTP request helper for non-streaming
 */
export async function makeRequest(
  options: https.RequestOptions,
  body: string
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Make streaming request and return the response object.
 * For non-200 responses, reads the error body and rejects with an informative error
 * so the caller can log/fallback properly.
 */
export function makeStreamingRequest(
  options: https.RequestOptions,
  body: string
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      // If upstream returned an error status, read body and reject
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        let errBody = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => (errBody += chunk));
        res.on("end", () => {
          reject(new Error(`HTTP ${res.statusCode}: ${errBody.slice(0, 500)}`));
        });
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
