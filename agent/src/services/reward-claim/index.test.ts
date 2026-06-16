import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Wallet } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditService } from "../audit.service.js";
import { RewardClaimService, type RewardClaimNotifier } from "./index.js";
import { SomniaAgentKitClient, type SomniaAgentKitAdapter } from "../../integrations/somnia/somnia-agent-kit.client.js";
import { AuditEventsRepository } from "../../persistence/audit-events.repository.js";
import { RewardClaimsRepository, type RewardFixtureRecord } from "../../persistence/reward-claims.repository.js";
import { UsersRepository } from "../../persistence/users.repository.js";
import { createTestConfig } from "../../test-helpers/env.js";

let dataDirectory: string;
let wallet: Wallet;
let target: Wallet;
let rewards: RewardClaimsRepository;
let auditEvents: AuditEventsRepository;
let users: UsersRepository;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "riskguard-rewards-"));
  wallet = Wallet.createRandom();
  target = Wallet.createRandom();
  rewards = new RewardClaimsRepository(dataDirectory);
  auditEvents = new AuditEventsRepository(dataDirectory);
  users = new UsersRepository(dataDirectory);
  await users.upsertMonitoredWallet(wallet.address);
});

afterEach(async () => {
  await rm(dataDirectory, { force: true, recursive: true });
});

function createService(options: {
  adapter?: SomniaAgentKitAdapter;
  notifier?: RewardClaimNotifier;
  repository?: RewardClaimsRepository;
} = {}) {
  const config = createTestConfig();
  return new RewardClaimService(
    options.repository ?? rewards,
    config,
    new AuditService(auditEvents, { info: vi.fn() }),
    options.adapter ? new SomniaAgentKitClient(config, options.adapter) : undefined,
    options.notifier,
    users
  );
}

async function configureAndFixture(service: RewardClaimService, overrides: {
  autoClaimEnabled?: boolean;
  minRewardValueUsd?: number;
  maxClaimGasUsd?: number;
  valueUsd?: number;
  gasUsd?: number;
} = {}) {
  await service.configure({
    walletAddress: wallet.address,
    autoClaimEnabled: overrides.autoClaimEnabled ?? true,
    minRewardValueUsd: overrides.minRewardValueUsd ?? 1,
    maxClaimGasUsd: overrides.maxClaimGasUsd ?? 2
  });
  return service.addDemoFixture({
    walletAddress: wallet.address,
    protocol: "Somnia Staking",
    rewardToken: "STT",
    valueUsd: overrides.valueUsd ?? 5,
    gasUsd: overrides.gasUsd ?? 1,
    target: target.address,
    calldataSummary: "claimRewards()"
  });
}

describe("reward claim service", () => {
  it("stores reward settings and exposes status with latest claim", async () => {
    const service = createService();

    const status = await service.configure({
      walletAddress: wallet.address,
      autoClaimEnabled: true,
      minRewardValueUsd: 1.5,
      maxClaimGasUsd: 0.25
    });

    expect(status.settings?.walletAddress).toBe(wallet.address);
    expect(status.settings?.minRewardValueUsd).toBe("1.5");
    expect(status.latestClaim).toBeNull();
  });

  it("claims eligible fixture rewards through the policy-gated Somnia boundary", async () => {
    const adapter: SomniaAgentKitAdapter = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      callTool: vi.fn().mockResolvedValue({ txHash: "0xabc123" })
    };
    const notifier: RewardClaimNotifier = {
      sendRewardClaimOutcome: vi.fn().mockResolvedValue(undefined)
    };
    const service = createService({ adapter, notifier });
    await configureAndFixture(service);

    const [result] = await service.run({ walletAddress: wallet.address });
    const claims = await rewards.listClaims(wallet.address);

    expect(result.status).toBe("completed");
    expect(result.detected).toBe(1);
    expect(claims[0]).toMatchObject({
      status: "succeeded",
      txHash: "0xabc123",
      valueUsd: "5",
      gasUsd: "1"
    });
    expect(adapter.callTool).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "claim_small_reward",
      stateChanging: true,
      target: target.address,
      calldataSummary: "claimRewards()"
    }));
    expect(notifier.sendRewardClaimOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded" })
    );
  });

  it("marks successful fixtures unclaimable so later job runs do not duplicate claims", async () => {
    const adapter: SomniaAgentKitAdapter = {
      health: vi.fn().mockResolvedValue({ ok: true }),
      callTool: vi.fn().mockResolvedValue({ txHash: "0xabc123" })
    };
    const service = createService({ adapter });
    await configureAndFixture(service);

    await service.run({ walletAddress: wallet.address });
    const [secondRun] = await service.run({ walletAddress: wallet.address });
    const claims = await rewards.listClaims(wallet.address);

    expect(secondRun.status).toBe("skipped");
    expect(secondRun.reason).toBe("no_claimable_fixtures");
    expect(claims).toHaveLength(1);
    expect(adapter.callTool).toHaveBeenCalledOnce();
  });

  it("skips disabled or uneconomic claims without calling Somnia", async () => {
    const adapter: SomniaAgentKitAdapter = {
      health: vi.fn(),
      callTool: vi.fn()
    };
    const service = createService({ adapter });
    await configureAndFixture(service, { autoClaimEnabled: false });

    await service.run({ walletAddress: wallet.address });
    const claims = await rewards.listClaims(wallet.address);

    expect(claims[0]).toMatchObject({
      status: "skipped",
      reason: "Auto-claim is disabled for this wallet."
    });
    expect(adapter.callTool).not.toHaveBeenCalled();
  });

  it("records execution failures without retrying or bypassing policy", async () => {
    const adapter: SomniaAgentKitAdapter = {
      health: vi.fn(),
      callTool: vi.fn().mockRejectedValue(new Error("rpc down"))
    };
    const service = createService({ adapter });
    await configureAndFixture(service);

    await service.run({ walletAddress: wallet.address });
    const claims = await rewards.listClaims(wallet.address);

    expect(claims[0]).toMatchObject({ status: "failed", reason: "rpc down" });
    expect(adapter.callTool).toHaveBeenCalledOnce();
  });

  it("denies unsupported autonomous actions through the reward policy", async () => {
    const service = createService();
    await configureAndFixture(service);

    const decision = await service.evaluatePolicy({
      walletAddress: wallet.address,
      actionType: "swap_all_rewards",
      rewardValueUsd: 5,
      gasUsd: 1,
      target: target.address,
      calldataSummary: "swapExactTokensForTokens(...)"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.policyId).toBe("reward.action.unsupported");
  });

  it("denies unsupported actions even when reward settings are not configured", async () => {
    const otherWallet = Wallet.createRandom();
    const service = createService();

    const decision = await service.evaluatePolicy({
      walletAddress: otherWallet.address,
      actionType: "transfer_all",
      rewardValueUsd: 0,
      gasUsd: 0,
      target: target.address,
      calldataSummary: "transfer(...)"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.policyId).toBe("reward.action.unsupported");
    await expect(auditEvents.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "reward.policy.denied", status: "denied" })
      ])
    );
  });

  it("isolates reward provider failures for a wallet", async () => {
    class FailingRepository extends RewardClaimsRepository {
      public override async listClaimableFixtures(): Promise<RewardFixtureRecord[]> {
        throw new Error("provider unavailable");
      }
    }
    const repository = new FailingRepository(dataDirectory);
    const service = createService({ repository });
    await repository.upsertSettings({
      walletAddress: wallet.address,
      autoClaimEnabled: true,
      minRewardValueUsd: "1",
      maxClaimGasUsd: "2",
      now: "2026-05-14T00:00:00.000Z"
    });

    const [result] = await service.run({ walletAddress: wallet.address });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("provider unavailable");
    await expect(auditEvents.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "reward.detection.failed", status: "failed" })
      ])
    );
  });

  it("records notification failures without changing the claim outcome", async () => {
    const adapter: SomniaAgentKitAdapter = {
      health: vi.fn(),
      callTool: vi.fn().mockResolvedValue({ txHash: "0xabc123" })
    };
    const notifier: RewardClaimNotifier = {
      sendRewardClaimOutcome: vi.fn().mockRejectedValue(new Error("telegram down"))
    };
    const service = createService({ adapter, notifier });
    await configureAndFixture(service);

    await service.run({ walletAddress: wallet.address });

    await expect(rewards.latestClaimForWallet(wallet.address)).resolves.toMatchObject({
      status: "succeeded"
    });
    await expect(auditEvents.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "reward.notification.failed", status: "failed" })
      ])
    );
  });
});
