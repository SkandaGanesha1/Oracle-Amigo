import { SecretPolicy } from "../policy/SecretPolicy.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export function createLogger(secretPolicy = new SecretPolicy()): Logger {
  const write = (level: LogLevel, message: string, metadata: Record<string, unknown> = {}) => {
    const entry = {
      level,
      time: new Date().toISOString(),
      message,
      ...secretPolicy.redactObject(metadata)
    };
    const line = JSON.stringify(entry);
    if (level === "error") {
      console.error(line);
      return;
    }
    console.log(line);
  };

  return {
    debug: (message, metadata) => write("debug", message, metadata),
    info: (message, metadata) => write("info", message, metadata),
    warn: (message, metadata) => write("warn", message, metadata),
    error: (message, metadata) => write("error", message, metadata)
  };
}
