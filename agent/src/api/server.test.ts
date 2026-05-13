import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Wallet } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentApiServer } from "./server.js";
import { PortfolioSnapshotsRepository } from "../persistence/portfolio-snapshots.repository.js";
import { RiskSnapshotsRepository } from "../persistence/risk-snapshots.repository.js";
import { SetupService } from "../services/setup.service.js";
import type { TelegramAlertService } from "../services/telegram-alert.service.js";
import { UsersRepository } from "../persistence/users.repository.js";
import { createTestConfig } from "../test-helpers/env.js";

let server: ReturnType<typeof createAgentApiServer>;
let baseUrl: string;
let dataDirectory: string;
let wallet: Wallet;
let message: string;
let signature: string;
let portfolioSnapshots: PortfolioSnapshotsRepository;
let riskSnapshots: RiskSnapshotsRepository;
let telegramAlerts: TelegramAlertService;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "riskguard-api-"));
  wallet = Wallet.createRandom();
  message = `Register Somnia RiskGuard monitored wallet: ${wallet.address}`;
  signature = await wallet.signMessage(message);
  portfolioSnapshots = new PortfolioSnapshotsRepository(dataDirectory);
  riskSnapshots = new RiskSnapshotsRepository(dataDirectory);
  const setupService = new SetupService(
    new UsersRepository(dataDirectory),
    createTestConfig()
  );
  telegramAlerts = {
    health: vi.fn().mockResolvedValue({ ok: true, enabled: true }),
    linkChat: vi.fn().mockImplementation(async (input) => ({
      telegramBindingId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      walletAddress: input.walletAddress,
      chatId: input.chatId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })),
    processCallback: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    sendRiskAlert: vi.fn().mockResolvedValue({ alertId: "33333333-3333-4333-8333-333333333333" })
  } as unknown as TelegramAlertService;
  server = createAgentApiServer({
    setupService,
    portfolioSnapshots,
    riskSnapshots,
    telegramAlerts,
    health: () => ({ ok: true })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  baseUrl = `http://${address.address}:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(dataDirectory, { force: true, recursive: true });
});

describe("agent setup API", () => {
  it("wraps successful responses in data and meta", async () => {
    const response = await fetch(`${baseUrl}/api/setup/readiness`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.agentWallet.ready).toBe(true);
    expect(payload.meta.requestId).toBeDefined();
  });

  it("persists checksum-normalized monitored wallet registrations", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        message,
        signature
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.walletAddress).toBe(
      wallet.address
    );
  });

  it("rejects private-key bearing setup payloads", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        message,
        signature,
        privateKey: "0xsecret"
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_failed");
  });

  it("returns validation errors for invalid checksum wallet input", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: "0x8ba1f109551bD432803012645Ac136ddd64DBA72",
        message,
        signature
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_failed");
  });

  it("rejects oversized request bodies", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        message: "x".repeat(1_048_577),
        signature
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload.error.code).toBe("payload_too_large");
  });

  it("returns latest portfolio and risk snapshots through read APIs", async () => {
    await portfolioSnapshots.append({
      walletAddress: wallet.address,
      source: "demo",
      totalValueUsd: "1000",
      assets: [{ symbol: "STT", balance: "10", valueUsd: "1000" }],
      rewards: [],
      riskSignals: []
    });
    await riskSnapshots.append({
      walletAddress: wallet.address,
      score: 75,
      explanation: "Informational risk analysis.",
      provider: "groq",
      threshold: { alertThreshold: 70, exceeded: true },
      safeNextSteps: ["Review risk factors."]
    });

    const portfolioResponse = await fetch(
      `${baseUrl}/api/portfolios/latest?walletAddress=${wallet.address}`
    );
    const riskResponse = await fetch(
      `${baseUrl}/api/risk-snapshots/latest?walletAddress=${wallet.address}`
    );

    const portfolioPayload = await portfolioResponse.json();
    const riskPayload = await riskResponse.json();

    expect(portfolioPayload.data.walletAddress).toBe(wallet.address);
    expect(riskPayload.data.score).toBe(75);
  });

  it("returns latest state by timestamp instead of insertion order", async () => {
    await portfolioSnapshots.append({
      walletAddress: wallet.address,
      source: "demo",
      totalValueUsd: "1",
      assets: [],
      rewards: [],
      riskSignals: [],
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    await portfolioSnapshots.append({
      walletAddress: wallet.address,
      source: "demo",
      totalValueUsd: "2",
      assets: [],
      rewards: [],
      riskSignals: [],
      createdAt: "2025-01-01T00:00:00.000Z"
    });

    const response = await fetch(`${baseUrl}/api/portfolios/latest`);
    const payload = await response.json();

    expect(payload.data.totalValueUsd).toBe("1");
  });

  it("reports server misconfiguration when latest-state repositories are missing", async () => {
    const setupService = new SetupService(
      new UsersRepository(dataDirectory),
      createTestConfig()
    );
    const misconfiguredServer = createAgentApiServer({ setupService });
    misconfiguredServer.listen(0, "127.0.0.1");
    await once(misconfiguredServer, "listening");
    const address = misconfiguredServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP server address");
    }

    try {
      const response = await fetch(
        `http://${address.address}:${address.port}/api/portfolios/latest`
      );
      const payload = await response.json();

      expect(response.status).toBe(500);
      expect(payload.error.code).toBe("server_misconfigured");
    } finally {
      await new Promise<void>((resolve, reject) => {
        misconfiguredServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns validation errors for invalid latest-state wallet query params", async () => {
    const response = await fetch(
      `${baseUrl}/api/portfolios/latest?walletAddress=0x123`
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_failed");
  });

  it("exposes Telegram health and binding routes", async () => {
    const healthResponse = await fetch(`${baseUrl}/api/telegram/health`);
    const bindResponse = await fetch(`${baseUrl}/api/telegram/bindings`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        chatId: "987654321"
      })
    });
    const healthPayload = await healthResponse.json();
    const bindPayload = await bindResponse.json();

    expect(healthResponse.status).toBe(200);
    expect(healthPayload.data.ok).toBe(true);
    expect(bindResponse.status).toBe(201);
    expect(bindPayload.data.chatId).toBe("987654321");
  });

  it("sends a test Telegram alert from the latest risk snapshot", async () => {
    await riskSnapshots.append({
      walletAddress: wallet.address,
      score: 76,
      explanation: "Informational risk analysis.",
      provider: "groq",
      threshold: { alertThreshold: 70, exceeded: true },
      safeNextSteps: ["Review risk factors."]
    });

    const response = await fetch(`${baseUrl}/api/telegram/test-alert`, {
      method: "POST"
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.alertId).toBe("33333333-3333-4333-8333-333333333333");
    expect(telegramAlerts.sendRiskAlert).toHaveBeenCalledOnce();
  });
});
