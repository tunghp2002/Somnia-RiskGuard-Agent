import { describe, expect, it, vi } from "vitest";

import { PortfolioMonitorJob } from "./portfolio-monitor.job.js";
import type { PortfolioChangeResult, PortfolioService } from "../services/portfolio.service.js";
import type { RiskScoreService } from "../services/risk-score.service.js";

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
  it("runs risk analysis only for meaningful portfolio changes", async () => {
    const portfolioService = {
      collectForConfiguredWallets: vi.fn().mockResolvedValue([
        change(true),
        change(false)
      ])
    } as unknown as PortfolioService;
    const riskScoreService = {
      analyze: vi.fn().mockResolvedValue(undefined)
    } as unknown as RiskScoreService;
    const job = new PortfolioMonitorJob(portfolioService, riskScoreService);

    const result = await job.runOnce();

    expect(riskScoreService.analyze).toHaveBeenCalledOnce();
    expect(result.analyzedWallets).toEqual([
      "0x1111111111111111111111111111111111111111"
    ]);
  });
});
