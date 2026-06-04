import { randomUUID } from "node:crypto";

import { getAddress } from "ethers";
import { z } from "zod";

import { isoDateTimeSchema } from "../utils/datetime.js";
import { JsonStore, type RepositoryStore } from "./json-store.js";

export const riskGuardPendingUserOpSchema = z.object({
  pendingUserOpId: z.string().uuid(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  smartAccountAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  guardedTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  entrypointAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  userOp: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "submitted", "failed", "expired"]),
  userOpHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  submittedTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  submittedAt: isoDateTimeSchema.optional(),
  failureReason: z.string().optional()
});

export const riskGuardPendingUserOpsSchema = z.array(riskGuardPendingUserOpSchema);

export type RiskGuardPendingUserOpRecord = z.infer<typeof riskGuardPendingUserOpSchema>;

export class RiskGuardPendingUserOpsRepository {
  private readonly store: RepositoryStore<RiskGuardPendingUserOpRecord[]>;

  public constructor(
    dataDirectory?: string | URL,
    store?: RepositoryStore<RiskGuardPendingUserOpRecord[]>
  ) {
    this.store = store ?? new JsonStore({
      filename: "riskguard-pending-userops.json",
      schema: riskGuardPendingUserOpsSchema,
      defaultValue: [],
      dataDirectory
    });
  }

  public list() {
    return this.store.read();
  }

  public async upsert(input: {
    walletAddress: string;
    smartAccountAddress: string;
    guardedTxHash: string;
    entrypointAddress?: string;
    userOp: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    const smartAccountAddress = getAddress(input.smartAccountAddress);
    const walletAddress = getAddress(input.walletAddress);
    const existing = (await this.store.read()).find((record) =>
      record.smartAccountAddress.toLowerCase() === smartAccountAddress.toLowerCase()
      && record.guardedTxHash.toLowerCase() === input.guardedTxHash.toLowerCase()
    );
    const record: RiskGuardPendingUserOpRecord = {
      pendingUserOpId: existing?.pendingUserOpId ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      walletAddress,
      smartAccountAddress,
      guardedTxHash: input.guardedTxHash,
      ...(input.entrypointAddress ? { entrypointAddress: getAddress(input.entrypointAddress) } : {}),
      userOp: input.userOp,
      status: "pending"
    };

    await this.store.update((records) => [
      ...records.filter((item) => item.pendingUserOpId !== record.pendingUserOpId),
      record
    ]);

    return record;
  }

  public async findPending(smartAccountAddress: string, guardedTxHash: string) {
    const smartAccount = getAddress(smartAccountAddress);
    const records = await this.store.read();

    return records
      .filter((record) =>
        record.status === "pending"
        && record.smartAccountAddress.toLowerCase() === smartAccount.toLowerCase()
        && record.guardedTxHash.toLowerCase() === guardedTxHash.toLowerCase()
      )
      .at(-1);
  }

  public async markSubmitted(pendingUserOpId: string, userOpHash: string, submittedTxHash?: string) {
    const now = new Date().toISOString();
    await this.store.update((records) => records.map((record) =>
      record.pendingUserOpId === pendingUserOpId
        ? {
            ...record,
            status: "submitted",
            userOpHash,
            ...(submittedTxHash ? { submittedTxHash } : {}),
            submittedAt: now,
            updatedAt: now
          }
        : record
    ));
  }

  public async markFailed(pendingUserOpId: string, failureReason: string) {
    const now = new Date().toISOString();
    await this.store.update((records) => records.map((record) =>
      record.pendingUserOpId === pendingUserOpId
        ? { ...record, status: "failed", failureReason, updatedAt: now }
        : record
    ));
  }
}
