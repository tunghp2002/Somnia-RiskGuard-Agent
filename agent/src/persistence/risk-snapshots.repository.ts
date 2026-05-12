import { z } from "zod";

import { JsonStore } from "./json-store.js";

export const riskSnapshotSchema = z.object({
  riskSnapshotId: z.string().uuid(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  score: z.number().int().min(0).max(100),
  explanation: z.string(),
  createdAt: z.string().datetime()
});

export type RiskSnapshotRecord = z.infer<typeof riskSnapshotSchema>;

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
}
