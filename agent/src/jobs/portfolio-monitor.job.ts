import type { PortfolioService, PortfolioChangeResult } from "../services/portfolio.service.js";

export interface PortfolioMonitorResult {
  changes: PortfolioChangeResult[];
}

export class PortfolioMonitorJob {
  public constructor(private readonly portfolioService: PortfolioService) {}

  public async runOnce(): Promise<PortfolioMonitorResult> {
    const changes = await this.portfolioService.collectForConfiguredWallets();

    return { changes };
  }
}
