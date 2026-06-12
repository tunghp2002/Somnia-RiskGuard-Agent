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
    new AuditService(auditEvents, { info: vi.fn() }),
    undefined,
    { demoMode: true }
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

  it("fails closed when no Somnia client is configured and demo mode is disabled", async () => {
    const productionService = new PortfolioService(
      users,
      portfolioSnapshots,
      new AuditService(auditEvents, { info: vi.fn() })
    );

    await users.upsertMonitoredWallet("0x1111111111111111111111111111111111111111");

    await expect(productionService.collectForConfiguredWallets()).resolves.toEqual([]);
    await expect(auditEvents.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "portfolio.monitor.failed" })
      ])
    );
  });

  it("checks Somnia health before read-only portfolio collection", async () => {
    const callTool = vi.fn();
    const somniaService = new PortfolioService(
      users,
      portfolioSnapshots,
      new AuditService(auditEvents, { info: vi.fn() }),
      {
        health: vi.fn().mockResolvedValue({ ok: false, executionEnabled: false }),
        callTool
      } as never
    );

    await expect(
      somniaService.collectForWallet("0x1111111111111111111111111111111111111111")
    ).rejects.toThrow();
    expect(callTool).not.toHaveBeenCalled();
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

  it("detects no meaningful change without appending duplicate snapshots", async () => {
    await users.upsertMonitoredWallet("0x1111111111111111111111111111111111111111");

    await service.collectForConfiguredWallets();
    const secondRun = await service.collectForConfiguredWallets();

    expect(secondRun[0]?.shouldAnalyzeRisk).toBe(false);
    expect(secondRun[0]?.changedFields).toEqual([]);
    await expect(auditEvents.list()).resolves.toHaveLength(1);
    await expect(portfolioSnapshots.list()).resolves.toHaveLength(1);
  });

  it("continues monitoring later wallets when one wallet read fails", async () => {
    const first = await users.upsertMonitoredWallet(
      "0x1111111111111111111111111111111111111111"
    );
    const second = await users.upsertMonitoredWallet(
      "0x2222222222222222222222222222222222222222"
    );
    const somniaService = new PortfolioService(
      users,
      portfolioSnapshots,
      new AuditService(auditEvents, { info: vi.fn() }),
      {
        health: vi.fn().mockResolvedValue({ ok: true, executionEnabled: true }),
        callTool: vi.fn().mockImplementation(({ args }) => {
          if (args.walletAddress === first.walletAddress) {
            return Promise.resolve({ result: { invalid: true } });
          }

          return Promise.resolve({
            result: {
              totalValueUsd: "1",
              assets: [],
              rewards: [],
              riskSignals: []
            }
          });
        })
      } as never
    );

    const results = await somniaService.collectForConfiguredWallets();

    expect(results).toHaveLength(1);
    expect(results[0]?.currentSnapshot.walletAddress).toBe(second.walletAddress);
  });

  it("does not treat reordered equivalent portfolio arrays as meaningful changes", async () => {
    const previous = await portfolioSnapshots.append({
      walletAddress: "0x1111111111111111111111111111111111111111",
      source: "demo",
      totalValueUsd: "10",
      assets: [
        { symbol: "A", balance: "1", valueUsd: "1" },
        { symbol: "B", balance: "2", valueUsd: "2" }
      ],
      rewards: [
        { protocol: "p1", claimableValueUsd: "1" },
        { protocol: "p2", claimableValueUsd: "2" }
      ],
      riskSignals: [
        { signalType: "a", severity: "low", description: "a" },
        { signalType: "b", severity: "medium", description: "b" }
      ]
    });
    const current = await portfolioSnapshots.append({
      walletAddress: previous.walletAddress,
      source: "demo",
      totalValueUsd: "10",
      assets: [
        { symbol: "B", balance: "2", valueUsd: "2" },
        { symbol: "A", balance: "1", valueUsd: "1" }
      ],
      rewards: [
        { protocol: "p2", claimableValueUsd: "2" },
        { protocol: "p1", claimableValueUsd: "1" }
      ],
      riskSignals: [
        { signalType: "b", severity: "medium", description: "b" },
        { signalType: "a", severity: "low", description: "a" }
      ]
    });

    expect(service.detectChanges(previous, current).shouldAnalyzeRisk).toBe(false);
  });
});
