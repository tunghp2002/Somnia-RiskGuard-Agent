import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { getAddress } from "ethers";

import type { sendJson } from "./response.js";

const defaultMaxBodyBytes = 1_048_576;
const sensitiveResponseKeyPattern =
  /(private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|authorization|cookie|password|credential)/i;
const corsRequestHeaders = "content-type, if-none-match, x-riskguard-request-id";

function isAllowedDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

// Production frontends must be explicitly allowlisted. Avoid broad preview
// domains here because several API routes perform wallet-scoped mutations.
function getConfiguredOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? process.env.FRONTEND_URL ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/\/$/, ""))
    .filter(Boolean);
}

function isAllowedOrigin(origin: string): boolean {
  if (isAllowedDevOrigin(origin)) {
    return true;
  }

  const normalized = origin.toLowerCase().replace(/\/$/, "");
  return getConfiguredOrigins().includes(normalized);
}

export function applyCorsHeaders(
  request: IncomingMessage,
  response: Parameters<typeof sendJson>[0]
): void {
  const origin = request.headers.origin;

  if (origin && isAllowedOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }

  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", corsRequestHeaders);
  response.setHeader("Access-Control-Expose-Headers", "ETag");
}

export class PayloadTooLargeError extends Error {
  public constructor() {
    super("Request body is too large");
    this.name = "PayloadTooLargeError";
  }
}

export class AddressValidationError extends Error {
  public constructor() {
    super("Wallet address is invalid");
    this.name = "AddressValidationError";
  }
}

export class ServerDependencyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ServerDependencyError";
  }
}

export function parseOptionalWalletAddress(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return getAddress(value);
  } catch {
    throw new AddressValidationError();
  }
}

export function parseOptionalLimit(value: string | null, defaultValue = 20): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new AddressValidationError();
  }

  return parsed;
}

export function redactSecretSafe(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretSafe(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveResponseKeyPattern.test(key) ? "[REDACTED]" : redactSecretSafe(item)
    ])
  );
}

export function isSimulationAuditEvent(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const metadata = (value as { metadata?: unknown }).metadata;
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      (metadata as { mode?: unknown }).mode === "simulation"
  );
}

export function compactAuditMetadata(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return depth > 0
      ? `[${value.length} items]`
      : value.slice(0, 3).map((item) => compactAuditMetadata(item, depth + 1));
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const compactEntries: Array<[string, unknown]> = [];

  for (const [key, item] of entries) {
    if (sensitiveResponseKeyPattern.test(key)) {
      compactEntries.push([key, "[REDACTED]"]);
    } else if (item && typeof item === "object") {
      compactEntries.push([key, depth >= 1 ? "[object]" : compactAuditMetadata(item, depth + 1)]);
    } else {
      compactEntries.push([key, item]);
    }

    if (compactEntries.length >= 3) {
      break;
    }
  }

  const mode = (value as { mode?: unknown }).mode;
  if (mode !== undefined && !compactEntries.some(([key]) => key === "mode")) {
    compactEntries.unshift(["mode", mode]);
  }

  return Object.fromEntries(compactEntries);
}

export function createWeakEtag(payload: unknown): string {
  return `W/"${createHash("sha256").update(JSON.stringify(payload)).digest("base64url")}"`;
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes = defaultMaxBodyBytes
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;

    if (byteLength > maxBodyBytes) {
      throw new PayloadTooLargeError();
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
