import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditService } from "./audit.service.js";
import { RiskScoreService } from "./risk-score.service.js";
import type { RiskProvider } from "../integrations/llm/llm-risk.schema.js";
import { AuditEventsRepository } from "../persistence/audit-events.repository.js";
import {
  type PortfolioSnapshot,
  PortfolioSnapshotsRepository
} from "../persistence/portfolio-snapshots.repository.js";
import { RiskSnapshotsRepository } from "../persistence/risk-snapshots.repository.js";
import { createTestConfig } from "../test-helpers/env.js";

let dataDirectory: string;
let auditEvents: AuditEventsRepository;
let riskSnapshots: RiskSnapshotsRepository;
let portfolioSnapshot: PortfolioSnapshot;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "riskguard-risk-"));
  auditEvents = new AuditEventsRepository(dataDirectory);
  riskSnapshots = new RiskSnapshotsRepository(dataDirectory);
  portfolioSnapshot = await new PortfolioSnapshotsRepository(dataDirectory).append({
    walletAddress: "0x1111111111111111111111111111111111111111",
    source: "demo",
    totalValueUsd: "1000",
    assets: [{ symbol: "STT", balance: "10", valueUsd: "1000" }],
    rewards: [],
    riskSignals: [
      {
        signalType: "volatility",
        severity: "high",
        description: "Demo risk signal"
      }
    ]
  });
});

afterEach(async () => {
  await rm(dataDirectory, { force: true, recursive: true });
});

function provider(
  name: "groq" | "deepseek",
  analyze: RiskProvider["analyze"]
): RiskProvider {
  return { provider: name, analyze };
}

describe("risk score service", () => {
  it("persists a Groq risk score with threshold result", async () => {
    const service = new RiskScoreService(
      createTestConfig(),
      riskSnapshots,
      new AuditService(auditEvents, { info: vi.fn() }),
      {
        primary: provider("groq", vi.fn().mockResolvedValue({
          score: 80,
          explanation: "High concentration risk detected.",
          safeNextSteps: ["Review portfolio concentration."]
        })),
        fallback: provider("deepseek", vi.fn())
      }
    );

    const result = await service.analyze(portfolioSnapshot);

    expect(result.provider).toBe("groq");
    expect(result.threshold.exceeded).toBe(true);
    await expect(riskSnapshots.latestForWallet(portfolioSnapshot.walletAddress)).resolves.toMatchObject({
      provider: "groq",
      score: 80
    });
  });

  it("falls back to DeepSeek when Groq fails and audits the fallback", async () => {
    const service = new RiskScoreService(
      createTestConfig(),
      riskSnapshots,
      new AuditService(auditEvents, { info: vi.fn() }),
      {
        primary: provider("groq", vi.fn().mockRejectedValue(new Error("timeout"))),
        fallback: provider("deepseek", vi.fn().mockResolvedValue({
          score: 42,
          explanation: "Moderate demo risk.",
          safeNextSteps: ["Review the informational risk factors."]
        }))
      }
    );

    const result = await service.analyze(portfolioSnapshot);

    expect(result.provider).toBe("deepseek");
    await expect(auditEvents.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "risk.provider.fallback" })
      ])
    );
  });

  it("removes unsafe executable recommendations from persisted output", async () => {
    const service = new RiskScoreService(
      createTestConfig(),
      riskSnapshots,
      new AuditService(auditEvents, { info: vi.fn() }),
      {
        primary: provider("groq", vi.fn().mockResolvedValue({
          score: 90,
          explanation: "You should sell immediately.",
          safeNextSteps: ["Transfer funds now", "Review risk factors manually"]
        })),
        fallback: provider("deepseek", vi.fn())
      }
    );

    const result = await service.analyze(portfolioSnapshot);

    expect(result.explanation).toContain("Informational risk analysis only");
    expect(result.safeNextSteps).toEqual(["Review risk factors manually"]);
  });
});
