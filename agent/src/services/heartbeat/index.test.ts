import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Wallet } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeartbeatJob } from "../../jobs/heartbeat.job.js";
import { HeartbeatsRepository } from "../../persistence/heartbeats.repository.js";
import { AuditEventsRepository } from "../../persistence/audit-events.repository.js";
import { AuditService } from "../audit.service.js";
import { HeartbeatService } from "./index.js";
import { createTestConfig } from "../../test-helpers/env.js";

let dataDirectory: string;
let now: Date;
let wallet: Wallet;
let beneficiary: Wallet;
let heartbeats: HeartbeatsRepository;
let auditEvents: AuditEventsRepository;
let service: HeartbeatService;

async function signedProof(signer: Wallet, purpose: string) {
  const message = `${purpose}: ${signer.address}`;
  return {
    message,
    signature: await signer.signMessage(message)
  };
}

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "riskguard-heartbeats-"));
  now = new Date("2026-05-14T00:00:00.000Z");
  wallet = Wallet.createRandom();
  beneficiary = Wallet.createRandom();
  heartbeats = new HeartbeatsRepository(dataDirectory);
  auditEvents = new AuditEventsRepository(dataDirectory);
  service = new HeartbeatService(
    heartbeats,
    createTestConfig(),
    new AuditService(auditEvents),
    () => now
  );
});

afterEach(async () => {
  await rm(dataDirectory, { force: true, recursive: true });
});

describe("HeartbeatService", () => {
  it("configures heartbeat settings and exposes deadline status", async () => {
    const proof = await signedProof(wallet, "Configure heartbeat");
    const status = await service.configure({
      walletAddress: wallet.address,
      beneficiaryAddress: beneficiary.address,
      intervalSeconds: 100,
      graceSeconds: 50,
      timelockSeconds: 75,
      reminderLeadSeconds: 25,
      reminderCooldownSeconds: 30,
      ...proof
    });

    expect(status.walletAddress).toBe(wallet.address);
    expect(status.beneficiaryAddress).toBe(beneficiary.address);
    expect(status.state).toBe("healthy");
    expect(status.nextDeadlineAt).toBe("2026-05-14T00:01:40.000Z");
    expect(status.graceEndsAt).toBe("2026-05-14T00:02:30.000Z");
    expect(status.timelockEndsAt).toBe("2026-05-14T00:03:45.000Z");
  });

  it("renews check-ins and records audit events", async () => {
    await service.configure({
      walletAddress: wallet.address,
      beneficiaryAddress: beneficiary.address,
      intervalSeconds: 100,
      graceSeconds: 50,
      timelockSeconds: 75,
      ...(await signedProof(wallet, "Configure heartbeat"))
    });
    now = new Date("2026-05-14T00:00:20.000Z");

    const status = await service.checkIn({
      walletAddress: wallet.address,
      ...(await signedProof(wallet, "Heartbeat check-in"))
    });
    const events = await auditEvents.list();

    expect(status.lastHeartbeatAt).toBe("2026-05-14T00:00:20.000Z");
    expect(status.nextDeadlineAt).toBe("2026-05-14T00:02:00.000Z");
    expect(events.some((event) => event.eventType === "heartbeat.checked_in")).toBe(true);
  });

  it("records one reminder per cooldown period", async () => {
    const sendHeartbeatReminder = vi.fn().mockResolvedValue(undefined);
    service = new HeartbeatService(
      heartbeats,
      createTestConfig(),
      new AuditService(auditEvents),
      () => now,
      { sendHeartbeatReminder }
    );
    await service.configure({
      walletAddress: wallet.address,
      beneficiaryAddress: beneficiary.address,
      intervalSeconds: 100,
      graceSeconds: 50,
      timelockSeconds: 75,
      reminderLeadSeconds: 30,
      reminderCooldownSeconds: 60,
      ...(await signedProof(wallet, "Configure heartbeat"))
    });
    now = new Date("2026-05-14T00:01:15.000Z");
    const job = new HeartbeatJob(service);

    const first = await job.runOnce();
    const second = await job.runOnce();

    expect(first[0]?.reminderSent).toBe(true);
    expect(second[0]?.reminderSent).toBe(false);
    expect(second[0]?.reason).toBe("Reminder cooldown is still active.");
    expect(sendHeartbeatReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: wallet.address,
        beneficiaryAddress: beneficiary.address
      })
    );
  });

  it("reports beneficiary availability only after grace and timelock", async () => {
    await service.configure({
      walletAddress: wallet.address,
      beneficiaryAddress: beneficiary.address,
      intervalSeconds: 100,
      graceSeconds: 50,
      timelockSeconds: 75,
      ...(await signedProof(wallet, "Configure heartbeat"))
    });

    now = new Date("2026-05-14T00:02:31.000Z");
    const pending = await service.getBeneficiaryStatus(wallet.address, beneficiary.address);
    await heartbeats.updateContractState(wallet.address, {
      contractAddress: createTestConfig().somnia.inheritanceRegistryContractAddress,
      isExpired: true,
      timelockReady: true,
      executed: false,
      checkedAt: "2026-05-14T00:03:45.000Z"
    });
    now = new Date("2026-05-14T00:03:45.000Z");
    const available = await service.getBeneficiaryStatus(wallet.address, beneficiary.address);

    expect(pending?.state).toBe("timelock_pending");
    expect(pending?.executionAvailable).toBe(false);
    expect(available?.state).toBe("beneficiary_available");
    expect(available?.availableNextStep).toBe("beneficiary_action_available");
  });

  it("denies premature execution and allows only beneficiary-available state", async () => {
    await service.configure({
      walletAddress: wallet.address,
      beneficiaryAddress: beneficiary.address,
      intervalSeconds: 100,
      graceSeconds: 50,
      timelockSeconds: 75,
      ...(await signedProof(wallet, "Configure heartbeat"))
    });

    const premature = await service.evaluateExecution({
      walletAddress: wallet.address,
      requestedBy: beneficiary.address,
      ...(await signedProof(beneficiary, "Deadman policy check"))
    });
    await heartbeats.updateContractState(wallet.address, {
      contractAddress: createTestConfig().somnia.inheritanceRegistryContractAddress,
      isExpired: true,
      timelockReady: true,
      executed: false,
      checkedAt: "2026-05-14T00:03:45.000Z"
    });
    now = new Date("2026-05-14T00:03:45.000Z");
    const available = await service.evaluateExecution({
      walletAddress: wallet.address,
      requestedBy: beneficiary.address,
      ...(await signedProof(beneficiary, "Deadman policy check"))
    });
    const strangerWallet = Wallet.createRandom();
    const stranger = await service.evaluateExecution({
      walletAddress: wallet.address,
      requestedBy: strangerWallet.address,
      ...(await signedProof(strangerWallet, "Deadman policy check"))
    });

    expect(premature.allowed).toBe(false);
    expect(premature.policyId).toBe("deadman.execution.contract-state-required");
    expect(available.allowed).toBe(true);
    expect(stranger.allowed).toBe(false);
    expect(stranger.policyId).toBe("deadman.execution.unauthorized");
  });

  it("returns safe unavailable beneficiary status for unknown wallets", async () => {
    const status = await service.getBeneficiaryStatus(wallet.address, beneficiary.address);

    expect(status?.state).toBe("unconfigured");
    expect(status?.executionAvailable).toBe(false);
    expect(status?.availableNextStep).toBe("none");
  });

  it("clears stale reminder and contract state when settings are reconfigured", async () => {
    await service.configure({
      walletAddress: wallet.address,
      beneficiaryAddress: beneficiary.address,
      intervalSeconds: 100,
      graceSeconds: 50,
      timelockSeconds: 75,
      reminderLeadSeconds: 30,
      ...(await signedProof(wallet, "Configure heartbeat"))
    });
    now = new Date("2026-05-14T00:01:15.000Z");
    await new HeartbeatJob(service).runOnce();
    await heartbeats.updateContractState(wallet.address, {
      contractAddress: createTestConfig().somnia.inheritanceRegistryContractAddress,
      isExpired: true,
      timelockReady: true,
      executed: false,
      checkedAt: "2026-05-14T00:03:45.000Z"
    });

    now = new Date("2026-05-14T00:02:00.000Z");
    const status = await service.configure({
      walletAddress: wallet.address,
      beneficiaryAddress: beneficiary.address,
      intervalSeconds: 100,
      graceSeconds: 50,
      timelockSeconds: 75,
      reminderLeadSeconds: 30,
      ...(await signedProof(wallet, "Configure heartbeat"))
    });
    const stored = await heartbeats.findByWalletAddress(wallet.address);

    expect(status.state).toBe("healthy");
    expect(stored?.lastReminderAt).toBeUndefined();
    expect(stored?.missedAt).toBeUndefined();
    expect(stored?.contractState).toBeUndefined();
  });

  it("does not record reminder cooldown when notifier fails", async () => {
    service = new HeartbeatService(
      heartbeats,
      createTestConfig(),
      new AuditService(auditEvents),
      () => now,
      { sendHeartbeatReminder: vi.fn().mockRejectedValue(new Error("telegram failed")) }
    );
    await service.configure({
      walletAddress: wallet.address,
      beneficiaryAddress: beneficiary.address,
      intervalSeconds: 100,
      graceSeconds: 50,
      timelockSeconds: 75,
      reminderLeadSeconds: 30,
      ...(await signedProof(wallet, "Configure heartbeat"))
    });
    now = new Date("2026-05-14T00:01:15.000Z");

    const [result] = await new HeartbeatJob(service).runOnce();
    const stored = await heartbeats.findByWalletAddress(wallet.address);

    expect(result?.reminderSent).toBe(false);
    expect(result?.reason).toBe("Heartbeat reminder send failed.");
    expect(stored?.lastReminderAt).toBeUndefined();
  });
});
