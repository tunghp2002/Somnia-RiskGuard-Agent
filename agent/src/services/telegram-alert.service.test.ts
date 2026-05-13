import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Wallet } from "ethers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuditEventsRepository } from "../persistence/audit-events.repository.js";
import { AlertsRepository } from "../persistence/alerts.repository.js";
import { ActionNoncesRepository } from "../persistence/action-nonces.repository.js";
import { PortfolioSnapshotsRepository } from "../persistence/portfolio-snapshots.repository.js";
import type { RiskSnapshotRecord } from "../persistence/risk-snapshots.repository.js";
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
import type { RiskScoreService } from "./risk-score.service.js";
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

function riskSnapshot(overrides: Partial<RiskSnapshotRecord> = {}): RiskSnapshotRecord {
  return {
    riskSnapshotId: "11111111-1111-4111-8111-111111111111",
    walletAddress: wallet.address,
    status: "succeeded",
    score: 82,
    explanation: "Portfolio concentration increased.",
    provider: "groq",
    threshold: { alertThreshold: 70, exceeded: true },
    safeNextSteps: ["Review exposure."],
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function buildService(riskScore?: Partial<RiskScoreService>, client = telegram) {
  return new TelegramAlertService(
    createTestConfig(),
    users,
    bindings,
    alerts,
    nonces,
    portfolios,
    riskScore as RiskScoreService,
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

  it("fails closed when Telegram health is disabled", async () => {
    const user = await users.upsertMonitoredWallet(wallet.address);
    await bindings.upsert({
      userId: user.userId,
      walletAddress: wallet.address,
      chatId: "987654321"
    });
    const disabledClient = new FakeTelegramClient(false);
    const service = buildService({}, disabledClient);

    const alert = await service.sendRiskAlert(riskSnapshot());

    expect(alert).toBeUndefined();
    expect(disabledClient.messages).toHaveLength(0);
    await expect(auditEvents.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "telegram.alert.skipped" })
      ])
    );
  });

  it("sends threshold alerts with score, severity, explanation, and signed buttons", async () => {
    const user = await users.upsertMonitoredWallet(wallet.address);
    await bindings.upsert({
      userId: user.userId,
      walletAddress: wallet.address,
      chatId: "987654321",
      telegramUserId: "12345"
    });
    const service = buildService();

    const alert = await service.sendRiskAlert(riskSnapshot());

    expect(alert?.status).toBe("sent");
    expect(telegram.messages[0]?.text).toContain("Risk Score: 82/100");
    expect(telegram.messages[0]?.text).toContain("Severity: high");
    expect(telegram.messages[0]?.text).toContain("Portfolio concentration increased.");
    expect(telegram.messages[0]?.buttons).toHaveLength(3);
    expect(telegram.messages[0]?.buttons?.[0]?.callbackData.length).toBeLessThanOrEqual(64);
  });

  it("records failed alert delivery without unsafe retries", async () => {
    const user = await users.upsertMonitoredWallet(wallet.address);
    await bindings.upsert({
      userId: user.userId,
      walletAddress: wallet.address,
      chatId: "987654321"
    });
    telegram.failNextSend = true;
    const service = buildService();

    const alert = await service.sendRiskAlert(riskSnapshot());

    expect(alert?.status).toBe("failed");
    expect(telegram.messages).toHaveLength(0);
    await expect(auditEvents.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "telegram.alert.failed" })
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
    const alert = await service.sendRiskAlert(riskSnapshot());
    const callbackData = telegram.messages[0]?.buttons?.[0]?.callbackData;

    const accepted = await service.processCallback({
      chatId: "987654321",
      telegramUserId: "12345",
      data: callbackData ?? ""
    });
    const replayed = await service.processCallback({
      chatId: "987654321",
      telegramUserId: "12345",
      data: callbackData ?? ""
    });

    expect(accepted.ok).toBe(true);
    expect(replayed.ok).toBe(false);
    await expect(alerts.findById(alert?.alertId ?? "")).resolves.toMatchObject({
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

  it("refreshes risk analysis from the latest portfolio and reports it to Telegram", async () => {
    const user = await users.upsertMonitoredWallet(wallet.address);
    await bindings.upsert({
      userId: user.userId,
      walletAddress: wallet.address,
      chatId: "987654321"
    });
    await portfolios.append({
      walletAddress: wallet.address,
      source: "demo",
      totalValueUsd: "1000",
      assets: [],
      rewards: [],
      riskSignals: []
    });
    const service = buildService({
      analyze: async () => riskSnapshot({ riskSnapshotId: "22222222-2222-4222-8222-222222222222", score: 64 })
    });
    await service.sendRiskAlert(riskSnapshot());
    const callbackData = telegram.messages[0]?.buttons?.[1]?.callbackData;

    const result = await service.processCallback({
      chatId: "987654321",
      data: callbackData ?? ""
    });

    expect(result.ok).toBe(true);
    expect(telegram.messages.at(-1)?.text).toContain("Refreshed Risk Analysis");
    expect(telegram.messages.at(-1)?.text).toContain("Risk Score: 64/100");
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
