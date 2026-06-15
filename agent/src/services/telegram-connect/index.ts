import { randomInt } from "node:crypto";

import {
  TelegramAlertServiceError,
  type TelegramAlertService
} from "../telegram-alert/index.js";

const connectCodeLength = 16;
const connectCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const connectCodePattern = new RegExp(`^[${connectCodeAlphabet}]{${connectCodeLength}}$`);

export interface TelegramConnectSession {
  walletAddress: string;
  smartAccountAddress?: string;
  code: string;
  expiresAt: string;
  status: "waiting" | "connected" | "expired" | "failed";
  binding?: unknown;
}

export class TelegramConnectService {
  private readonly sessions = new Map<string, TelegramConnectSession>();

  public constructor(
    private readonly telegramAlerts: TelegramAlertService,
    private readonly options: { botUsername?: string } = {}
  ) {}

  public botUrl() {
    return `https://t.me/${this.options.botUsername ?? "RiskGuardBot"}`;
  }

  public start(walletAddress: string, smartAccountAddress?: string): TelegramConnectSession {
    const code = this.createUniqueCode();
    const session: TelegramConnectSession = {
      walletAddress,
      ...(smartAccountAddress ? { smartAccountAddress } : {}),
      code,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      status: "waiting"
    };

    this.sessions.set(code, session);
    return session;
  }

  public latestForWallet(walletAddress: string): TelegramConnectSession | undefined {
    const normalizedWallet = walletAddress.toLowerCase();

    return [...this.sessions.values()]
      .filter((session) => session.walletAddress.toLowerCase() === normalizedWallet)
      .sort((left, right) => Date.parse(right.expiresAt) - Date.parse(left.expiresAt))[0];
  }

  public get(code: string): TelegramConnectSession | undefined {
    return this.sessions.get(code.toUpperCase());
  }

  public serialize(session: TelegramConnectSession) {
    const expired = session.status === "waiting" && Date.parse(session.expiresAt) <= Date.now();

    if (expired) {
      session.status = "expired";
      this.sessions.set(session.code, session);
    }

    return {
      walletAddress: session.walletAddress,
      ...(session.smartAccountAddress ? { smartAccountAddress: session.smartAccountAddress } : {}),
      code: session.code,
      expiresAt: session.expiresAt,
      status: session.status,
      connected: session.status === "connected",
      ...(session.binding ? { binding: session.binding } : {}),
      botDeepLink: `${this.botUrl()}?start=${encodeURIComponent(session.code)}`
    };
  }

  public async confirm(input: {
    code: string;
    chatId: string;
    telegramUserId?: string;
    telegramUsername?: string;
    telegramDisplayName?: string;
  }): Promise<TelegramConnectSession | undefined> {
    const code = input.code.toUpperCase();
    const session = this.sessions.get(code);

    if (!session) {
      return undefined;
    }

    if (Date.parse(session.expiresAt) <= Date.now()) {
      session.status = "expired";
      this.sessions.set(session.code, session);
      return session;
    }

    const binding = await this.telegramAlerts.linkChat({
      walletAddress: session.walletAddress,
      chatId: input.chatId,
      ...(session.smartAccountAddress ? { smartAccountAddress: session.smartAccountAddress } : {}),
      ...(input.telegramUserId ? { telegramUserId: input.telegramUserId } : {}),
      ...(input.telegramUsername ? { telegramUsername: input.telegramUsername } : {}),
      ...(input.telegramDisplayName ? { telegramDisplayName: input.telegramDisplayName } : {})
    });
    session.status = "connected";
    session.binding = binding;
    this.sessions.set(session.code, session);
    return session;
  }

  public async confirmFromText(input: {
    text: string;
    chatId: string;
    telegramUserId?: string;
    telegramUsername?: string;
    telegramDisplayName?: string;
  }): Promise<{ ok: boolean; message: string }> {
    const code = extractConnectCode(input.text);

    if (!code) {
      return { ok: false, message: "Open Telegram Connect from the RiskGuard dashboard, then press Start here." };
    }

    let session: TelegramConnectSession | undefined;
    try {
      session = await this.confirm({
        code,
        chatId: input.chatId,
        ...(input.telegramUserId ? { telegramUserId: input.telegramUserId } : {}),
        ...(input.telegramUsername ? { telegramUsername: input.telegramUsername } : {}),
        ...(input.telegramDisplayName ? { telegramDisplayName: input.telegramDisplayName } : {})
      });
    } catch (error) {
      const failedSession = this.sessions.get(code.toUpperCase());
      if (failedSession) {
        failedSession.status = "failed";
        this.sessions.set(failedSession.code, failedSession);
      }

      return {
        ok: false,
        message: telegramConnectFailureMessage(error)
      };
    }

    if (!session) {
      return { ok: false, message: "Telegram Connect code was not found." };
    }

    if (session.status === "expired") {
      return { ok: false, message: "Telegram Connect code expired. Start a new connection." };
    }

    return {
      ok: true,
      message: `Telegram alerts are now enabled for ${formatWallet(session.walletAddress)}. You can return to RiskGuard.`
    };
  }

  private createUniqueCode(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = generateConnectCode();
      if (!this.sessions.has(code)) {
        return code;
      }
    }

    throw new Error("Could not allocate a Telegram Connect code");
  }
}

function telegramConnectFailureMessage(error: unknown) {
  if (error instanceof TelegramAlertServiceError) {
    if (error.code === "monitored_wallet_not_found") {
      return "RiskGuard could not connect Telegram because this wallet profile is not registered yet. Return to the dashboard, save your profile, then try again.";
    }

    if (error.code === "telegram_not_configured") {
      return "RiskGuard Telegram is not configured on the agent server yet.";
    }

    return error.message;
  }

  return "RiskGuard could not complete Telegram Connect. Return to the dashboard and try again.";
}

function formatWallet(walletAddress: string) {
  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}

function extractConnectCode(text: string): string | undefined {
  const trimmed = text.trim().toUpperCase();
  const startPayload = trimmed.match(/^\/START(?:@\w+)?\s+([A-Z2-9]+)$/)?.[1];
  const bareCode = trimmed.match(/^[A-Z2-9]+$/)?.[0];
  const code = startPayload ?? bareCode;

  return code && connectCodePattern.test(code) ? code : undefined;
}

function generateConnectCode(): string {
  let code = "";

  for (let index = 0; index < connectCodeLength; index += 1) {
    code += connectCodeAlphabet[randomInt(connectCodeAlphabet.length)];
  }

  return code;
}
