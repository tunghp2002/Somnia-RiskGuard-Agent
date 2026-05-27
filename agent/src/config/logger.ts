import pino, { type Logger, type LoggerOptions } from "pino";

import { secretEnvKeys, type AgentConfig } from "./env.js";

const secretPathFragments = [
  "privateKey",
  "apiKey",
  "botToken",
  "webhookSecret",
  "authorization",
  "cookie"
];

export const loggerRedactPaths = [
  ...secretEnvKeys.map((key) => `env.${key}`),
  ...secretPathFragments.map((fragment) => `*.${fragment}`),
  ...secretPathFragments.map((fragment) => `req.headers.${fragment}`),
  "thirdweb.secretKey",
  "supabase.serviceRoleKey",
  "supabase.sessionKeyEncryptionKey",
  "llm.groq.apiKey",
  "llm.deepSeek.apiKey",
  "telegram.botToken",
  "telegram.webhookSecret"
];

export function createLogger(
  config: Pick<AgentConfig, "logLevel">,
  options: LoggerOptions = {}
): Logger {
  return pino({
    level: config.logLevel,
    redact: {
      paths: loggerRedactPaths,
      censor: "[REDACTED]"
    },
    ...options
  });
}
