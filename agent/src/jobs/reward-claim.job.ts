import type { RewardClaimService, RewardRunResult } from "../services/reward-claim.service.js";

export class RewardClaimJob {
  public constructor(private readonly rewards: RewardClaimService) {}

  public runOnce(): Promise<RewardRunResult[]> {
    return this.rewards.run();
  }
}
