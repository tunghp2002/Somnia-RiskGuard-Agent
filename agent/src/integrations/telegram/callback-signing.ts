import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { isoDateTimeSchema } from "../../utils/datetime.js";

export const telegramActionTypeSchema = z.enum([
  "acknowledge_alert",
  "refresh_analysis",
  "approve_safe_action",
  "approve_riskguard_tx",
  "decline_riskguard_tx"
]);

export const telegramCallbackPayloadSchema = z.object({
  version: z.literal(1),
  actionType: telegramActionTypeSchema,
  userId: z.string().uuid(),
  chatId: z.string().regex(/^-?\d+$/),
  nonce: z.string().uuid(),
  expiresAt: isoDateTimeSchema,
  alertId: z.string().uuid().optional(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  safeAction: z.string().min(1).optional(),
  signature: z.string().regex(/^[a-f0-9]{64}$/)
});

export type TelegramActionType = z.infer<typeof telegramActionTypeSchema>;
export type TelegramCallbackPayload = z.infer<typeof telegramCallbackPayloadSchema>;
export type UnsignedTelegramCallbackPayload = Omit<TelegramCallbackPayload, "signature">;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function canonicalPayload(payload: UnsignedTelegramCallbackPayload): string {
  return JSON.stringify({
    version: payload.version,
    actionType: payload.actionType,
    userId: payload.userId,
    chatId: payload.chatId,
    nonce: payload.nonce,
    expiresAt: payload.expiresAt,
    ...(payload.alertId ? { alertId: payload.alertId } : {}),
    ...(payload.walletAddress ? { walletAddress: payload.walletAddress } : {}),
    ...(payload.safeAction ? { safeAction: payload.safeAction } : {})
  });
}

export function signTelegramCallback(
  payload: UnsignedTelegramCallbackPayload,
  secret: string
): TelegramCallbackPayload {
  const signature = createHmac("sha256", secret)
    .update(canonicalPayload(payload))
    .digest("hex");

  return telegramCallbackPayloadSchema.parse({ ...payload, signature });
}

export function encodeTelegramCallback(payload: TelegramCallbackPayload): string {
  return encode(payload);
}

export function decodeTelegramCallback(value: string): TelegramCallbackPayload {
  return telegramCallbackPayloadSchema.parse(decode(value));
}

export function verifyTelegramCallback(
  encodedPayload: string,
  secret: string
): TelegramCallbackPayload {
  const payload = decodeTelegramCallback(encodedPayload);
  const { signature, ...unsignedPayload } = payload;
  const expected = signTelegramCallback(unsignedPayload, secret).signature;
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error("Telegram callback signature is invalid");
  }

  if (Date.parse(payload.expiresAt) <= Date.now()) {
    throw new Error("Telegram callback is expired");
  }

  return payload;
}

export interface CompactTelegramCallback {
  nonce: string;
}

function compactSignature(nonce: string, secret: string): string {
  return createHmac("sha256", secret).update(`rg1:${nonce}`).digest("base64url").slice(0, 16);
}

export function createCompactTelegramCallbackData(
  nonce: string,
  secret: string
): string {
  return `rg1.${nonce}.${compactSignature(nonce, secret)}`;
}

export function verifyCompactTelegramCallbackData(
  value: string,
  secret: string
): CompactTelegramCallback {
  const [version, nonce, signature] = value.split(".");

  if (version !== "rg1" || !nonce || !signature) {
    throw new Error("Telegram callback payload is malformed");
  }

  const expected = compactSignature(nonce, secret);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error("Telegram callback signature is invalid");
  }

  return { nonce };
}
