import pino from "pino";
import type { Logger, LoggerOptions } from "pino";

/**
 * Secret-bearing paths are redacted everywhere they can appear in a log record.
 * Never rely on callers to strip these before logging.
 */
export const REDACT_PATHS = [
  "password",
  "token",
  "authorization",
  "secret",
  "apiKey",
  "cookie",
  "passwordHash",
  "tokenHash",
  "*.password",
  "*.token",
  "*.authorization",
  "*.secret",
  "*.apiKey",
  "*.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
] as const;

export interface CreateLoggerOptions {
  readonly name?: string;
  readonly level?: string;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const isProduction = process.env.NODE_ENV === "production";
  const pinoOptions: LoggerOptions = {
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    redact: { paths: [...REDACT_PATHS], censor: "[Redacted]" },
  };

  if (options.name !== undefined) {
    pinoOptions.name = options.name;
  }

  // Structured JSON in production; human-readable output everywhere else.
  if (!isProduction) {
    pinoOptions.transport = {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:standard" },
    };
  }

  return pino(pinoOptions);
}
