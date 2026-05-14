import { randomUUID } from "node:crypto";

import { getAddress } from "ethers";
import { z } from "zod";

import { JsonStore } from "./json-store.js";

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => getAddress(value));

const positiveIntegerSchema = z.number().int().positive();

export const heartbeatContractStateSchema = z.object({
  contractAddress: addressSchema.optional(),
  isExpired: z.boolean(),
  timelockReady: z.boolean(),
  executed: z.boolean(),
  checkedAt: z.string().datetime()
});

export const heartbeatRecordSchema = z.object({
  heartbeatId: z.string().uuid(),
  walletAddress: addressSchema,
  beneficiaryAddress: addressSchema,
  intervalSeconds: positiveIntegerSchema,
  graceSeconds: positiveIntegerSchema,
  timelockSeconds: positiveIntegerSchema,
  reminderLeadSeconds: positiveIntegerSchema,
  reminderCooldownSeconds: positiveIntegerSchema,
  lastHeartbeatAt: z.string().datetime(),
  nextDeadlineAt: z.string().datetime(),
  graceEndsAt: z.string().datetime(),
  timelockEndsAt: z.string().datetime(),
  lastReminderAt: z.string().datetime().optional(),
  missedAt: z.string().datetime().optional(),
  contractState: heartbeatContractStateSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const heartbeatsSchema = z.array(heartbeatRecordSchema);

export type HeartbeatContractState = z.infer<typeof heartbeatContractStateSchema>;
export type HeartbeatRecord = z.infer<typeof heartbeatRecordSchema>;

export interface SaveHeartbeatSettingsInput {
  walletAddress: string;
  beneficiaryAddress: string;
  intervalSeconds: number;
  graceSeconds: number;
  timelockSeconds: number;
  reminderLeadSeconds?: number;
  reminderCooldownSeconds?: number;
  lastHeartbeatAt?: string;
  contractState?: HeartbeatContractState;
}

export class HeartbeatsRepository {
  private readonly store: JsonStore<HeartbeatRecord[]>;

  public constructor(dataDirectory?: string | URL) {
    this.store = new JsonStore({
      filename: "heartbeats.json",
      schema: heartbeatsSchema,
      defaultValue: [],
      dataDirectory
    });
  }

  public list(): Promise<HeartbeatRecord[]> {
    return this.store.read();
  }

  public async findByWalletAddress(walletAddress: string): Promise<HeartbeatRecord | undefined> {
    const checksumAddress = getAddress(walletAddress);
    const records = await this.store.read();
    return records.find((record) => record.walletAddress === checksumAddress);
  }

  public async upsertSettings(input: SaveHeartbeatSettingsInput): Promise<HeartbeatRecord> {
    const walletAddress = getAddress(input.walletAddress);
    const beneficiaryAddress = getAddress(input.beneficiaryAddress);
    const now = new Date().toISOString();
    const lastHeartbeatAt = input.lastHeartbeatAt ?? now;
    const schedule = computeHeartbeatSchedule({
      lastHeartbeatAt,
      intervalSeconds: input.intervalSeconds,
      graceSeconds: input.graceSeconds,
      timelockSeconds: input.timelockSeconds
    });
    let saved!: HeartbeatRecord;

    await this.store.update((records) => {
      const existing = records.find((record) => record.walletAddress === walletAddress);
      saved = {
        heartbeatId: existing?.heartbeatId ?? randomUUID(),
        walletAddress,
        beneficiaryAddress,
        intervalSeconds: input.intervalSeconds,
        graceSeconds: input.graceSeconds,
        timelockSeconds: input.timelockSeconds,
        reminderLeadSeconds: input.reminderLeadSeconds ?? Math.min(input.intervalSeconds, 3600),
        reminderCooldownSeconds: input.reminderCooldownSeconds ?? Math.min(input.intervalSeconds, 3600),
        lastHeartbeatAt,
        ...schedule,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(input.contractState ? { contractState: input.contractState } : {})
      };

      return existing
        ? records.map((record) => (record.heartbeatId === existing.heartbeatId ? saved : record))
        : [...records, saved];
    });

    return saved;
  }

  public async recordCheckIn(walletAddress: string, checkedInAt: string): Promise<HeartbeatRecord | undefined> {
    const checksumAddress = getAddress(walletAddress);
    let saved: HeartbeatRecord | undefined;

    await this.store.update((records) =>
      records.map((record) => {
        if (record.walletAddress !== checksumAddress) {
          return record;
        }
        const schedule = computeHeartbeatSchedule({
          lastHeartbeatAt: checkedInAt,
          intervalSeconds: record.intervalSeconds,
          graceSeconds: record.graceSeconds,
          timelockSeconds: record.timelockSeconds
        });
        saved = {
          ...record,
          lastHeartbeatAt: checkedInAt,
          ...schedule,
          updatedAt: checkedInAt,
          ...(record.contractState
            ? {
                contractState: {
                  ...record.contractState,
                  isExpired: false,
                  timelockReady: false,
                  checkedAt: checkedInAt
                }
              }
            : {})
        };
        return saved;
      })
    );

    return saved;
  }

  public async recordReminder(walletAddress: string, remindedAt: string): Promise<HeartbeatRecord | undefined> {
    return this.updateRecord(walletAddress, (record) => ({
      ...record,
      lastReminderAt: remindedAt,
      updatedAt: remindedAt
    }));
  }

  public async recordMissed(walletAddress: string, missedAt: string): Promise<HeartbeatRecord | undefined> {
    return this.updateRecord(walletAddress, (record) => ({
      ...record,
      missedAt: record.missedAt ?? missedAt,
      updatedAt: missedAt
    }));
  }

  public async updateContractState(
    walletAddress: string,
    contractState: HeartbeatContractState
  ): Promise<HeartbeatRecord | undefined> {
    return this.updateRecord(walletAddress, (record) => ({
      ...record,
      contractState,
      updatedAt: contractState.checkedAt
    }));
  }

  private async updateRecord(
    walletAddress: string,
    mutator: (record: HeartbeatRecord) => HeartbeatRecord
  ): Promise<HeartbeatRecord | undefined> {
    const checksumAddress = getAddress(walletAddress);
    let saved: HeartbeatRecord | undefined;

    await this.store.update((records) =>
      records.map((record) => {
        if (record.walletAddress !== checksumAddress) {
          return record;
        }
        saved = mutator(record);
        return saved;
      })
    );

    return saved;
  }
}

export function computeHeartbeatSchedule(input: {
  lastHeartbeatAt: string;
  intervalSeconds: number;
  graceSeconds: number;
  timelockSeconds: number;
}) {
  const lastHeartbeatMs = Date.parse(input.lastHeartbeatAt);
  const nextDeadlineAt = new Date(lastHeartbeatMs + input.intervalSeconds * 1000).toISOString();
  const graceEndsAt = new Date(Date.parse(nextDeadlineAt) + input.graceSeconds * 1000).toISOString();
  const timelockEndsAt = new Date(Date.parse(graceEndsAt) + input.timelockSeconds * 1000).toISOString();

  return { nextDeadlineAt, graceEndsAt, timelockEndsAt };
}
