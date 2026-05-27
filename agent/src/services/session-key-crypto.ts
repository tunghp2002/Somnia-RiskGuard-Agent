import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encryptSecret(secret: string, encryptionKey: string): EncryptedSecret {
  const key = parseEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptSecret(encrypted: EncryptedSecret, encryptionKey: string): string {
  const key = parseEncryptionKey(encryptionKey);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function parseEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  const hex = trimmed.replace(/^0x/, "");

  if (/^[a-fA-F0-9]{64}$/.test(hex)) {
    return Buffer.from(hex, "hex");
  }

  const base64 = Buffer.from(trimmed, "base64");
  if (base64.length === 32) {
    return base64;
  }

  throw new Error("SESSION_KEY_ENCRYPTION_KEY must be a 32-byte hex or base64 key.");
}
