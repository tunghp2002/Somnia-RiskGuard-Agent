import { describe, expect, it, vi } from "vitest";

import { PortfolioMonitorJob } from "./portfolio-monitor.job.js";
import type { PortfolioChangeResult, PortfolioService } from "../services/portfolio.service.js";
import type { RiskScoreService } from "../services/risk-score.service.js";
import type { TelegramAlertService } from "../services/telegram-alert.service.js";

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

  it("continues risk analysis after one changed wallet fails", async () => {
    const first = change(true);
    const second = {
      ...change(true),
      currentSnapshot: {
        ...change(true).currentSnapshot,
        portfolioSnapshotId: "22222222-2222-4222-8222-222222222222",
        walletAddress: "0x2222222222222222222222222222222222222222"
      }
    };
    const portfolioService = {
      collectForConfiguredWallets: vi.fn().mockResolvedValue([first, second])
    } as unknown as PortfolioService;
    const riskScoreService = {
      analyze: vi
        .fn()
        .mockRejectedValueOnce(new Error("provider down"))
        .mockResolvedValueOnce(undefined)
    } as unknown as RiskScoreService;
    const job = new PortfolioMonitorJob(portfolioService, riskScoreService);

    const result = await job.runOnce();

    expect(riskScoreService.analyze).toHaveBeenCalledTimes(2);
    expect(result.failedAnalysisWallets).toEqual([first.currentSnapshot.walletAddress]);
    expect(result.analyzedWallets).toEqual([second.currentSnapshot.walletAddress]);
  });

  it("sends Telegram alerts for risk snapshots created during analysis", async () => {
    const riskSnapshot = {
      riskSnapshotId: "33333333-3333-4333-8333-333333333333",
      walletAddress: "0x1111111111111111111111111111111111111111",
      status: "succeeded",
      score: 88,
      explanation: "Threshold crossed.",
      provider: "groq",
      threshold: { alertThreshold: 70, exceeded: true },
      safeNextSteps: [],
      createdAt: new Date().toISOString()
    };
    const portfolioService = {
      collectForConfiguredWallets: vi.fn().mockResolvedValue([change(true)])
    } as unknown as PortfolioService;
    const riskScoreService = {
      analyze: vi.fn().mockResolvedValue(riskSnapshot)
    } as unknown as RiskScoreService;
    const telegramAlerts = {
      sendRiskAlert: vi.fn().mockResolvedValue(undefined)
    } as unknown as TelegramAlertService;
    const job = new PortfolioMonitorJob(
      portfolioService,
      riskScoreService,
      telegramAlerts
    );

    await job.runOnce();

    expect(telegramAlerts.sendRiskAlert).toHaveBeenCalledWith(riskSnapshot);
  });
});
