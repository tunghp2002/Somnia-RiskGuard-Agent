import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getAddress } from "ethers";

import { JsonStore } from "./json-store.js";

export const riskSnapshotSchema = z.object({
  riskSnapshotId: z.string().uuid(),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value)),
  score: z.number().int().min(0).max(100),
  explanation: z.string(),
  provider: z.enum(["groq", "deepseek"]),
  threshold: z.object({
    alertThreshold: z.number().int().min(0).max(100),
    exceeded: z.boolean()
  }),
  safeNextSteps: z.array(z.string()),
  createdAt: z.string().datetime()
});

export type RiskSnapshotRecord = z.infer<typeof riskSnapshotSchema>;
export type CreateRiskSnapshotInput = Omit<
  RiskSnapshotRecord,
  "riskSnapshotId" | "createdAt"
> & {
  riskSnapshotId?: string;
  createdAt?: string;
};

export class RiskSnapshotsRepository {
  private readonly store: JsonStore<RiskSnapshotRecord[]>;

  public constructor(dataDirectory?: string | URL) {
    this.store = new JsonStore({
      filename: "risk-snapshots.json",
      schema: z.array(riskSnapshotSchema),
      defaultValue: [],
      dataDirectory
    });
  }

  public list(): Promise<RiskSnapshotRecord[]> {
    return this.store.read();
  }

  public async latestForWallet(walletAddress: string): Promise<RiskSnapshotRecord | undefined> {
    const checksumAddress = getAddress(walletAddress);
    const snapshots = await this.store.read();
    return snapshots
      .filter((snapshot) => snapshot.walletAddress === checksumAddress)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  public async append(input: CreateRiskSnapshotInput): Promise<RiskSnapshotRecord> {
    const snapshot = riskSnapshotSchema.parse({
      ...input,
      walletAddress: getAddress(input.walletAddress),
      riskSnapshotId: input.riskSnapshotId ?? randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString()
    });

    await this.store.update((snapshots) => [...snapshots, snapshot]);
    return snapshot;
  }
}
