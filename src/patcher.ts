/**
 * Provider-specific payload patching
 */

import * as http from "http";
import { ProviderKey, ProviderConfig, ChatCompletionPayload } from "./types";

export function patchPayload(
  payload: ChatCompletionPayload,
  providerKey: ProviderKey
): ChatCompletionPayload {
  // Deep clone
  const p: ChatCompletionPayload = JSON.parse(JSON.stringify(payload));

  switch (providerKey) {
    case "kimi": {
      // Force top_p
      p.top_p = 0.95;
      // Backfill reasoning_content for assistant messages with tool_calls
      if (Array.isArray(p.messages)) {
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
      break;
    }

    case "anthropic": {
      // Anthropic uses max_tokens not max_completion_tokens
      if (p.max_completion_tokens !== undefined) {
        p.max_tokens = p.max_completion_tokens;
        delete p.max_completion_tokens;
      }
      break;
    }

    case "glm": {
      // GLM-specific adjustments if needed
      break;
    }

    case "deepseek": {
      // DeepSeek supports reasoning_effort natively
      break;
    }

    case "openai": {
      // No special patches needed for OpenAI
      break;
    }

    case "xiaomi": {
      // Xiaomi uses OpenAI-compatible format, no special patches needed
      break;
    }
  }

  return p;
}

export function buildTargetHeaders(
  reqHeaders: http.IncomingHttpHeaders,
  providerKey: ProviderKey,
  apiKey: string,
  providerConfig: ProviderConfig
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": (reqHeaders["content-type"] as string) || "application/json",
    accept: (reqHeaders["accept"] as string) || "application/json",
    authorization: `Bearer ${apiKey}`,
    host: providerConfig.host,
  };

  // Copy common headers
  for (const h of ["x-request-id", "x-custom-info"]) {
    const val = reqHeaders[h];
    if (val) headers[h] = Array.isArray(val) ? val[0] : val;
  }

  if (providerKey === "anthropic" && providerConfig.version) {
    headers["anthropic-version"] = providerConfig.version;
  }

  if (providerKey === "glm") {
    headers["authorization"] = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
  }

  if (providerKey === "xiaomi") {
    headers["authorization"] = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
  }

  return headers;
}

export function buildTargetPath(reqUrl: string, providerConfig: ProviderConfig): string {
  let path = reqUrl;
  if (providerConfig.pathTransform) {
    path = providerConfig.pathTransform(path);
  }
  if (providerConfig.basePath && !path.startsWith(providerConfig.basePath)) {
    return providerConfig.basePath + path;
  }
  return path;
}
