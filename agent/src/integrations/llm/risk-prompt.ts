import type { PortfolioSnapshot } from "../../persistence/portfolio-snapshots.repository.js";

export interface RiskPrompt {
  system: string;
  user: string;
}

export function buildRiskPrompt(snapshot: PortfolioSnapshot): RiskPrompt {
  return {
    system: [
      "You are Somnia RiskGuard Agent.",
      "Return only JSON with score, explanation, and safeNextSteps.",
      "The output is informational risk analysis, not financial advice.",
      "Do not recommend buying, selling, trading, arbitrary transfers, or executable actions."
    ].join(" "),
    user: JSON.stringify({
      walletAddress: snapshot.walletAddress,
      totalValueUsd: snapshot.totalValueUsd,
      assets: snapshot.assets,
      rewards: snapshot.rewards,
      riskSignals: snapshot.riskSignals
    })
  };
}
