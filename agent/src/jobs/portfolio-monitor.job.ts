import type { PortfolioService, PortfolioChangeResult } from "../services/portfolio.service.js";
import type { RiskScoreService } from "../services/risk-score.service.js";
import type { TelegramAlertService } from "../services/telegram-alert.service.js";

export interface PortfolioMonitorResult {
  changes: PortfolioChangeResult[];
  analyzedWallets: string[];
  failedAnalysisWallets: string[];
}

export class PortfolioMonitorJob {
  public constructor(
    private readonly portfolioService: PortfolioService,
    private readonly riskScoreService: RiskScoreService,
    private readonly telegramAlerts?: TelegramAlertService
  ) {}

  public async runOnce(): Promise<PortfolioMonitorResult> {
    const changes = await this.portfolioService.collectForConfiguredWallets();
    const analyzedWallets: string[] = [];
    const failedAnalysisWallets: string[] = [];

    for (const change of changes) {
      if (change.shouldAnalyzeRisk) {
        try {
          const riskSnapshot = await this.riskScoreService.analyze(change.currentSnapshot);
          await this.telegramAlerts?.sendRiskAlert(riskSnapshot);
          analyzedWallets.push(change.currentSnapshot.walletAddress);
        } catch {
          failedAnalysisWallets.push(change.currentSnapshot.walletAddress);
        }
      }
    }

    return {
      changes,
      analyzedWallets,
      failedAnalysisWallets
    };
  }
}
