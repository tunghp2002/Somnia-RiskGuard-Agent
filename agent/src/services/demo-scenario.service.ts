import { getAddress } from "ethers";
import { z } from "zod";

import type { AgentConfig } from "../config/env.js";
import type { PortfolioSnapshotsRepository } from "../persistence/portfolio-snapshots.repository.js";
import type { RiskSnapshotsRepository } from "../persistence/risk-snapshots.repository.js";
import type { HeartbeatsRepository } from "../persistence/heartbeats.repository.js";
import type {
  RewardClaimRecord,
  RewardClaimsRepository
} from "../persistence/reward-claims.repository.js";
import type { UsersRepository } from "../persistence/users.repository.js";
import type { AuditService } from "./audit.service.js";

export const demoScenarioNameSchema = z.enum([
  "setup_ready",
  "risk_alert",
  "reward_claim",
  "missed_heartbeat",
  "full_demo"
]);

export const demoScenarioRequestSchema = z
  .object({
    scenario: demoScenarioNameSchema
  })
  .strict();

export type DemoScenarioName = z.infer<typeof demoScenarioNameSchema>;
export type DemoScenarioRequest = z.infer<typeof demoScenarioRequestSchema>;

export interface DemoScenarioReceipt {
  receiptId: string;
  eventType: string;
  status: "started" | "succeeded" | "skipped" | "denied" | "failed";
  reason: string;
  createdAt: string;
}

export interface DemoScenarioResult {
  scenario: DemoScenarioName;
  mode: "simulation";
  walletAddress: string;
  receipts: DemoScenarioReceipt[];
  createdAt: string;
}

const defaultDemoWalletAddress = "0x1111111111111111111111111111111111111111";
const demoBeneficiaryAddress = "0x2222222222222222222222222222222222222222";
const demoRewardTargetAddress = "0x3333333333333333333333333333333333333333";
const demoAutomationSignerAddress = "0x0000000000000000000000000000000000000000";

export class DemoScenarioService {
  public constructor(
    private readonly users: UsersRepository,
    private readonly portfolioSnapshots: PortfolioSnapshotsRepository,
    private readonly riskSnapshots: RiskSnapshotsRepository,
    private readonly heartbeats: HeartbeatsRepository,
    private readonly rewards: RewardClaimsRepository,
    private readonly audit: AuditService,
    private readonly config: AgentConfig,
    private readonly now: () => Date = () => new Date()
  ) {}

  public async run(input: DemoScenarioRequest): Promise<DemoScenarioResult> {
    const parsed = demoScenarioRequestSchema.parse(input);
    const walletAddress = getAddress(defaultDemoWalletAddress);
    const createdAt = this.now().toISOString();
    const receipts: DemoScenarioReceipt[] = [];

    if (parsed.scenario === "setup_ready" || parsed.scenario === "full_demo") {
      receipts.push(await this.seedSetup(walletAddress));
    }

    if (parsed.scenario === "risk_alert" || parsed.scenario === "full_demo") {
      receipts.push(await this.seedRisk(walletAddress));
    }

    if (parsed.scenario === "reward_claim" || parsed.scenario === "full_demo") {
      receipts.push(await this.seedReward(walletAddress));
    }

    if (parsed.scenario === "missed_heartbeat" || parsed.scenario === "full_demo") {
      receipts.push(await this.seedMissedHeartbeat(walletAddress));
    }

    await this.audit.record({
      eventType: "demo.scenario.ran",
      status: "succeeded",
      metadata: {
        mode: "simulation",
        scenario: parsed.scenario,
        walletAddress,
        receiptCount: receipts.length
      }
    });

    return {
      scenario: parsed.scenario,
      mode: "simulation",
      walletAddress,
      receipts,
      createdAt
    };
  }

  private async seedSetup(walletAddress: string): Promise<DemoScenarioReceipt> {
    await this.users.upsertMonitoredWallet(walletAddress);
    const event = await this.audit.record({
      eventType: "demo.setup.ready",
      status: "succeeded",
      metadata: {
        mode: "simulation",
        walletAddress,
        sessionKeyAddress: demoAutomationSignerAddress,
        chainId: this.config.somnia.chainId
      }
    });

    return {
      receiptId: event.auditEventId,
      eventType: event.eventType,
      status: event.status,
      reason: "Demo wallet registered as a monitored wallet without exposing any private key.",
      createdAt: event.createdAt
    };
  }

  private async seedRisk(walletAddress: string): Promise<DemoScenarioReceipt> {
    await this.portfolioSnapshots.append({
      walletAddress,
      source: "demo",
      totalValueUsd: "18420.50",
      assets: [
        { symbol: "STT", balance: "1240.5", valueUsd: "11164.50" },
        { symbol: "stSOM", balance: "320", valueUsd: "6080" },
        { symbol: "USDC", balance: "1176", valueUsd: "1176" }
      ],
      rewards: [
        { protocol: "Somnia Rewards", claimableValueUsd: "8.40" }
      ],
      riskSignals: [
        {
          signalType: "concentration",
          severity: "high",
          description: "STT exposure exceeds the demo policy comfort range."
        },
        {
          signalType: "drawdown",
          severity: "medium",
          description: "The monitored portfolio moved down 8.6% during the latest demo window."
        }
      ],
      change: {
        changedFields: ["assets", "riskSignals", "rewards"],
        shouldAnalyzeRisk: true
      }
    });
    await this.riskSnapshots.append({
      walletAddress,
      score: 82,
      explanation: "Demo risk alert: concentration and drawdown signals exceeded the configured threshold.",
      provider: "demo",
      threshold: {
        alertThreshold: this.config.riskScore.alertThreshold,
        exceeded: true
      },
      safeNextSteps: [
        "Review concentration before approving any action.",
        "Acknowledge the Telegram alert or refresh risk after portfolio changes.",
        "No transaction is authorized by the AI risk score alone."
      ]
    });
    const event = await this.audit.record({
      eventType: "risk.alert.demo",
      status: "succeeded",
      metadata: {
        mode: "simulation",
        walletAddress,
        score: 82,
        alertThreshold: this.config.riskScore.alertThreshold
      }
    });

    return {
      receiptId: event.auditEventId,
      eventType: event.eventType,
      status: event.status,
      reason: "Risk score crossed the alert threshold and produced safe next steps.",
      createdAt: event.createdAt
    };
  }

  private async seedReward(walletAddress: string): Promise<DemoScenarioReceipt> {
    const now = this.now().toISOString();
    await this.rewards.upsertSettings({
      walletAddress,
      autoClaimEnabled: true,
      minRewardValueUsd: "10",
      maxClaimGasUsd: "2",
      now
    });
    const fixture = await this.rewards.upsertFixture({
      walletAddress,
      protocol: "Somnia Rewards",
      rewardToken: "STT",
      valueUsd: "8.40",
      gasUsd: "2.80",
      target: demoRewardTargetAddress,
      calldataSummary: "claim(address,uint256) demo fixture",
      claimable: true,
      now
    });
    const claim: RewardClaimRecord = await this.rewards.appendClaim({
      walletAddress,
      rewardFixtureId: fixture.rewardFixtureId,
      protocol: fixture.protocol,
      rewardToken: fixture.rewardToken,
      status: "skipped",
      reason: "Reward value is below the configured minimum and gas is above the configured maximum.",
      valueUsd: fixture.valueUsd,
      gasUsd: fixture.gasUsd,
      policyDecision: {
        allowed: false,
        reason: "Reward value is below minimum and gas exceeds maximum.",
        policyId: "reward-claim.demo-deny",
        createdAt: now,
        toolName: "rewards.claim",
        signerAddress: demoAutomationSignerAddress,
        chainId: this.config.somnia.chainId,
        target: demoRewardTargetAddress,
        calldataSummary: fixture.calldataSummary
      },
      now
    });
    const event = await this.audit.record({
      eventType: "reward.claim.skipped",
      status: "skipped",
      metadata: {
        mode: "simulation",
        walletAddress,
        rewardClaimId: claim.rewardClaimId,
        reason: claim.reason
      }
    });

    return {
      receiptId: event.auditEventId,
      eventType: event.eventType,
      status: event.status,
      reason: claim.reason ?? "Reward claim skipped by policy.",
      createdAt: event.createdAt
    };
  }

  private async seedMissedHeartbeat(walletAddress: string): Promise<DemoScenarioReceipt> {
    const now = this.now();
    const lastHeartbeatAt = new Date(now.getTime() - 73 * 60 * 60 * 1000).toISOString();
    await this.heartbeats.upsertSettings({
      walletAddress,
      beneficiaryAddress: demoBeneficiaryAddress,
      intervalSeconds: 24 * 60 * 60,
      graceSeconds: 60 * 60,
      timelockSeconds: 24 * 60 * 60,
      reminderLeadSeconds: 60 * 60,
      reminderCooldownSeconds: 30 * 60,
      lastHeartbeatAt,
      contractState: {
        isExpired: true,
        timelockReady: true,
        executed: false,
        checkedAt: now.toISOString()
      }
    });
    await this.heartbeats.recordMissed(walletAddress, now.toISOString());
    const event = await this.audit.record({
      eventType: "heartbeat.missed.demo",
      status: "denied",
      metadata: {
        mode: "simulation",
        walletAddress,
        beneficiaryAddress: demoBeneficiaryAddress,
        reason: "Missed heartbeat and timelock-ready contract state are visible for review."
      }
    });

    return {
      receiptId: event.auditEventId,
      eventType: event.eventType,
      status: event.status,
      reason: "Heartbeat is missed in demo mode; beneficiary availability is visible but no browser transaction is sent.",
      createdAt: event.createdAt
    };
  }
}
