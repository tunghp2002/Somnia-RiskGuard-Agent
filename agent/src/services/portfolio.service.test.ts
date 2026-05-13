import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditService } from "./audit.service.js";
import { PortfolioService } from "./portfolio.service.js";
import { AuditEventsRepository } from "../persistence/audit-events.repository.js";
import { PortfolioSnapshotsRepository } from "../persistence/portfolio-snapshots.repository.js";
import { UsersRepository } from "../persistence/users.repository.js";

let dataDirectory: string;
let auditEvents: AuditEventsRepository;
let users: UsersRepository;
let portfolioSnapshots: PortfolioSnapshotsRepository;
let service: PortfolioService;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "riskguard-portfolio-"));
  auditEvents = new AuditEventsRepository(dataDirectory);
  users = new UsersRepository(dataDirectory);
  portfolioSnapshots = new PortfolioSnapshotsRepository(dataDirectory);
  service = new PortfolioService(
    users,
    portfolioSnapshots,
    new AuditService(auditEvents, { info: vi.fn() })
  );
});

afterEach(async () => {
  await rm(dataDirectory, { force: true, recursive: true });
});

describe("portfolio service", () => {
  it("skips monitoring safely when no wallet is configured", async () => {
    await expect(service.collectForConfiguredWallets()).resolves.toEqual([]);

    await expect(auditEvents.list()).resolves.toMatchObject([
      { eventType: "portfolio.monitor.skipped", status: "skipped" }
    ]);
  });

  it("stores and audits a demo portfolio snapshot for configured wallets", async () => {
    const user = await users.upsertMonitoredWallet(
      "0x1111111111111111111111111111111111111111"
    );

    const results = await service.collectForConfiguredWallets();

    expect(results).toHaveLength(1);
    expect(results[0]?.shouldAnalyzeRisk).toBe(true);
    expect(results[0]?.currentSnapshot.walletAddress).toBe(user.walletAddress);
    await expect(portfolioSnapshots.list()).resolves.toHaveLength(1);
    await expect(auditEvents.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "portfolio.snapshot.collected" })
      ])
    );
  });

  it("detects no meaningful change and records skipped risk analysis", async () => {
    await users.upsertMonitoredWallet("0x1111111111111111111111111111111111111111");

    await service.collectForConfiguredWallets();
    const secondRun = await service.collectForConfiguredWallets();

    expect(secondRun[0]?.shouldAnalyzeRisk).toBe(false);
    expect(secondRun[0]?.changedFields).toEqual([]);
    await expect(auditEvents.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "risk.analysis.skipped" })
      ])
    );
  });
});
