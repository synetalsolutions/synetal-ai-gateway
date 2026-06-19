/**
 * Colored logger utility
 */

import { LogLevel } from "./types";

const COLORS: Record<LogLevel | "reset", string> = {
  info: "\x1b[36m",   // cyan
  ok: "\x1b[32m",     // green
  warn: "\x1b[33m",   // yellow
  error: "\x1b[31m",  // red
  reset: "\x1b[0m",
};

export function log(level: LogLevel, ...args: unknown[]): void {
  const ts = new Date().toISOString();
  const c = COLORS[level] || COLORS.info;
  console.log(`${c}[${ts}] [${level.toUpperCase()}]${COLORS.reset}`, ...args);
}

export function logRequest(reqId: string, provider: string, model: string, action: string): void {
  log("info", `[${reqId}] ${action} → ${provider} (${model})`);
}

export function logError(reqId: string, error: Error | string): void {
  const msg = error instanceof Error ? error.message : String(error);
  log("error", `[${reqId}] ${msg}`);
}
