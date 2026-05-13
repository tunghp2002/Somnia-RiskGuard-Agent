import { getAddress } from "ethers";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { SomniaAgentKitClient } from "../integrations/somnia/somnia-agent-kit.client.js";
import {
  type CreatePortfolioSnapshotInput,
  type PortfolioSnapshot,
  PortfolioSnapshotsRepository,
  portfolioAssetSchema,
  rewardSignalSchema,
  riskSignalSchema
} from "../persistence/portfolio-snapshots.repository.js";
import type { UsersRepository } from "../persistence/users.repository.js";
import type { AuditService } from "./audit.service.js";

const somniaPortfolioResponseSchema = z.object({
  totalValueUsd: z.string().regex(/^\d+(\.\d+)?$/),
  assets: z.array(portfolioAssetSchema),
  rewards: z.array(rewardSignalSchema).default([]),
  riskSignals: z.array(riskSignalSchema).default([])
});

export interface PortfolioChangeResult {
  previousSnapshot?: PortfolioSnapshot;
  currentSnapshot: PortfolioSnapshot;
  changedFields: string[];
  shouldAnalyzeRisk: boolean;
}

export interface PortfolioServiceOptions {
  demoMode?: boolean;
}

export class PortfolioService {
  public constructor(
    private readonly users: UsersRepository,
    private readonly snapshots: PortfolioSnapshotsRepository,
    private readonly audit: AuditService,
    private readonly somnia?: SomniaAgentKitClient,
    private readonly options: PortfolioServiceOptions = {}
  ) {}

  public async collectForConfiguredWallets(): Promise<PortfolioChangeResult[]> {
    const users = await this.users.list();

    if (users.length === 0) {
      await this.audit.record({
        eventType: "portfolio.monitor.skipped",
        status: "skipped",
        metadata: { reason: "no_monitored_wallet" }
      });
      return [];
    }

    const results: PortfolioChangeResult[] = [];

    for (const user of users) {
      try {
        results.push(await this.collectForWallet(user.walletAddress));
      } catch (error) {
        await this.audit.record({
          eventType: "portfolio.monitor.failed",
          status: "failed",
          metadata: {
            walletAddress: user.walletAddress,
            reason: error instanceof Error ? error.message : "portfolio monitor failed"
          }
        });
      }
    }

    return results;
  }

  public async collectForWallet(walletAddress: string): Promise<PortfolioChangeResult> {
    const checksumAddress = getAddress(walletAddress);
    const previousSnapshot = await this.snapshots.latestForWallet(checksumAddress);
    const input = {
      ...(await this.readPortfolio(checksumAddress)),
      portfolioSnapshotId: randomUUID(),
      createdAt: new Date().toISOString()
    };
    const candidateSnapshot = {
      ...input,
      walletAddress: checksumAddress
    } as PortfolioSnapshot;
    const change = this.detectChanges(previousSnapshot, candidateSnapshot);
    const currentSnapshot = await this.snapshots.append({
      ...input,
      change: {
        previousPortfolioSnapshotId: previousSnapshot?.portfolioSnapshotId,
        changedFields: change.changedFields,
        shouldAnalyzeRisk: change.shouldAnalyzeRisk
      }
    });
    const persistedChange = { ...change, currentSnapshot };

    await this.audit.record({
      eventType: "portfolio.snapshot.collected",
      status: "succeeded",
      metadata: {
        walletAddress: checksumAddress,
        portfolioSnapshotId: currentSnapshot.portfolioSnapshotId,
        source: currentSnapshot.source,
        shouldAnalyzeRisk: persistedChange.shouldAnalyzeRisk,
        changedFields: persistedChange.changedFields
      }
    });

    if (!persistedChange.shouldAnalyzeRisk) {
      await this.audit.record({
        eventType: "risk.analysis.skipped",
        status: "skipped",
        metadata: {
          walletAddress: checksumAddress,
          reason: "no_meaningful_portfolio_change"
        }
      });
    }

    return persistedChange;
  }

  public detectChanges(
    previousSnapshot: PortfolioSnapshot | undefined,
    currentSnapshot: PortfolioSnapshot
  ): PortfolioChangeResult {
    if (!previousSnapshot) {
      return {
        currentSnapshot,
        changedFields: ["initial_snapshot"],
        shouldAnalyzeRisk: true
      };
    }

    const changedFields = [
      previousSnapshot.totalValueUsd !== currentSnapshot.totalValueUsd
        ? "totalValueUsd"
        : undefined,
      JSON.stringify(normalizeAssets(previousSnapshot.assets)) !==
      JSON.stringify(normalizeAssets(currentSnapshot.assets))
        ? "assets"
        : undefined,
      JSON.stringify(normalizeRewards(previousSnapshot.rewards)) !==
      JSON.stringify(normalizeRewards(currentSnapshot.rewards))
        ? "rewards"
        : undefined,
      JSON.stringify(normalizeRiskSignals(previousSnapshot.riskSignals)) !==
      JSON.stringify(normalizeRiskSignals(currentSnapshot.riskSignals))
        ? "riskSignals"
        : undefined
    ].filter((field): field is string => Boolean(field));

    return {
      previousSnapshot,
      currentSnapshot,
      changedFields,
      shouldAnalyzeRisk: changedFields.length > 0
    };
  }

  private async readPortfolio(walletAddress: string): Promise<CreatePortfolioSnapshotInput> {
    if (!this.somnia) {
      if (this.options.demoMode) {
        return this.createDemoPortfolio(walletAddress);
      }

      throw new Error("Somnia client is not configured and demo mode is disabled");
    }

    try {
      const health = await this.somnia.health();
      if (!health.ok || !health.executionEnabled) {
        throw new Error("Somnia integration health check failed");
      }

      const result = await this.somnia.callTool({
        toolName: "getPortfolio",
        stateChanging: false,
        args: { walletAddress }
      });
      const parsed = somniaPortfolioResponseSchema.parse(result.result);

      return {
        walletAddress,
        source: "somnia",
        ...parsed
      };
    } catch (error) {
      await this.audit.record({
        eventType: "portfolio.monitor.failed",
        status: "failed",
        metadata: {
          walletAddress,
          reason: error instanceof Error ? error.message : "portfolio read failed"
        }
      });
      throw error;
    }
  }

  private createDemoPortfolio(walletAddress: string): CreatePortfolioSnapshotInput {
    return {
      walletAddress,
      source: "demo",
      totalValueUsd: "12500",
      assets: [
        {
          symbol: "STT",
          balance: "1000",
          valueUsd: "10000"
        },
        {
          symbol: "LP-DEMO",
          balance: "25",
          valueUsd: "2500"
        }
      ],
      rewards: [
        {
          protocol: "demo-staking",
          claimableValueUsd: "12"
        }
      ],
      riskSignals: [
        {
          signalType: "concentration",
          severity: "medium",
          description: "Portfolio is concentrated in one primary asset."
        }
      ]
    };
  }
}

function normalizeAssets(assets: PortfolioSnapshot["assets"]) {
  return [...assets].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function normalizeRewards(rewards: PortfolioSnapshot["rewards"]) {
  return [...rewards].sort((a, b) => a.protocol.localeCompare(b.protocol));
}

function normalizeRiskSignals(riskSignals: PortfolioSnapshot["riskSignals"]) {
  return [...riskSignals].sort((a, b) =>
    `${a.signalType}:${a.severity}:${a.description}`.localeCompare(
      `${b.signalType}:${b.severity}:${b.description}`
    )
  );
}
