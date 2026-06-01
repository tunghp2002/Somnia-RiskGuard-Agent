import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getAddress } from "ethers";

import { isoDateTimeSchema } from "../utils/datetime.js";
import { JsonStore, type RepositoryStore } from "./json-store.js";

export const actionNonceSchema = z.object({
  actionNonce: z.string().min(1),
  userId: z.string().uuid(),
  actionType: z.string().min(1),
  chatId: z.string().regex(/^-?\d+$/),
  expiresAt: isoDateTimeSchema,
  alertId: z.string().uuid().optional(),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value))
    .optional(),
  smartAccountAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value))
    .optional(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  safeAction: z.string().min(1).optional(),
  consumedAt: isoDateTimeSchema.optional()
});

export type ActionNonceRecord = z.infer<typeof actionNonceSchema>;

export interface CreateActionNonceInput {
  userId: string;
  actionType: string;
  chatId: string;
  expiresAt: string;
  alertId?: string;
  walletAddress?: string;
  smartAccountAddress?: string;
  txHash?: string;
  safeAction?: string;
}

export interface ConsumeActionNonceResult {
  ok: boolean;
  reason?: "not_found" | "expired" | "replayed" | "mismatched_action";
  record?: ActionNonceRecord;
}

export class ActionNoncesRepository {
  private readonly store: RepositoryStore<ActionNonceRecord[]>;

  public constructor(dataDirectory?: string | URL, store?: RepositoryStore<ActionNonceRecord[]>) {
    this.store = store ?? new JsonStore({
      filename: "action-nonces.json",
      schema: z.array(actionNonceSchema),
      defaultValue: [],
      dataDirectory
    });
  }

  public list(): Promise<ActionNonceRecord[]> {
    return this.store.read();
  }

  public async create(input: CreateActionNonceInput): Promise<ActionNonceRecord> {
    const record = actionNonceSchema.parse({
      actionNonce: randomUUID(),
      userId: input.userId,
      actionType: input.actionType,
      chatId: input.chatId,
      expiresAt: input.expiresAt,
      ...(input.alertId ? { alertId: input.alertId } : {}),
      ...(input.walletAddress ? { walletAddress: input.walletAddress } : {}),
      ...(input.smartAccountAddress ? { smartAccountAddress: input.smartAccountAddress } : {}),
      ...(input.txHash ? { txHash: input.txHash } : {}),
      ...(input.safeAction ? { safeAction: input.safeAction } : {})
    });

    await this.store.update((records) => [...records, record]);
    return record;
  }

  public async findByNonce(actionNonce: string): Promise<ActionNonceRecord | undefined> {
    const records = await this.store.read();
    return records.find((record) => record.actionNonce === actionNonce);
  }

  public async consumeOnce(input: {
    actionNonce: string;
    userId: string;
    actionType: string;
    now?: Date;
  }): Promise<ConsumeActionNonceResult> {
    const now = input.now ?? new Date();
    let result: ConsumeActionNonceResult = { ok: false, reason: "not_found" };

    await this.store.update((records) =>
      records.map((record) => {
        if (record.actionNonce !== input.actionNonce || record.userId !== input.userId) {
          return record;
        }

        if (record.actionType !== input.actionType) {
          result = { ok: false, reason: "mismatched_action", record };
          return record;
        }

        if (record.consumedAt) {
          result = { ok: false, reason: "replayed", record };
          return record;
        }

        if (Date.parse(record.expiresAt) <= now.getTime()) {
          result = { ok: false, reason: "expired", record };
          return record;
        }

        const consumed = { ...record, consumedAt: now.toISOString() };
        result = { ok: true, record: consumed };
        return consumed;
      })
    );

    return result;
  }
}
