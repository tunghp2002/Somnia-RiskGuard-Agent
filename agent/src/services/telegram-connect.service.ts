import { randomUUID } from "node:crypto";

import type { TelegramAlertService } from "./telegram-alert.service.js";

export interface TelegramConnectSession {
  walletAddress: string;
  code: string;
  expiresAt: string;
  status: "waiting" | "connected" | "expired" | "failed";
  binding?: unknown;
}

export class TelegramConnectService {
  private readonly sessions = new Map<string, TelegramConnectSession>();

  public constructor(private readonly telegramAlerts: TelegramAlertService) {}

  public start(walletAddress: string): TelegramConnectSession {
    const code = randomUUID().slice(0, 8).toUpperCase();
    const session: TelegramConnectSession = {
      walletAddress,
      code,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      status: "waiting"
    };

    this.sessions.set(code, session);
    return session;
  }

  public latestForWallet(walletAddress: string): TelegramConnectSession | undefined {
    return [...this.sessions.values()]
      .filter((session) => session.walletAddress === walletAddress)
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
      code: session.code,
      expiresAt: session.expiresAt,
      status: session.status,
      connected: session.status === "connected",
      ...(session.binding ? { binding: session.binding } : {}),
      botDeepLink: `https://t.me/RiskGuardBot?start=${encodeURIComponent(session.code)}`
    };
  }

  public async confirm(input: {
    code: string;
    chatId: string;
    telegramUserId?: string;
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
      ...(input.telegramUserId ? { telegramUserId: input.telegramUserId } : {})
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
  }): Promise<{ ok: boolean; message: string }> {
    const code = extractConnectCode(input.text);

    if (!code) {
      return { ok: false, message: "Send the one-time RiskGuard code shown in the dashboard." };
    }

    const session = await this.confirm({
      code,
      chatId: input.chatId,
      ...(input.telegramUserId ? { telegramUserId: input.telegramUserId } : {})
    });

    if (!session) {
      return { ok: false, message: "Telegram Connect code was not found." };
    }

    if (session.status === "expired") {
      return { ok: false, message: "Telegram Connect code expired. Start a new connection." };
    }

    return { ok: true, message: "Telegram connected to RiskGuard." };
  }
}

function extractConnectCode(text: string): string | undefined {
  const trimmed = text.trim().toUpperCase();
  const startPayload = trimmed.match(/^\/START\s+([A-Z0-9]{8})$/)?.[1];
  const bareCode = trimmed.match(/^[A-Z0-9]{8}$/)?.[0];

  return startPayload ?? bareCode;
}
