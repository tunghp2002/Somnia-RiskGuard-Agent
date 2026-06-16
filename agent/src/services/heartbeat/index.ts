import { getAddress, verifyMessage } from "ethers";
import { z } from "zod";

import type { AgentConfig } from "../../config/env.js";
import { evaluateDeadmanExecutionPolicy } from "../../policies/deadman-policy.js";
import type { PolicyDecision } from "../../policies/execution-policy.js";
import {
  HeartbeatsRepository,
  type HeartbeatContractState,
  type HeartbeatRecord
} from "../../persistence/heartbeats.repository.js";
import type { AuditService } from "../audit.service.js";

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => getAddress(value));

const positiveIntegerSchema = z.number().int().positive();
const automationSignerPlaceholder = "0x0000000000000000000000000000000000000000";

function verifySignedProof(
  input: { address: string; message: string; signature: string },
  context: z.RefinementCtx,
  path: string
) {
  let recoveredAddress: string;

  try {
    recoveredAddress = verifyMessage(input.message, input.signature);
  } catch {
    context.addIssue({
      code: "custom",
      message: "Signature must be a valid signed-message proof",
      path: [path]
    });
    return;
  }

  if (getAddress(recoveredAddress) !== input.address) {
    context.addIssue({
      code: "custom",
      message: "Signature must recover the submitted address",
      path: [path]
    });
  }
}

export const heartbeatSettingsRequestSchema = z
  .object({
    walletAddress: addressSchema,
    beneficiaryAddress: addressSchema,
    intervalSeconds: positiveIntegerSchema,
    graceSeconds: positiveIntegerSchema,
    timelockSeconds: positiveIntegerSchema,
    reminderLeadSeconds: positiveIntegerSchema.optional(),
    reminderCooldownSeconds: positiveIntegerSchema.optional(),
    message: z.string().min(1),
    signature: z.string().min(1)
  })
  .strict()
  .superRefine((input, context) => {
    verifySignedProof(
      {
        address: input.walletAddress,
        message: input.message,
        signature: input.signature
      },
      context,
      "signature"
    );
  });

export const heartbeatCheckInRequestSchema = z
  .object({
    walletAddress: addressSchema,
    message: z.string().min(1),
    signature: z.string().min(1)
  })
  .strict()
  .superRefine((input, context) => {
    verifySignedProof(
      {
        address: input.walletAddress,
        message: input.message,
        signature: input.signature
      },
      context,
      "signature"
    );
  });

export const deadmanPolicyRequestSchema = z
  .object({
    walletAddress: addressSchema,
    requestedBy: addressSchema,
    message: z.string().min(1),
    signature: z.string().min(1)
  })
  .strict()
  .superRefine((input, context) => {
    verifySignedProof(
      {
        address: input.requestedBy,
        message: input.message,
        signature: input.signature
      },
      context,
      "signature"
    );
  });

export type HeartbeatSettingsRequest = z.infer<typeof heartbeatSettingsRequestSchema>;
export type HeartbeatCheckInRequest = z.infer<typeof heartbeatCheckInRequestSchema>;
export type DeadmanPolicyRequest = z.infer<typeof deadmanPolicyRequestSchema>;

export type HeartbeatState =
  | "unconfigured"
  | "healthy"
  | "reminder_due"
  | "expired"
  | "timelock_pending"
  | "beneficiary_available"
  | "executed";

export interface HeartbeatStatus {
  walletAddress: string;
  beneficiaryAddress: string;
  state: HeartbeatState;
  lastHeartbeatAt: string;
  nextDeadlineAt: string;
  graceEndsAt: string;
  timelockEndsAt: string;
  lastReminderAt?: string;
  missedAt?: string;
  contractStateReady: boolean;
  executionAvailable: boolean;
  nextAction: string;
  returnAt?: string;
}

export interface BeneficiaryStatus {
  walletAddress: string;
  beneficiaryAddress?: string;
  state: HeartbeatState;
  message: string;
  availableNextStep: "wait" | "check_later" | "beneficiary_action_available" | "none";
  returnAt?: string;
  executionAvailable: boolean;
}

export interface HeartbeatReminderResult {
  walletAddress: string;
  state: HeartbeatState;
  reminderSent: boolean;
  missedRecorded: boolean;
  reason: string;
}

export interface HeartbeatReminderNotifier {
  sendHeartbeatReminder(input: {
    walletAddress: string;
    beneficiaryAddress: string;
    nextDeadlineAt: string;
    graceEndsAt: string;
  }): Promise<void>;
}

export interface InheritanceContractStateReader {
  readState(): Promise<HeartbeatContractState | null>;
}

export class HeartbeatServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "HeartbeatServiceError";
  }
}

export class HeartbeatService {
  public constructor(
    private readonly heartbeats: HeartbeatsRepository,
    private readonly config: AgentConfig,
    private readonly audit?: AuditService,
    private readonly now: () => Date = () => new Date(),
    private readonly reminderNotifier?: HeartbeatReminderNotifier,
    private readonly contractStateReader?: InheritanceContractStateReader
  ) {}

  public async configure(input: HeartbeatSettingsRequest): Promise<HeartbeatStatus> {
    const parsed = heartbeatSettingsRequestSchema.parse(input);
    const record = await this.heartbeats.upsertSettings({
      walletAddress: parsed.walletAddress,
      beneficiaryAddress: parsed.beneficiaryAddress,
      intervalSeconds: parsed.intervalSeconds,
      graceSeconds: parsed.graceSeconds,
      timelockSeconds: parsed.timelockSeconds,
      lastHeartbeatAt: this.now().toISOString(),
      ...(parsed.reminderLeadSeconds
        ? { reminderLeadSeconds: parsed.reminderLeadSeconds }
        : {}),
      ...(parsed.reminderCooldownSeconds
        ? { reminderCooldownSeconds: parsed.reminderCooldownSeconds }
        : {})
    });

    await this.audit?.record({
      eventType: "heartbeat.settings.updated",
      status: "succeeded",
      metadata: {
        walletAddress: record.walletAddress,
        beneficiaryAddress: record.beneficiaryAddress,
        intervalSeconds: record.intervalSeconds,
        graceSeconds: record.graceSeconds,
        timelockSeconds: record.timelockSeconds
      }
    });

    return this.toStatus(record);
  }

  public async checkIn(input: HeartbeatCheckInRequest): Promise<HeartbeatStatus> {
    const parsed = heartbeatCheckInRequestSchema.parse(input);
    const checkedInAt = this.now().toISOString();
    const record = await this.heartbeats.recordCheckIn(parsed.walletAddress, checkedInAt);

    if (!record) {
      throw new HeartbeatServiceError("heartbeat_not_configured", "Heartbeat settings are not configured", 404);
    }

    await this.audit?.record({
      eventType: "heartbeat.checked_in",
      status: "succeeded",
      metadata: {
        walletAddress: record.walletAddress,
        nextDeadlineAt: record.nextDeadlineAt
      }
    });

    return this.toStatus(record);
  }

  public async getStatus(walletAddress: string): Promise<HeartbeatStatus | null> {
    const record = await this.heartbeats.findByWalletAddress(walletAddress);
    return record ? this.toStatus(await this.refreshContractState(record)) : null;
  }

  public async getBeneficiaryStatus(
    walletAddress: string,
    beneficiaryAddress?: string
  ): Promise<BeneficiaryStatus | null> {
    const record = await this.heartbeats.findByWalletAddress(walletAddress);

    if (!record) {
      return {
        walletAddress: getAddress(walletAddress),
        ...(beneficiaryAddress ? { beneficiaryAddress: getAddress(beneficiaryAddress) } : {}),
        state: "unconfigured",
        message: "No beneficiary action is available for this wallet.",
        availableNextStep: "none",
        executionAvailable: false
      };
    }

    const requestedBeneficiary = beneficiaryAddress ? getAddress(beneficiaryAddress) : undefined;
    if (requestedBeneficiary && requestedBeneficiary !== record.beneficiaryAddress) {
      return {
        walletAddress: record.walletAddress,
        beneficiaryAddress: record.beneficiaryAddress,
        state: "healthy",
        message: "No beneficiary action is available for this wallet.",
        availableNextStep: "none",
        executionAvailable: false
      };
    }

    const status = this.toStatus(await this.refreshContractState(record));
    return {
      walletAddress: record.walletAddress,
      beneficiaryAddress: record.beneficiaryAddress,
      state: status.state,
      message: this.formatBeneficiaryMessage(status),
      availableNextStep: status.executionAvailable
        ? "beneficiary_action_available"
        : status.returnAt
          ? "check_later"
          : "wait",
      executionAvailable: status.executionAvailable,
      ...(status.returnAt ? { returnAt: status.returnAt } : {})
    };
  }

  public async evaluateReminders(): Promise<HeartbeatReminderResult[]> {
    const records = await this.heartbeats.list();
    const results: HeartbeatReminderResult[] = [];

    for (const record of records) {
      try {
        results.push(await this.evaluateReminder(record));
      } catch (error) {
        await this.audit?.record({
          eventType: "heartbeat.evaluation.failed",
          status: "failed",
          metadata: {
            walletAddress: record.walletAddress,
            reason: error instanceof Error ? error.message : "heartbeat evaluation failed"
          }
        });
        results.push({
          walletAddress: record.walletAddress,
          state: "healthy",
          reminderSent: false,
          missedRecorded: false,
          reason: "Heartbeat evaluation failed."
        });
      }
    }

    return results;
  }

  public async evaluateExecution(input: DeadmanPolicyRequest): Promise<PolicyDecision> {
    const parsed = deadmanPolicyRequestSchema.parse(input);
    let record = await this.heartbeats.findByWalletAddress(parsed.walletAddress);

    if (!record) {
      const decision = evaluateDeadmanExecutionPolicy({
        walletAddress: parsed.walletAddress,
        beneficiaryAddress: parsed.requestedBy,
        requestedBy: parsed.requestedBy,
        signerAddress: automationSignerPlaceholder,
        chainId: this.config.somnia.chainId,
        heartbeatExpired: false,
        timelockReady: false,
        contractStateReady: false,
        alreadyExecuted: false,
        ...(this.config.somnia.inheritanceRegistryContractAddress
          ? { contractAddress: this.config.somnia.inheritanceRegistryContractAddress }
          : {})
      });
      await this.auditPolicyDecision(decision, parsed.walletAddress);
      return decision;
    }

    record = await this.refreshContractState(record);
    const status = this.toStatus(record);
    const decision = evaluateDeadmanExecutionPolicy({
      walletAddress: record.walletAddress,
      beneficiaryAddress: record.beneficiaryAddress,
      requestedBy: parsed.requestedBy,
      signerAddress: automationSignerPlaceholder,
      chainId: this.config.somnia.chainId,
      heartbeatExpired: status.state === "expired" || status.state === "timelock_pending" || status.state === "beneficiary_available",
      timelockReady: status.executionAvailable,
      contractStateReady: status.contractStateReady,
      alreadyExecuted: status.state === "executed",
      ...(record.contractState?.contractAddress ?? this.config.somnia.inheritanceRegistryContractAddress
        ? {
            contractAddress:
              record.contractState?.contractAddress
              ?? this.config.somnia.inheritanceRegistryContractAddress
          }
        : {})
    });

    await this.auditPolicyDecision(decision, record.walletAddress);
    return decision;
  }

  private async evaluateReminder(record: HeartbeatRecord): Promise<HeartbeatReminderResult> {
    const status = this.toStatus(record);

    if (status.state === "expired" || status.state === "timelock_pending" || status.state === "beneficiary_available") {
      const missed = await this.heartbeats.recordMissed(record.walletAddress, this.now().toISOString());
      await this.audit?.record({
        eventType: "heartbeat.missed",
        status: missed?.missedAt === record.missedAt ? "skipped" : "succeeded",
        metadata: {
          walletAddress: record.walletAddress,
          graceEndsAt: record.graceEndsAt
        }
      });
      return {
        walletAddress: record.walletAddress,
        state: status.state,
        reminderSent: false,
        missedRecorded: true,
        reason: "Heartbeat grace period has expired."
      };
    }

    if (status.state !== "reminder_due") {
      return {
        walletAddress: record.walletAddress,
        state: status.state,
        reminderSent: false,
        missedRecorded: false,
        reason: "Reminder is not due."
      };
    }

    if (!this.canSendReminder(record)) {
      await this.audit?.record({
        eventType: "heartbeat.reminder.skipped",
        status: "skipped",
        metadata: {
          walletAddress: record.walletAddress,
          lastReminderAt: record.lastReminderAt
        }
      });
      return {
        walletAddress: record.walletAddress,
        state: status.state,
        reminderSent: false,
        missedRecorded: false,
        reason: "Reminder cooldown is still active."
      };
    }

    try {
      await this.reminderNotifier?.sendHeartbeatReminder({
        walletAddress: record.walletAddress,
        beneficiaryAddress: record.beneficiaryAddress,
        nextDeadlineAt: record.nextDeadlineAt,
        graceEndsAt: record.graceEndsAt
      });
    } catch (error) {
      await this.audit?.record({
        eventType: "heartbeat.reminder.failed",
        status: "failed",
        metadata: {
          walletAddress: record.walletAddress,
          reason: error instanceof Error ? error.message : "reminder send failed"
        }
      });
      return {
        walletAddress: record.walletAddress,
        state: status.state,
        reminderSent: false,
        missedRecorded: false,
        reason: "Heartbeat reminder send failed."
      };
    }

    const remindedAt = this.now().toISOString();
    await this.heartbeats.recordReminder(record.walletAddress, remindedAt);
    await this.audit?.record({
      eventType: "heartbeat.reminder.sent",
      status: "succeeded",
      metadata: {
        walletAddress: record.walletAddress,
        nextDeadlineAt: record.nextDeadlineAt
      }
    });

    return {
      walletAddress: record.walletAddress,
      state: status.state,
      reminderSent: true,
      missedRecorded: false,
      reason: "Heartbeat reminder recorded."
    };
  }

  private toStatus(record: HeartbeatRecord): HeartbeatStatus {
    const nowMs = this.now().getTime();
    const nextDeadlineMs = Date.parse(record.nextDeadlineAt);
    const graceEndsMs = Date.parse(record.graceEndsAt);
    const timelockEndsMs = Date.parse(record.timelockEndsAt);
    const reminderDueMs = nextDeadlineMs - record.reminderLeadSeconds * 1000;
    const contractStateReady = Boolean(
      record.contractState?.isExpired && record.contractState.timelockReady
    );
    const executionAvailable =
      !record.contractState?.executed && contractStateReady && nowMs >= timelockEndsMs;

    let state: HeartbeatState = "healthy";
    let nextAction = "No action needed.";
    let returnAt: string | undefined;

    if (record.contractState?.executed) {
      state = "executed";
      nextAction = "Dead Man's Switch execution has already been marked complete.";
    } else if (executionAvailable) {
      state = "beneficiary_available";
      nextAction = "Beneficiary path is available after timelock completion.";
    } else if (nowMs >= timelockEndsMs && !contractStateReady) {
      state = "timelock_pending";
      nextAction = "Refresh contract state before beneficiary execution can be evaluated.";
    } else if (nowMs >= graceEndsMs) {
      state = "timelock_pending";
      nextAction = "Wait for the Dead Man's Switch timelock to complete.";
      returnAt = record.timelockEndsAt;
    } else if (nowMs >= nextDeadlineMs) {
      state = "expired";
      nextAction = "Heartbeat deadline was missed; grace period is active.";
      returnAt = record.graceEndsAt;
    } else if (nowMs >= reminderDueMs) {
      state = "reminder_due";
      nextAction = "Send a heartbeat reminder before expiry.";
      returnAt = record.nextDeadlineAt;
    }

    return {
      walletAddress: record.walletAddress,
      beneficiaryAddress: record.beneficiaryAddress,
      state,
      lastHeartbeatAt: record.lastHeartbeatAt,
      nextDeadlineAt: record.nextDeadlineAt,
      graceEndsAt: record.graceEndsAt,
      timelockEndsAt: record.timelockEndsAt,
      contractStateReady,
      executionAvailable,
      nextAction,
      ...(record.lastReminderAt ? { lastReminderAt: record.lastReminderAt } : {}),
      ...(record.missedAt ? { missedAt: record.missedAt } : {}),
      ...(returnAt ? { returnAt } : {})
    };
  }

  private canSendReminder(record: HeartbeatRecord): boolean {
    if (!record.lastReminderAt) {
      return true;
    }

    const cooldownEndsAt = Date.parse(record.lastReminderAt) + record.reminderCooldownSeconds * 1000;
    return this.now().getTime() >= cooldownEndsAt;
  }

  private formatBeneficiaryMessage(status: HeartbeatStatus): string {
    if (status.executionAvailable) {
      return `The waiting period is complete. The beneficiary path is available for ${status.beneficiaryAddress}.`;
    }

    if (status.state === "timelock_pending") {
      return `The heartbeat has expired, but the waiting period is still active. Please return at ${status.timelockEndsAt}.`;
    }

    if (status.state === "expired") {
      return `The heartbeat deadline was missed, but the grace period is still active. Please return at ${status.graceEndsAt}.`;
    }

    return `No beneficiary action is available yet. The next heartbeat deadline is ${status.nextDeadlineAt}.`;
  }

  private async auditPolicyDecision(decision: PolicyDecision, walletAddress: string) {
    await this.audit?.record({
      eventType: decision.allowed ? "deadman.execution.available" : "deadman.policy.denied",
      status: decision.allowed ? "succeeded" : "denied",
      metadata: {
        walletAddress,
        policyId: decision.policyId,
        reason: decision.reason
      }
    });
  }

  private async refreshContractState(record: HeartbeatRecord): Promise<HeartbeatRecord> {
    if (!this.contractStateReader) {
      return record;
    }

    const contractState = await this.contractStateReader.readState();
    if (!contractState) {
      return record;
    }

    return await this.heartbeats.updateContractState(record.walletAddress, contractState)
      ?? record;
  }
}
