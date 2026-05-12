import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Wallet } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditService } from "./audit.service.js";
import { SetupService } from "./setup.service.js";
import { AuditEventsRepository } from "../persistence/audit-events.repository.js";
import { UsersRepository } from "../persistence/users.repository.js";
import { createTestConfig } from "../test-helpers/env.js";

let dataDirectory: string;
let wallet: Wallet;
let message: string;
let signature: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "riskguard-setup-"));
  wallet = Wallet.createRandom();
  message = `Register Somnia RiskGuard monitored wallet: ${wallet.address}`;
  signature = await wallet.signMessage(message);
});

afterEach(async () => {
  await rm(dataDirectory, { force: true, recursive: true });
});

describe("setup service", () => {
  it("registers a monitored wallet without accepting private keys", async () => {
    const service = new SetupService(
      new UsersRepository(dataDirectory),
      createTestConfig()
    );

    await expect(
      service.registerMonitoredWallet({
        walletAddress: wallet.address,
        message,
        signature,
        privateKey: "0xsecret"
      } as never)
    ).rejects.toThrow();
  });

  it("reports user wallet and agent wallet readiness separately", async () => {
    const users = new UsersRepository(dataDirectory);
    const config = createTestConfig();
    const service = new SetupService(users, config);

    await service.registerMonitoredWallet({
      walletAddress: wallet.address,
      message,
      signature
    });

    const readiness = await service.getReadiness();

    expect(readiness.monitoredWallet.ready).toBe(true);
    expect(readiness.monitoredWallet.walletAddress).toBe(wallet.address);
    expect(readiness.agentWallet.ready).toBe(true);
    expect(readiness.agentWallet.walletAddress).toBe(config.somnia.agentWalletAddress);
    expect(JSON.stringify(readiness)).not.toContain(config.somnia.agentPrivateKey);
  });

  it("records an audit event when setup succeeds", async () => {
    const auditEvents = new AuditEventsRepository(dataDirectory);
    const audit = new AuditService(auditEvents, { info: vi.fn() });
    const service = new SetupService(
      new UsersRepository(dataDirectory),
      createTestConfig(),
      audit
    );

    await service.registerMonitoredWallet({
      walletAddress: wallet.address,
      message,
      signature
    });

    await expect(auditEvents.list()).resolves.toMatchObject([
      { eventType: "setup.wallet.registered", status: "succeeded" }
    ]);
  });

  it("rejects setup when the signed-message proof does not match the wallet", async () => {
    const service = new SetupService(
      new UsersRepository(dataDirectory),
      createTestConfig()
    );
    const otherWallet = Wallet.createRandom();

    await expect(
      service.registerMonitoredWallet({
        walletAddress: otherWallet.address,
        message,
        signature
      })
    ).rejects.toThrow();
  });
});
