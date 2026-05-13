import type { AgentConfig } from "../config/env.js";
import { buildRiskPrompt } from "../integrations/llm/risk-prompt.js";
import type { RiskProvider } from "../integrations/llm/llm-risk.schema.js";
import type { PortfolioSnapshot } from "../persistence/portfolio-snapshots.repository.js";
import {
  RiskSnapshotsRepository,
  type RiskSnapshotRecord
} from "../persistence/risk-snapshots.repository.js";
import type { AuditService } from "./audit.service.js";

const unsafeActionPattern =
  /\b(buy|sell|swap|trade|transfer|send|withdraw|rebalance|liquidate)\b/i;

export interface RiskScoreServiceOptions {
  primary: RiskProvider;
  fallback: RiskProvider;
}

export class RiskScoreService {
  public constructor(
    private readonly config: AgentConfig,
    private readonly riskSnapshots: RiskSnapshotsRepository,
    private readonly audit: AuditService,
    private readonly providers: RiskScoreServiceOptions
  ) {}

  public async analyze(snapshot: PortfolioSnapshot): Promise<RiskSnapshotRecord> {
    const prompt = buildRiskPrompt(snapshot);
    let provider = this.providers.primary.provider;
    let result = await this.tryAnalyze(this.providers.primary, prompt);

    if (!result) {
      await this.audit.record({
        eventType: "risk.provider.fallback",
        status: "started",
        metadata: {
          from: this.providers.primary.provider,
          to: this.providers.fallback.provider,
          walletAddress: snapshot.walletAddress
        }
      });
      provider = this.providers.fallback.provider;
      result = await this.tryAnalyze(this.providers.fallback, prompt);
    }

    if (!result) {
      await this.audit.record({
        eventType: "risk.analysis.failed",
        status: "failed",
        metadata: { walletAddress: snapshot.walletAddress }
      });
      throw new Error("Risk analysis failed for all configured providers");
    }

    const safeOutput = this.enforceAdvisoryBoundaries(result);
    const persisted = await this.riskSnapshots.append({
      walletAddress: snapshot.walletAddress,
      score: safeOutput.score,
      explanation: safeOutput.explanation,
      provider,
      threshold: {
        alertThreshold: this.config.riskScore.alertThreshold,
        exceeded: safeOutput.score >= this.config.riskScore.alertThreshold
      },
      safeNextSteps: safeOutput.safeNextSteps
    });

    await this.audit.record({
      eventType: "risk.score.updated",
      status: "succeeded",
      metadata: {
        walletAddress: snapshot.walletAddress,
        provider,
        score: persisted.score,
        thresholdExceeded: persisted.threshold.exceeded
      }
    });

    return persisted;
  }

  public enforceAdvisoryBoundaries(result: {
    score: number;
    explanation: string;
    safeNextSteps: string[];
  }) {
    const safeNextSteps = result.safeNextSteps.filter(
      (step) => !unsafeActionPattern.test(step)
    );
    const explanation = unsafeActionPattern.test(result.explanation)
      ? "Informational risk analysis only: review the highlighted portfolio risk factors before taking any independent action."
      : result.explanation;

    return {
      score: result.score,
      explanation,
      safeNextSteps
    };
  }

  private async tryAnalyze(
    provider: RiskProvider,
    prompt: { system: string; user: string }
  ) {
    try {
      return await provider.analyze(prompt);
    } catch (error) {
      await this.audit.record({
        eventType: "risk.provider.failed",
        status: "failed",
        metadata: {
          provider: provider.provider,
          reason: error instanceof Error ? error.message : "provider failed"
        }
      });
      return undefined;
    }
  }
}
