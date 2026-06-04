import { describe, expect, it, vi } from "vitest";

import { PortfolioMonitorJob } from "./portfolio-monitor.job.js";
import type { PortfolioChangeResult, PortfolioService } from "../services/portfolio.service.js";

const change = (shouldAnalyzeRisk: boolean): PortfolioChangeResult => ({
  shouldAnalyzeRisk,
  changedFields: shouldAnalyzeRisk ? ["initial_snapshot"] : [],
  currentSnapshot: {
    portfolioSnapshotId: "11111111-1111-4111-8111-111111111111",
    walletAddress: "0x1111111111111111111111111111111111111111",
    source: "demo",
    totalValueUsd: "1000",
    assets: [],
    rewards: [],
    riskSignals: [],
    createdAt: new Date().toISOString()
  }
});

describe("portfolio monitor job", () => {
  it("collects portfolio changes for the configured wallets", async () => {
    const changes = [change(true), change(false)];
    const portfolioService = {
      collectForConfiguredWallets: vi.fn().mockResolvedValue(changes)
    } as unknown as PortfolioService;
    const job = new PortfolioMonitorJob(portfolioService);

    const result = await job.runOnce();

    expect(portfolioService.collectForConfiguredWallets).toHaveBeenCalledOnce();
    expect(result.changes).toEqual(changes);
  });
});
