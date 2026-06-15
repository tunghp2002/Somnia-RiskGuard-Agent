import { getAddress, verifyMessage } from "ethers";
import { z } from "zod";

const signedWalletSessionMaxTtlMs = 10 * 60 * 1000;
const signedWalletSessionClockSkewMs = 2 * 60 * 1000;

export const signedWalletProofFields = {
  message: z.string().trim().min(1).max(1_000),
  signature: z.string().trim().min(1).max(500)
};

export interface SignedWalletProofInput {
  walletAddress: string;
  message: string;
  signature: string;
}

export function validateSignedWalletProof(
  input: SignedWalletProofInput,
  context: z.RefinementCtx,
  action: string
) {
  let recoveredAddress: string;

  try {
    recoveredAddress = verifyMessage(input.message, input.signature);
  } catch {
    context.addIssue({
      code: "custom",
      message: "Signature must be a valid signed-message proof",
      path: ["signature"]
    });
    return;
  }

  if (getAddress(recoveredAddress) !== getAddress(input.walletAddress)) {
    context.addIssue({
      code: "custom",
      message: "Signature must recover the submitted wallet address",
      path: ["signature"]
    });
  }

  const normalizedMessage = input.message.toLowerCase();
  if (!normalizedMessage.includes(input.walletAddress.toLowerCase())) {
    context.addIssue({
      code: "custom",
      message: "Signed message must include the submitted wallet address",
      path: ["message"]
    });
  }

  if (isValidSignedWalletSession(input.message, normalizedMessage, context)) {
    return;
  }

  if (!normalizedMessage.includes(action.toLowerCase())) {
    context.addIssue({
      code: "custom",
      message: `Signed message must include the ${action} action`,
      path: ["message"]
    });
  }
}

function isValidSignedWalletSession(
  message: string,
  normalizedMessage: string,
  context: z.RefinementCtx
) {
  if (
    !normalizedMessage.includes("somguard signed wallet session") ||
    !normalizedMessage.includes("scope: agent mutations")
  ) {
    return false;
  }

  const issuedAt = parseProofDate(message, "Issued At");
  const expiresAt = parseProofDate(message, "Expires At");
  if (!issuedAt || !expiresAt) {
    context.addIssue({
      code: "custom",
      message: "Signed wallet session must include valid Issued At and Expires At timestamps",
      path: ["message"]
    });
    return true;
  }

  const now = Date.now();
  if (issuedAt.getTime() - now > signedWalletSessionClockSkewMs) {
    context.addIssue({
      code: "custom",
      message: "Signed wallet session was issued in the future",
      path: ["message"]
    });
  }

  if (expiresAt.getTime() <= now - signedWalletSessionClockSkewMs) {
    context.addIssue({
      code: "custom",
      message: "Signed wallet session has expired",
      path: ["message"]
    });
  }

  if (expiresAt.getTime() - issuedAt.getTime() > signedWalletSessionMaxTtlMs) {
    context.addIssue({
      code: "custom",
      message: "Signed wallet session expiry is too far in the future",
      path: ["message"]
    });
  }

  return true;
}

function parseProofDate(message: string, label: string) {
  const line = message
    .split("\n")
    .find((item) => item.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  const value = line?.slice(label.length + 1).trim();
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
