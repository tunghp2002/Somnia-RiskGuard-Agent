import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Wallet } from "ethers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuditEventsRepository } from "../persistence/audit-events.repository.js";
import { AlertsRepository } from "../persistence/alerts.repository.js";
import { ActionNoncesRepository } from "../persistence/action-nonces.repository.js";
import { PortfolioSnapshotsRepository } from "../persistence/portfolio-snapshots.repository.js";
import { TelegramBindingsRepository } from "../persistence/telegram-bindings.repository.js";
import { UsersRepository } from "../persistence/users.repository.js";
import type {
  TelegramClient,
  TelegramSendMessageInput
} from "../integrations/telegram/telegram.client.js";
import {
  createCompactTelegramCallbackData
} from "../integrations/telegram/callback-signing.js";
import { createTestConfig } from "../test-helpers/env.js";
import { AuditService } from "./audit.service.js";
import { TelegramAlertService } from "./telegram-alert.service.js";

class FakeTelegramClient implements TelegramClient {
  public messages: TelegramSendMessageInput[] = [];
  public failNextSend = false;

  public constructor(private readonly ok = true) {}

  public health() {
    return this.ok
      ? { ok: true, enabled: true }
      : { ok: false, enabled: false, reason: "disabled" };
  }

  public async sendMessage(input: TelegramSendMessageInput) {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error("send failed");
    }

    this.messages.push(input);
    return { messageId: `${this.messages.length}` };
  }
}

let dataDirectory: string;
let users: UsersRepository;
let bindings: TelegramBindingsRepository;
let alerts: AlertsRepository;
let nonces: ActionNoncesRepository;
let portfolios: PortfolioSnapshotsRepository;
let auditEvents: AuditEventsRepository;
let audit: AuditService;
let telegram: FakeTelegramClient;
let wallet: Wallet;

function buildService(client = telegram) {
  return new TelegramAlertService(
    createTestConfig(),
    users,
    bindings,
    alerts,
    nonces,
    portfolios,
    client,
    audit
  );
}

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "riskguard-telegram-"));
  users = new UsersRepository(dataDirectory);
  bindings = new TelegramBindingsRepository(dataDirectory);
  alerts = new AlertsRepository(dataDirectory);
  nonces = new ActionNoncesRepository(dataDirectory);
  portfolios = new PortfolioSnapshotsRepository(dataDirectory);
  auditEvents = new AuditEventsRepository(dataDirectory);
  audit = new AuditService(auditEvents);
  telegram = new FakeTelegramClient();
  wallet = Wallet.createRandom();
});

afterEach(async () => {
  await rm(dataDirectory, { force: true, recursive: true });
});

describe("TelegramAlertService", () => {
  it("persists Telegram chat bindings for registered wallets", async () => {
    await users.upsertMonitoredWallet(wallet.address);
    const service = buildService();

    const binding = await service.linkChat({
      walletAddress: wallet.address,
      chatId: "987654321",
      telegramUserId: "12345"
    });

    expect(binding.walletAddress).toBe(wallet.address);
    expect(binding.chatId).toBe("987654321");
    await expect(bindings.latestForWallet(wallet.address)).resolves.toMatchObject({
      chatId: "987654321"
    });
  });

  it("removes Telegram chat bindings for a wallet", async () => {
    await users.upsertMonitoredWallet(wallet.address);
    const service = buildService();
    await service.linkChat({
      walletAddress: wallet.address,
      chatId: "987654321"
    });

    const removed = await service.unlinkChat(wallet.address);

    expect(removed?.chatId).toBe("987654321");
    await expect(bindings.latestForWallet(wallet.address)).resolves.toBeUndefined();
    await expect(auditEvents.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "telegram.binding.removed" })
      ])
    );
  });

  it("acknowledges valid callbacks and rejects replayed callbacks", async () => {
    const user = await users.upsertMonitoredWallet(wallet.address);
    await bindings.upsert({
      userId: user.userId,
      walletAddress: wallet.address,
      chatId: "987654321",
      telegramUserId: "12345"
    });
    const service = buildService();
    const alert = await alerts.append({
      userId: user.userId,
      walletAddress: wallet.address,
      chatId: "987654321",
      riskSnapshotId: "11111111-1111-4111-8111-111111111111",
      status: "sent",
      severity: "high",
      score: 82,
      explanation: "Portfolio concentration increased.",
      message: "Somnia RiskGuard Alert"
    });
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const nonce = await nonces.create({
      userId: user.userId,
      actionType: "acknowledge_alert",
      chatId: "987654321",
      expiresAt,
      alertId: alert.alertId
    });
    const callbackData = createCompactTelegramCallbackData(
      nonce.actionNonce,
      createTestConfig().telegram.webhookSecret ?? ""
    );

    const accepted = await service.processCallback({
      chatId: "987654321",
      telegramUserId: "12345",
      data: callbackData
    });
    const replayed = await service.processCallback({
      chatId: "987654321",
      telegramUserId: "12345",
      data: callbackData
    });

    expect(accepted.ok).toBe(true);
    expect(replayed.ok).toBe(false);
    await expect(alerts.findById(alert.alertId)).resolves.toMatchObject({
      status: "acknowledged"
    });
  });

  it("rejects expired callbacks before side effects", async () => {
    const user = await users.upsertMonitoredWallet(wallet.address);
    await bindings.upsert({
      userId: user.userId,
      walletAddress: wallet.address,
      chatId: "987654321"
    });
    const service = buildService();
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    const nonce = await nonces.create({
      userId: user.userId,
      actionType: "refresh_analysis",
      chatId: "987654321",
      expiresAt
    });
    const data = createCompactTelegramCallbackData(
      nonce.actionNonce,
      createTestConfig().telegram.webhookSecret ?? ""
    );

    const result = await service.processCallback({ chatId: "987654321", data });

    expect(result.ok).toBe(false);
    expect(telegram.messages).toHaveLength(0);
    await expect(auditEvents.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "telegram.callback.rejected" })
      ])
    );
  });

  it("routes safe approvals through policy gates and rejects unsupported actions", async () => {
    const user = await users.upsertMonitoredWallet(wallet.address);
    await bindings.upsert({
      userId: user.userId,
      walletAddress: wallet.address,
      chatId: "987654321"
    });
    const service = buildService();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const nonce = await nonces.create({
      userId: user.userId,
      actionType: "approve_safe_action",
      chatId: "987654321",
      expiresAt,
      walletAddress: wallet.address,
      safeAction: "transfer_all"
    });
    const data = createCompactTelegramCallbackData(
      nonce.actionNonce,
      createTestConfig().telegram.webhookSecret ?? ""
    );

    const result = await service.processCallback({ chatId: "987654321", data });

    expect(result.ok).toBe(false);
    expect(result.policyDecision).toMatchObject({
      allowed: false,
      policyId: "telegram.safe-action.unsupported"
    });
  });
});
