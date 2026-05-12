import { z } from "zod";

import { JsonStore } from "./json-store.js";

export const rewardClaimSchema = z.object({
  rewardClaimId: z.string().uuid(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  status: z.enum(["skipped", "attempted", "failed", "succeeded"]),
  valueUsd: z.string(),
  gasUsd: z.string(),
  txHash: z.string().optional(),
  createdAt: z.string().datetime()
});

export type RewardClaimRecord = z.infer<typeof rewardClaimSchema>;

export class RewardClaimsRepository {
  private readonly store: JsonStore<RewardClaimRecord[]>;

  public constructor(dataDirectory?: string | URL) {
    this.store = new JsonStore({
      filename: "reward-claims.json",
      schema: z.array(rewardClaimSchema),
      defaultValue: [],
      dataDirectory
    });
  }

  public list(): Promise<RewardClaimRecord[]> {
    return this.store.read();
  }
}
