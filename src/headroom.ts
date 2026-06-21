/**
 * Headroom compression client — calls the headroom HTTP proxy directly.
 *
 * Why direct HTTP instead of the npm SDK?
 *  - The npm SDK internally POSTs to the Python proxy anyway (same /v1/compress).
 *  - Direct HTTP lets us enforce a hard TIMEOUT so a slow Kompress ML model
 *    never blocks Cursor's real-time streaming requests.
 *  - If the proxy is unreachable or too slow, we fall through to uncompressed
 *    so the request still succeeds (HEADROOM_FALLBACK=true).
 */

import http from "http";
import { HeadroomConfig, ChatMessage, CompressionResult } from "./types";
import { log } from "./logger";

export class HeadroomClient {
  private config: HeadroomConfig;
  private baseUrl: URL;

  constructor(config: HeadroomConfig) {
    this.config = config;
    this.baseUrl = new URL(config.baseUrl);
  }

  async compress(messages: ChatMessage[], model?: string): Promise<CompressionResult> {
    if (!this.config.enabled) {
      return { messages, compressed: false, tokensBefore: 0, tokensAfter: 0, tokensSaved: 0 };
    }

    const reqModel = model || this.config.model || "gpt-4o";
    const body = JSON.stringify({ model: reqModel, messages });

    try {
      const data = await this.postWithTimeout("/v1/compress", body, this.config.timeoutMs);
      const tokensBefore = data.tokens_before ?? 0;
      const tokensAfter = data.tokens_after ?? 0;
      const tokensSaved = tokensBefore - tokensAfter;

      if (tokensSaved > 0) {
        const pct = tokensBefore > 0 ? ((tokensAfter / tokensBefore) * 100).toFixed(1) : "100";
        const tx = data.transforms_summary
          ? Object.entries(data.transforms_summary as Record<string, number>)
              .map(([k, v]) => `${k}×${v}`)
              .join(", ")
          : "none";
        log("ok", `Headroom: ${tokensBefore} → ${tokensAfter} tokens (saved ${tokensSaved}, ${pct}% of orig; ${tx})`);
      } else {
        log("info", `Headroom: ${tokensBefore} → ${tokensAfter} tokens (saved 0; ${JSON.stringify(data.transforms_applied || [])})`);
      }

      return {
        messages: data.messages || messages,
        compressed: true,
        tokensBefore,
        tokensAfter,
        tokensSaved: Math.max(0, tokensSaved),
        compressionRatio: data.compression_ratio,
        transformsApplied: data.transforms_applied,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.config.fallback) {
        log("warn", `Headroom compression failed (${msg}), falling through uncompressed`);
        return { messages, compressed: false, tokensBefore: 0, tokensAfter: 0, tokensSaved: 0 };
      }
      throw err;
    }
  }

  /**
   * POST JSON to the headroom proxy with a hard timeout.
   * On timeout, rejects with "timeout after Nms" so compress() can fall through.
   */
  private postWithTimeout(path: string, body: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: this.baseUrl.hostname,
        port: this.baseUrl.port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
      };

      const timer = setTimeout(() => {
        req.destroy(new Error(`timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const req = http.request(options, (res) => {
        let raw = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => (raw += chunk));
        res.on("end", () => {
          clearTimeout(timer);
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`invalid JSON from headroom (${raw.length} bytes)`));
          }
        });
      });

      req.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      req.write(body);
      req.end();
    });
  }

  async health(): Promise<boolean> {
    if (!this.config.enabled) return false;
    try {
      await this.postWithTimeout("/health", "{}", 3000);
      return true;
    } catch {
      return false;
    }
  }
}
