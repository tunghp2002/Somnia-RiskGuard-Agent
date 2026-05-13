import { getAddress } from "ethers";
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

export class PortfolioService {
  public constructor(
    private readonly users: UsersRepository,
    private readonly snapshots: PortfolioSnapshotsRepository,
    private readonly audit: AuditService,
    private readonly somnia?: SomniaAgentKitClient
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
      results.push(await this.collectForWallet(user.walletAddress));
    }

    return results;
  }

  public async collectForWallet(walletAddress: string): Promise<PortfolioChangeResult> {
    const checksumAddress = getAddress(walletAddress);
    const previousSnapshot = await this.snapshots.latestForWallet(checksumAddress);
    const input = await this.readPortfolio(checksumAddress);
    const currentSnapshot = await this.snapshots.append(input);
    const change = this.detectChanges(previousSnapshot, currentSnapshot);

    await this.audit.record({
      eventType: "portfolio.snapshot.collected",
      status: "succeeded",
      metadata: {
        walletAddress: checksumAddress,
        portfolioSnapshotId: currentSnapshot.portfolioSnapshotId,
        source: currentSnapshot.source,
        shouldAnalyzeRisk: change.shouldAnalyzeRisk,
        changedFields: change.changedFields
      }
    });

    if (!change.shouldAnalyzeRisk) {
      await this.audit.record({
        eventType: "risk.analysis.skipped",
        status: "skipped",
        metadata: {
          walletAddress: checksumAddress,
          reason: "no_meaningful_portfolio_change"
        }
      });
    }

    return change;
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
      JSON.stringify(previousSnapshot.assets) !== JSON.stringify(currentSnapshot.assets)
        ? "assets"
        : undefined,
      JSON.stringify(previousSnapshot.rewards) !== JSON.stringify(currentSnapshot.rewards)
        ? "rewards"
        : undefined,
      JSON.stringify(previousSnapshot.riskSignals) !== JSON.stringify(currentSnapshot.riskSignals)
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
      return this.createDemoPortfolio(walletAddress);
    }

    try {
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
