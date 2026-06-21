/**
 * Core types for Multi-Model Headroom Proxy
 */

export type ProviderKey = "kimi" | "deepseek" | "glm" | "openai" | "anthropic" | "xiaomi";

export type LogLevel = "info" | "ok" | "warn" | "error";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string | null;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionPayload {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high";
  tools?: unknown[];
  tool_choice?: unknown;
  [key: string]: unknown;
}

export interface ProviderConfig {
  host: string;
  keyEnv: string;
  defaultModel?: string;
  basePath?: string;
  version?: string;
  forceTopP?: number;
  backfillReasoning?: boolean;
  /** Custom request path transformer */
  pathTransform?: (path: string) => string;
  /** Custom header builder */
  headerBuilder?: (
    headers: Record<string, string>,
    apiKey: string,
    provider: ProviderConfig
  ) => Record<string, string>;
}

export interface ProxyConfig {
  proxyPort: number;
  defaultProvider: ProviderKey;
  providers: Record<ProviderKey, ProviderConfig>;
  /** Fallback chain: if provider fails, try these in order */
  fallbackChain: ProviderKey[];
  /** Load balancing: round-robin across these providers for the same model family */
  loadBalanceGroups: Record<string, ProviderKey[]>;
  /** Max retries per provider before falling back */
  maxRetries: number;
  /** Retry delay in ms */
  retryDelayMs: number;
}

export interface ProxyStats {
  totalRequests: number;
  compressedRequests: number;
  totalTokensBefore: number;
  totalTokensAfter: number;
  totalTokensSaved: number;
  providerCounts: Record<string, number>;
  fallbackCounts: Record<string, number>;
  errorCounts: Record<string, number>;
  /** Per-provider latency tracking (ms) */
  latencyMs: Record<string, number[]>;
}

export interface FallbackAttempt {
  provider: ProviderKey;
  success: boolean;
  latencyMs: number;
  error?: string;
  statusCode?: number;
}

export interface RequestContext {
  requestId: string;
  providerKey: ProviderKey;
  model: string;
  startTime: number;
  attempts: FallbackAttempt[];
  isStreaming: boolean;
}

export interface WebSocketClient {
  id: string;
  socket: WebSocket;
  provider?: ProviderKey;
  model?: string;
  connectedAt: number;
  lastPingAt: number;
}

export interface StreamingChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string | null;
  }>;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  proxy: string;
  version: string;
  providers: ProviderKey[];
  defaultProvider: ProviderKey;
  /** Per-provider health */
  providerHealth: Record<ProviderKey, { reachable: boolean; latencyMs: number }>;
}
