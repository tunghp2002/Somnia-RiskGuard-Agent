import { getAddress } from "ethers";
import { z } from "zod";

import { denyExecution, type PolicyDecision } from "./execution-policy.js";

const supportedRewardActions = new Set(["claim_small_reward"]);

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => getAddress(value));

export const rewardClaimPolicyInputSchema = z
  .object({
    actionType: z.string().min(1).default("claim_small_reward"),
    autoClaimEnabled: z.boolean(),
    rewardValueUsd: z.number().nonnegative(),
    gasUsd: z.number().nonnegative(),
    minRewardValueUsd: z.number().nonnegative(),
    maxClaimGasUsd: z.number().nonnegative(),
    signerAddress: addressSchema,
    chainId: z.number().int().positive(),
    target: addressSchema,
    calldataSummary: z.string().min(1),
    now: z.date().optional()
  })
  .strict();

export type RewardClaimPolicyInput = z.infer<typeof rewardClaimPolicyInputSchema>;

export function evaluateRewardClaimPolicy(input: RewardClaimPolicyInput): PolicyDecision {
  const parsed = rewardClaimPolicyInputSchema.parse(input);
  const createdAt = (parsed.now ?? new Date()).toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + 60_000).toISOString();

  if (!supportedRewardActions.has(parsed.actionType)) {
    return denyReward(parsed, "reward.action.unsupported", "Unsupported action is outside MVP scope.", createdAt);
  }

  if (!parsed.autoClaimEnabled) {
    return denyReward(parsed, "reward.claim.disabled", "Auto-claim is disabled for this wallet.", createdAt);
  }

  if (parsed.rewardValueUsd < parsed.minRewardValueUsd) {
    return denyReward(parsed, "reward.claim.value_below_minimum", "Reward value is below the configured minimum.", createdAt);
  }

  if (parsed.gasUsd > parsed.maxClaimGasUsd) {
    return denyReward(parsed, "reward.claim.gas_above_maximum", "Estimated gas exceeds the configured maximum.", createdAt);
  }

  return {
    allowed: true,
    reason: "Reward claim satisfies auto-claim, value, and gas policies.",
    policyId: "reward.claim.allowed",
    createdAt,
    expiresAt,
    toolName: "claim_small_reward",
    signerAddress: parsed.signerAddress,
    chainId: parsed.chainId,
    target: parsed.target,
    calldataSummary: parsed.calldataSummary
  };
}

function denyReward(
  input: RewardClaimPolicyInput,
  policyId: string,
  reason: string,
  createdAt: string
): PolicyDecision {
  return {
    ...denyExecution({
      policyId,
      reason,
      toolName: input.actionType,
      signerAddress: input.signerAddress,
      chainId: input.chainId,
      target: input.target,
      calldataSummary: input.calldataSummary
    }),
    createdAt
  };
}
