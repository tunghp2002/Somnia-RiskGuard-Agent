import { getAddress } from "ethers";
import { z } from "zod";

import type { AgentConfig } from "../config/env.js";
import type { SomniaAgentKitClient } from "../integrations/somnia/somnia-agent-kit.client.js";
import { evaluateRewardClaimPolicy } from "../policies/reward-claim-policy.js";
import type { PolicyDecision } from "../policies/execution-policy.js";
import type { UsersRepository } from "../persistence/users.repository.js";
import {
  RewardClaimsRepository,
  type RewardClaimRecord,
  type RewardFixtureRecord,
  type RewardSettingsRecord
} from "../persistence/reward-claims.repository.js";
import type { AuditService } from "./audit.service.js";

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => getAddress(value));

const moneyNumberSchema = z.number().nonnegative();
const hexDataSchema = z.string().regex(/^0x[a-fA-F0-9]*$/);

export const rewardSettingsRequestSchema = z
  .object({
    walletAddress: addressSchema,
    autoClaimEnabled: z.boolean(),
    minRewardValueUsd: moneyNumberSchema,
    maxClaimGasUsd: moneyNumberSchema
  })
  .strict();

export const rewardFixtureRequestSchema = z
  .object({
    walletAddress: addressSchema,
    protocol: z.string().min(1),
    rewardToken: z.string().min(1),
    valueUsd: moneyNumberSchema,
    gasUsd: moneyNumberSchema,
    target: addressSchema,
    calldata: hexDataSchema.optional(),
    calldataSummary: z.string().min(1),
    claimable: z.boolean().optional()
  })
  .strict();

export const rewardRunRequestSchema = z
  .object({
    walletAddress: addressSchema.optional()
  })
  .strict();

export const rewardPolicyCheckRequestSchema = z
  .object({
    walletAddress: addressSchema,
    actionType: z.string().min(1).default("claim_small_reward"),
    rewardValueUsd: moneyNumberSchema,
    gasUsd: moneyNumberSchema,
    target: addressSchema,
    calldataSummary: z.string().min(1)
  })
  .strict();

export type RewardSettingsRequest = z.infer<typeof rewardSettingsRequestSchema>;
export type RewardFixtureRequest = z.infer<typeof rewardFixtureRequestSchema>;
export type RewardRunRequest = z.infer<typeof rewardRunRequestSchema>;
export type RewardPolicyCheckRequest = z.infer<typeof rewardPolicyCheckRequestSchema>;

export interface RewardClaimStatus {
  walletAddress: string;
  settings: RewardSettingsRecord | null;
  latestClaim: RewardClaimRecord | null;
  claimableRewards: RewardFixtureRecord[];
}

export interface RewardRunResult {
  walletAddress: string;
  detected: number;
  claims: RewardClaimRecord[];
  status: "skipped" | "completed" | "failed";
  reason?: string;
}

export interface RewardClaimNotifier {
  sendRewardClaimOutcome(claim: RewardClaimRecord): Promise<void>;
}

export class RewardClaimServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "RewardClaimServiceError";
  }
}

export class RewardClaimService {
  public constructor(
    private readonly rewards: RewardClaimsRepository,
    private readonly config: AgentConfig,
    private readonly audit?: AuditService,
    private readonly somnia?: SomniaAgentKitClient,
    private readonly notifier?: RewardClaimNotifier,
    private readonly users?: UsersRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  public async configure(input: RewardSettingsRequest): Promise<RewardClaimStatus> {
    const parsed = rewardSettingsRequestSchema.parse(input);

    if (this.users && !(await this.users.findByWalletAddress(parsed.walletAddress))) {
      throw new RewardClaimServiceError("monitored_wallet_not_found", "Monitored wallet is not registered", 404);
    }

    const settings = await this.rewards.upsertSettings({
      walletAddress: parsed.walletAddress,
      autoClaimEnabled: parsed.autoClaimEnabled,
      minRewardValueUsd: parsed.minRewardValueUsd.toString(),
      maxClaimGasUsd: parsed.maxClaimGasUsd.toString(),
      now: this.now().toISOString()
    });

    await this.audit?.record({
      eventType: "reward.settings.updated",
      status: "succeeded",
      metadata: {
        walletAddress: settings.walletAddress,
        autoClaimEnabled: settings.autoClaimEnabled,
        minRewardValueUsd: settings.minRewardValueUsd,
        maxClaimGasUsd: settings.maxClaimGasUsd
      }
    });

    return this.getStatus(settings.walletAddress);
  }

  public async addDemoFixture(input: RewardFixtureRequest): Promise<RewardFixtureRecord> {
    const parsed = rewardFixtureRequestSchema.parse(input);
    const fixture = await this.rewards.upsertFixture({
      walletAddress: parsed.walletAddress,
      protocol: parsed.protocol,
      rewardToken: parsed.rewardToken,
      valueUsd: parsed.valueUsd.toString(),
      gasUsd: parsed.gasUsd.toString(),
      target: parsed.target,
      ...(parsed.calldata ? { calldata: parsed.calldata } : {}),
      calldataSummary: parsed.calldataSummary,
      ...(parsed.claimable === undefined ? {} : { claimable: parsed.claimable }),
      now: this.now().toISOString()
    });

    await this.audit?.record({
      eventType: "reward.fixture.saved",
      status: "succeeded",
      metadata: {
        walletAddress: fixture.walletAddress,
        rewardFixtureId: fixture.rewardFixtureId,
        protocol: fixture.protocol,
        rewardToken: fixture.rewardToken
      }
    });

    return fixture;
  }

  public async getStatus(walletAddress: string): Promise<RewardClaimStatus> {
    const checksumAddress = getAddress(walletAddress);
    return {
      walletAddress: checksumAddress,
      settings: (await this.rewards.findSettings(checksumAddress)) ?? null,
      latestClaim: (await this.rewards.latestClaimForWallet(checksumAddress)) ?? null,
      claimableRewards: await this.rewards.listClaimableFixtures(checksumAddress)
    };
  }

  public async evaluatePolicy(input: RewardPolicyCheckRequest): Promise<PolicyDecision> {
    const parsed = rewardPolicyCheckRequestSchema.parse(input);
    const settings = await this.rewards.findSettings(parsed.walletAddress);

    if (!settings && parsed.actionType === "claim_small_reward") {
      throw new RewardClaimServiceError("reward_settings_not_configured", "Reward settings are not configured", 404);
    }

    const decision = evaluateRewardClaimPolicy({
      actionType: parsed.actionType,
      autoClaimEnabled: settings?.autoClaimEnabled ?? false,
      rewardValueUsd: parsed.rewardValueUsd,
      gasUsd: parsed.gasUsd,
      minRewardValueUsd: Number(settings?.minRewardValueUsd ?? this.config.rewards.minRewardValueUsd),
      maxClaimGasUsd: Number(settings?.maxClaimGasUsd ?? this.config.rewards.maxClaimGasUsd),
      signerAddress: this.config.somnia.agentWalletAddress,
      chainId: this.config.somnia.chainId,
      target: parsed.target,
      calldataSummary: parsed.calldataSummary,
      now: this.now()
    });

    await this.audit?.record({
      eventType: decision.allowed ? "reward.policy.allowed" : "reward.policy.denied",
      status: decision.allowed ? "succeeded" : "denied",
      metadata: {
        walletAddress: parsed.walletAddress,
        actionType: parsed.actionType,
        policyId: decision.policyId,
        reason: decision.reason
      }
    });

    return decision;
  }

  public async run(input: RewardRunRequest = {}): Promise<RewardRunResult[]> {
    const parsed = rewardRunRequestSchema.parse(input);

    if (parsed.walletAddress) {
      return [await this.runForWallet(parsed.walletAddress)];
    }

    const settings = await this.rewards.listSettings();
    const results: RewardRunResult[] = [];

    for (const record of settings) {
      try {
        results.push(await this.runForWallet(record.walletAddress));
      } catch (error) {
        const reason = error instanceof Error ? error.message : "reward evaluation failed";
        await this.audit?.record({
          eventType: "reward.run.failed",
          status: "failed",
          metadata: {
            walletAddress: record.walletAddress,
            reason
          }
        });
        results.push({
          walletAddress: record.walletAddress,
          detected: 0,
          claims: [],
          status: "failed",
          reason
        });
      }
    }

    return results;
  }

  public async runForWallet(walletAddress: string): Promise<RewardRunResult> {
    const checksumAddress = getAddress(walletAddress);
    const settings = await this.rewards.findSettings(checksumAddress);

    if (!settings) {
      throw new RewardClaimServiceError("reward_settings_not_configured", "Reward settings are not configured", 404);
    }

    let fixtures: RewardFixtureRecord[];
    try {
      fixtures = await this.rewards.listClaimableFixtures(checksumAddress);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "reward provider unavailable";
      await this.audit?.record({
        eventType: "reward.detection.failed",
        status: "failed",
        metadata: {
          walletAddress: checksumAddress,
          reason
        }
      });
      return { walletAddress: checksumAddress, detected: 0, claims: [], status: "failed", reason };
    }

    await this.audit?.record({
      eventType: "reward.detected",
      status: fixtures.length > 0 ? "succeeded" : "skipped",
      metadata: {
        walletAddress: checksumAddress,
        detected: fixtures.length,
        reason: fixtures.length > 0 ? "fixtures_available" : "no_claimable_fixtures"
      }
    });

    if (fixtures.length === 0) {
      return {
        walletAddress: checksumAddress,
        detected: 0,
        claims: [],
        status: "skipped",
        reason: "no_claimable_fixtures"
      };
    }

    const claims: RewardClaimRecord[] = [];
    for (const fixture of fixtures) {
      claims.push(await this.evaluateAndMaybeExecute(settings, fixture));
    }

    return {
      walletAddress: checksumAddress,
      detected: fixtures.length,
      claims,
      status: "completed"
    };
  }

  private async evaluateAndMaybeExecute(
    settings: RewardSettingsRecord,
    fixture: RewardFixtureRecord
  ): Promise<RewardClaimRecord> {
    const policyDecision = evaluateRewardClaimPolicy({
      actionType: "claim_small_reward",
      autoClaimEnabled: settings.autoClaimEnabled,
      rewardValueUsd: Number(fixture.valueUsd),
      gasUsd: Number(fixture.gasUsd),
      minRewardValueUsd: Number(settings.minRewardValueUsd),
      maxClaimGasUsd: Number(settings.maxClaimGasUsd),
      signerAddress: this.config.somnia.agentWalletAddress,
      chainId: this.config.somnia.chainId,
      target: fixture.target,
      calldataSummary: fixture.calldataSummary,
      now: this.now()
    });

    if (!policyDecision.allowed) {
      const claim = await this.rewards.appendClaim({
        walletAddress: fixture.walletAddress,
        rewardFixtureId: fixture.rewardFixtureId,
        protocol: fixture.protocol,
        rewardToken: fixture.rewardToken,
        status: "skipped",
        reason: policyDecision.reason,
        valueUsd: fixture.valueUsd,
        gasUsd: fixture.gasUsd,
        policyDecision,
        now: this.now().toISOString()
      });
      await this.audit?.record({
        eventType: "reward.claim.denied",
        status: "denied",
        metadata: {
          walletAddress: fixture.walletAddress,
          rewardClaimId: claim.rewardClaimId,
          policyId: policyDecision.policyId,
          reason: policyDecision.reason
        }
      });
      await this.notify(claim);
      return claim;
    }

    const attempted = await this.rewards.appendClaim({
      walletAddress: fixture.walletAddress,
      rewardFixtureId: fixture.rewardFixtureId,
      protocol: fixture.protocol,
      rewardToken: fixture.rewardToken,
      status: "attempted",
      valueUsd: fixture.valueUsd,
      gasUsd: fixture.gasUsd,
      policyDecision,
      now: this.now().toISOString()
    });

    await this.audit?.record({
      eventType: "reward.claim.attempted",
      status: "started",
      metadata: {
        walletAddress: fixture.walletAddress,
        rewardClaimId: attempted.rewardClaimId,
        policyId: policyDecision.policyId
      }
    });

    try {
      if (!this.somnia) {
        throw new Error("Somnia execution client is not configured");
      }

      const result = await this.somnia?.callTool({
        toolName: "claim_small_reward",
        stateChanging: true,
        policyDecision,
        target: fixture.target,
        ...(fixture.calldata ? { calldata: fixture.calldata } : {}),
        calldataSummary: fixture.calldataSummary,
        args: {
          walletAddress: fixture.walletAddress,
          protocol: fixture.protocol,
          rewardToken: fixture.rewardToken,
          valueUsd: fixture.valueUsd,
          gasUsd: fixture.gasUsd
        }
      });
      const txHash = extractTxHash(result?.result);
      const succeeded = await this.rewards.updateClaim(attempted.rewardClaimId, {
        status: "succeeded",
        ...(txHash ? { txHash } : {}),
        now: this.now().toISOString()
      });
      const claim = succeeded ?? attempted;
      await this.rewards.updateFixtureClaimable(
        fixture.rewardFixtureId,
        false,
        this.now().toISOString()
      );
      await this.audit?.record({
        eventType: "reward.claim.succeeded",
        status: "succeeded",
        metadata: {
          walletAddress: claim.walletAddress,
          rewardClaimId: claim.rewardClaimId,
          txHash
        }
      });
      await this.notify(claim);
      return claim;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "reward claim execution failed";
      const failed = await this.rewards.updateClaim(attempted.rewardClaimId, {
        status: "failed",
        reason,
        now: this.now().toISOString()
      });
      const claim = failed ?? attempted;
      await this.audit?.record({
        eventType: "reward.claim.failed",
        status: "failed",
        metadata: {
          walletAddress: claim.walletAddress,
          rewardClaimId: claim.rewardClaimId,
          reason
        }
      });
      await this.notify(claim);
      return claim;
    }
  }

  private async notify(claim: RewardClaimRecord) {
    try {
      await this.notifier?.sendRewardClaimOutcome(claim);
    } catch (error) {
      await this.audit?.record({
        eventType: "reward.notification.failed",
        status: "failed",
        metadata: {
          walletAddress: claim.walletAddress,
          rewardClaimId: claim.rewardClaimId,
          reason: error instanceof Error ? error.message : "reward notification failed"
        }
      });
    }
  }
}

function extractTxHash(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("txHash" in result)) {
    return undefined;
  }

  const txHash = (result as { txHash?: unknown }).txHash;
  return typeof txHash === "string" ? txHash : undefined;
}
