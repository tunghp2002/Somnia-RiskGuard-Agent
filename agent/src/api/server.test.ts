import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Wallet } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentApiServer } from "./server.js";
import { AuditEventsRepository } from "../persistence/audit-events.repository.js";
import { PortfolioSnapshotsRepository } from "../persistence/portfolio-snapshots.repository.js";
import { RiskSnapshotsRepository } from "../persistence/risk-snapshots.repository.js";
import { AuditService } from "../services/audit.service.js";
import { DemoScenarioService } from "../services/demo-scenario.service.js";
import { SetupService } from "../services/setup.service.js";
import type { SessionKeyService } from "../services/session-key.service.js";
import type { TelegramAlertService } from "../services/telegram-alert.service.js";
import { HeartbeatsRepository } from "../persistence/heartbeats.repository.js";
import { HeartbeatService } from "../services/heartbeat.service.js";
import { RewardClaimsRepository } from "../persistence/reward-claims.repository.js";
import { RewardClaimService } from "../services/reward-claim.service.js";
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
let auditEvents: AuditEventsRepository;
let telegramAlerts: TelegramAlertService;
let heartbeats: HeartbeatService;
let rewards: RewardClaimService;
const readySessionKeys = { ready: () => true } as unknown as SessionKeyService;

async function signedProof(signer: Wallet, purpose: string) {
  const proofMessage = `${purpose}: ${signer.address}`;
  return {
    message: proofMessage,
    signature: await signer.signMessage(proofMessage)
  };
}

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "riskguard-api-"));
  wallet = Wallet.createRandom();
  message = `Register Somnia RiskGuard monitored wallet: ${wallet.address}`;
  signature = await wallet.signMessage(message);
  portfolioSnapshots = new PortfolioSnapshotsRepository(dataDirectory);
  riskSnapshots = new RiskSnapshotsRepository(dataDirectory);
  auditEvents = new AuditEventsRepository(dataDirectory);
  const audit = new AuditService(auditEvents);
  const users = new UsersRepository(dataDirectory);
  heartbeats = new HeartbeatService(
    new HeartbeatsRepository(dataDirectory),
    createTestConfig(),
    audit,
    () => new Date("2026-05-14T00:00:00.000Z")
  );
  const rewardClaims = new RewardClaimsRepository(dataDirectory);
  rewards = new RewardClaimService(
    rewardClaims,
    createTestConfig(),
    audit,
    undefined,
    undefined,
    users,
    () => new Date("2026-05-14T00:00:00.000Z")
  );
  const setupService = new SetupService(
    users,
    createTestConfig(),
    audit,
    readySessionKeys
  );
  const demoScenarios = new DemoScenarioService(
    users,
    portfolioSnapshots,
    riskSnapshots,
    new HeartbeatsRepository(dataDirectory),
    rewardClaims,
    audit,
    createTestConfig(),
    () => new Date("2026-05-14T00:00:00.000Z")
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
    latestBindingForWallet: vi.fn().mockResolvedValue(undefined),
    unlinkChat: vi.fn().mockResolvedValue({
      telegramBindingId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      walletAddress: wallet.address,
      chatId: "987654321",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }),
    processCallback: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    sendRiskAlert: vi.fn().mockResolvedValue({ alertId: "33333333-3333-4333-8333-333333333333" })
  } as unknown as TelegramAlertService;
  server = createAgentApiServer({
    setupService,
    auditEvents,
    portfolioSnapshots,
    riskSnapshots,
    demoScenarios,
    telegramAlerts,
    heartbeats,
    rewards,
    publicChain: createTestConfig().publicChain,
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
    expect(payload.data.sessionKey.ready).toBe(true);
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

  it("persists wallet profile display names", async () => {
    const updateResponse = await fetch(`${baseUrl}/api/users/profile`, {
      method: "PATCH",
      body: JSON.stringify({
        walletAddress: wallet.address,
        displayName: "Somnia Builder"
      })
    });
    const updatePayload = await updateResponse.json();
    const readResponse = await fetch(
      `${baseUrl}/api/users/profile?walletAddress=${wallet.address}`
    );
    const readPayload = await readResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updatePayload.data.displayName).toBe("Somnia Builder");
    expect(readPayload.data.walletAddress).toBe(wallet.address);
    expect(readPayload.data.displayName).toBe("Somnia Builder");
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

  it("returns public chain metadata without secrets", async () => {
    const response = await fetch(`${baseUrl}/api/public-chain`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.chainId).toBe(50312);
    expect(payload.data.nativeCurrency.symbol).toBe("STT");
    expect(JSON.stringify(payload)).not.toContain("THIRDWEB_SECRET_KEY");
    expect(JSON.stringify(payload)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("moves Telegram Connect sessions from waiting to connected", async () => {
    await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        message,
        signature
      })
    });

    const startResponse = await fetch(`${baseUrl}/api/telegram/connect/start`, {
      method: "POST",
      body: JSON.stringify({ walletAddress: wallet.address })
    });
    const startPayload = await startResponse.json();

    expect(startResponse.status).toBe(201);
    expect(startPayload.data.status).toBe("waiting");
    expect(startPayload.data.botDeepLink).toContain("t.me/RiskGuardBot");

    const confirmResponse = await fetch(`${baseUrl}/api/telegram/connect/confirm`, {
      method: "POST",
      body: JSON.stringify({
        code: startPayload.data.code,
        chatId: "987654321",
        telegramUserId: "123456"
      })
    });
    const confirmPayload = await confirmResponse.json();

    expect(confirmResponse.status).toBe(200);
    expect(confirmPayload.data.status).toBe("connected");
    expect(confirmPayload.data.connected).toBe(true);
    expect(telegramAlerts.linkChat).toHaveBeenCalledWith({
      walletAddress: wallet.address,
      chatId: "987654321",
      telegramUserId: "123456"
    });
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
    const proof = await signedProof(wallet, "Link Telegram");
    const healthResponse = await fetch(`${baseUrl}/api/telegram/health`);
    const bindResponse = await fetch(`${baseUrl}/api/telegram/bindings`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        chatId: "987654321",
        ...proof
      })
    });
    const unlinkProof = await signedProof(wallet, "Unlink Telegram");
    const unlinkResponse = await fetch(`${baseUrl}/api/telegram/bindings`, {
      method: "DELETE",
      body: JSON.stringify({
        walletAddress: wallet.address,
        ...unlinkProof
      })
    });
    const healthPayload = await healthResponse.json();
    const bindPayload = await bindResponse.json();
    const unlinkPayload = await unlinkResponse.json();

    expect(healthResponse.status).toBe(200);
    expect(healthPayload.data.ok).toBe(true);
    expect(bindResponse.status).toBe(201);
    expect(bindPayload.data.chatId).toBe("987654321");
    expect(unlinkResponse.status).toBe(200);
    expect(unlinkPayload.data.unlinked).toBe(true);
  });

  it("exposes heartbeat settings, status, beneficiary status, and policy routes", async () => {
    const beneficiary = Wallet.createRandom();
    const configureProof = await signedProof(wallet, "Configure heartbeat");
    const policyProof = await signedProof(beneficiary, "Deadman policy check");
    const configureResponse = await fetch(`${baseUrl}/api/heartbeats/settings`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        beneficiaryAddress: beneficiary.address,
        intervalSeconds: 100,
        graceSeconds: 50,
        timelockSeconds: 75,
        reminderLeadSeconds: 25,
        ...configureProof
      })
    });
    const statusResponse = await fetch(
      `${baseUrl}/api/heartbeats/status?walletAddress=${wallet.address}`
    );
    const beneficiaryResponse = await fetch(
      `${baseUrl}/api/heartbeats/beneficiary-status?walletAddress=${wallet.address}&beneficiaryAddress=${beneficiary.address}`
    );
    const policyResponse = await fetch(`${baseUrl}/api/deadman/policy-check`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        requestedBy: beneficiary.address,
        ...policyProof
      })
    });

    const configurePayload = await configureResponse.json();
    const statusPayload = await statusResponse.json();
    const beneficiaryPayload = await beneficiaryResponse.json();
    const policyPayload = await policyResponse.json();

    expect(configureResponse.status).toBe(201);
    expect(configurePayload.data.nextDeadlineAt).toBe("2026-05-14T00:01:40.000Z");
    expect(statusPayload.data.state).toBe("healthy");
    expect(beneficiaryPayload.data.executionAvailable).toBe(false);
    expect(policyPayload.data.allowed).toBe(false);
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

  it("exposes reward settings, fixture, status, run, and policy routes", async () => {
    await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        message,
        signature
      })
    });
    const target = Wallet.createRandom();

    const settingsResponse = await fetch(`${baseUrl}/api/rewards/settings`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        autoClaimEnabled: true,
        minRewardValueUsd: 1,
        maxClaimGasUsd: 2
      })
    });
    const fixtureResponse = await fetch(`${baseUrl}/api/rewards/fixtures`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        protocol: "Somnia Staking",
        rewardToken: "STT",
        valueUsd: 5,
        gasUsd: 1,
        target: target.address,
        calldataSummary: "claimRewards()"
      })
    });
    const statusResponse = await fetch(
      `${baseUrl}/api/rewards/status?walletAddress=${wallet.address}`
    );
    const policyResponse = await fetch(`${baseUrl}/api/rewards/policy-check`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        actionType: "swap_all_rewards",
        rewardValueUsd: 5,
        gasUsd: 1,
        target: target.address,
        calldataSummary: "swapExactTokensForTokens(...)"
      })
    });
    const runResponse = await fetch(`${baseUrl}/api/rewards/run`, {
      method: "POST",
      body: JSON.stringify({ walletAddress: wallet.address })
    });

    const settingsPayload = await settingsResponse.json();
    const fixturePayload = await fixtureResponse.json();
    const statusPayload = await statusResponse.json();
    const policyPayload = await policyResponse.json();
    const runPayload = await runResponse.json();

    expect(settingsResponse.status).toBe(201);
    expect(settingsPayload.data.settings.autoClaimEnabled).toBe(true);
    expect(fixtureResponse.status).toBe(201);
    expect(fixturePayload.data.rewardToken).toBe("STT");
    expect(statusPayload.data.claimableRewards).toHaveLength(1);
    expect(policyPayload.data.allowed).toBe(false);
    expect(policyPayload.data.policyId).toBe("reward.action.unsupported");
    expect(runPayload.data[0].claims[0].status).toBe("failed");
    expect(runPayload.data[0].claims[0].reason).toBe("Somnia execution client is not configured");
  });

  it("returns recent audit events with secret metadata redacted", async () => {
    await auditEvents.append({
      eventType: "operator.test",
      status: "failed",
      metadata: {
        subsystem: "telegram",
        telegramToken: "secret-token",
        api_key: "snake-secret",
        nested: {
          apiKey: "secret-key"
        }
      }
    });

    const response = await fetch(`${baseUrl}/api/audit-events/recent?limit=1`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.events).toHaveLength(1);
    expect(payload.data.events[0].metadata.telegramToken).toBe("[REDACTED]");
    expect(payload.data.events[0].metadata.api_key).toBe("[REDACTED]");
    expect(payload.data.events[0].metadata.nested.apiKey).toBe("[REDACTED]");
  });

  it("runs deterministic demo scenarios through the API", async () => {
    const response = await fetch(`${baseUrl}/api/demo/scenarios`, {
      method: "POST",
      body: JSON.stringify({
        scenario: "full_demo"
      })
    });
    const payload = await response.json();
    const riskResponse = await fetch(
      `${baseUrl}/api/risk-snapshots/latest?walletAddress=${payload.data.walletAddress}`
    );
    const heartbeatResponse = await fetch(
      `${baseUrl}/api/heartbeats/status?walletAddress=${payload.data.walletAddress}`
    );
    const rewardResponse = await fetch(
      `${baseUrl}/api/rewards/status?walletAddress=${payload.data.walletAddress}`
    );

    const riskPayload = await riskResponse.json();
    const heartbeatPayload = await heartbeatResponse.json();
    const rewardPayload = await rewardResponse.json();

    expect(response.status).toBe(200);
    expect(payload.data.mode).toBe("simulation");
    expect(payload.data.walletAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(payload.data.receipts).toHaveLength(4);
    expect(riskPayload.data.score).toBe(82);
    expect(heartbeatPayload.data.executionAvailable).toBe(true);
    expect(rewardPayload.data.latestClaim.status).toBe("skipped");
  });
});
