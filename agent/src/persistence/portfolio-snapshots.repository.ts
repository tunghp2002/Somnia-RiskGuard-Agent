import { randomUUID } from "node:crypto";

import { getAddress } from "ethers";
import { z } from "zod";

import { JsonStore, type RepositoryStore } from "./json-store.js";

export const portfolioAssetSchema = z.object({
  symbol: z.string().min(1),
  balance: z.string().regex(/^\d+(\.\d+)?$/),
  valueUsd: z.string().regex(/^\d+(\.\d+)?$/)
});

export const rewardSignalSchema = z.object({
  protocol: z.string().min(1),
  claimableValueUsd: z.string().regex(/^\d+(\.\d+)?$/)
});

export const riskSignalSchema = z.object({
  signalType: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  description: z.string().min(1)
});

export const portfolioSnapshotSchema = z.object({
  portfolioSnapshotId: z.string().uuid(),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value)),
  source: z.enum(["demo", "somnia"]),
  totalValueUsd: z.string().regex(/^\d+(\.\d+)?$/),
  assets: z.array(portfolioAssetSchema),
  rewards: z.array(rewardSignalSchema),
  riskSignals: z.array(riskSignalSchema),
  change: z
    .object({
      previousPortfolioSnapshotId: z.string().uuid().optional(),
      changedFields: z.array(z.string()),
      shouldAnalyzeRisk: z.boolean()
    })
    .optional(),
  createdAt: z.string().datetime()
});

export const portfolioSnapshotsSchema = z.array(portfolioSnapshotSchema);

export type PortfolioSnapshot = z.infer<typeof portfolioSnapshotSchema>;
export type PortfolioAsset = z.infer<typeof portfolioAssetSchema>;
export type RewardSignal = z.infer<typeof rewardSignalSchema>;
export type RiskSignal = z.infer<typeof riskSignalSchema>;

export type CreatePortfolioSnapshotInput = Omit<
  PortfolioSnapshot,
  "portfolioSnapshotId" | "createdAt"
> & {
  portfolioSnapshotId?: string;
  createdAt?: string;
};

export class PortfolioSnapshotsRepository {
  private readonly store: RepositoryStore<PortfolioSnapshot[]>;

  public constructor(dataDirectory?: string | URL, store?: RepositoryStore<PortfolioSnapshot[]>) {
    this.store = store ?? new JsonStore({
      filename: "portfolio-snapshots.json",
      schema: portfolioSnapshotsSchema,
      defaultValue: [],
      dataDirectory
    });
  }

  public list(): Promise<PortfolioSnapshot[]> {
    return this.store.read();
  }

  public async latestForWallet(walletAddress: string): Promise<PortfolioSnapshot | undefined> {
    const checksumAddress = getAddress(walletAddress);
    const snapshots = await this.store.read();
    return snapshots
      .filter((snapshot) => snapshot.walletAddress === checksumAddress)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  public async latest(): Promise<PortfolioSnapshot | undefined> {
    const snapshots = await this.store.read();
    return [...snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  public async append(input: CreatePortfolioSnapshotInput): Promise<PortfolioSnapshot> {
    const snapshot = portfolioSnapshotSchema.parse({
      ...input,
      walletAddress: getAddress(input.walletAddress),
      portfolioSnapshotId: input.portfolioSnapshotId ?? randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString()
    });

    await this.store.update((snapshots) => [...snapshots, snapshot]);
    return snapshot;
  }
}
