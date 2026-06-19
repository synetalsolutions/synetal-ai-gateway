/**
 * Headroom compression client
 */

import { HeadroomConfig, ChatMessage, CompressionResult, HeadroomCompressResponse } from "./types";
import { log } from "./logger";

export class HeadroomClient {
  private config: HeadroomConfig;

  constructor(config: HeadroomConfig) {
    this.config = config;
  }

  async compress(messages: ChatMessage[], model?: string): Promise<CompressionResult> {
    if (!this.config.enabled) {
      return {
        messages,
        compressed: false,
        tokensBefore: 0,
        tokensAfter: 0,
        tokensSaved: 0,
      };
    }

    const url = `${this.config.baseUrl}/v1/compress`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const body = JSON.stringify({
      messages,
      model: model || this.config.model,
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Headroom proxy returned ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as HeadroomCompressResponse;

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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log("warn", "Headroom compression failed:", msg);
      if (!this.config.fallback) {
        throw err;
      }
      return { messages, compressed: false, tokensBefore: 0, tokensAfter: 0, tokensSaved: 0 };
    }
  }

  async health(): Promise<{ status: string; version?: string } | null> {
    try {
      const res = await fetch(`${this.config.baseUrl}/health`, { timeout: 5000 } as any);
      if (!res.ok) return null;
      return (await res.json()) as { status: string; version?: string };
    } catch {
      return null;
    }
  }
}
