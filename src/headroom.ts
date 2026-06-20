/**
 * Headroom compression client — uses headroom-ai SDK directly (no HTTP server needed)
 */

import { HeadroomConfig, ChatMessage, CompressionResult } from "./types";
import { log } from "./logger";

let headroomSDK: any = null;
try {
  headroomSDK = require("headroom-ai");
} catch {
  log("warn", "headroom-ai SDK not available, compression disabled");
}

export class HeadroomClient {
  private config: HeadroomConfig;

  constructor(config: HeadroomConfig) {
    this.config = config;
  }

  async compress(messages: ChatMessage[], model?: string): Promise<CompressionResult> {
    if (!this.config.enabled || !headroomSDK) {
      return { messages, compressed: false, tokensBefore: 0, tokensAfter: 0, tokensSaved: 0 };
    }

    try {
      const result = await headroomSDK.compress(messages, {
        model: model || this.config.model || "gpt-4o",
      });

      const tokensSaved = (result.tokensBefore || 0) - (result.tokensAfter || 0);
      log("ok", `Headroom: ${result.tokens_before} → ${result.tokens_after} tokens (saved ${tokensSaved})`);

      return {
        messages: result.messages || messages,
        compressed: true,
        tokensBefore: result.tokens_before || 0,
        tokensAfter: result.tokens_after || 0,
        tokensSaved: Math.max(0, tokensSaved),
        compressionRatio: result.compression_ratio,
        transformsApplied: result.transforms_applied,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log("warn", `Headroom compression failed: ${msg}`);
      return { messages, compressed: false, tokensBefore: 0, tokensAfter: 0, tokensSaved: 0 };
    }
  }

  async health(): Promise<boolean> {
    return this.config.enabled && headroomSDK !== null;
  }
}
