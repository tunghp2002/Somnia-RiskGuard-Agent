import { z } from "zod";

import { isoDateTimeSchema } from "../utils/datetime.js";

export const policyDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().min(1),
  policyId: z.string().min(1),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.optional(),
  toolName: z.string().min(1),
  signerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
  target: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  calldataSummary: z.string().min(1)
});

export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export interface CreatePolicyDecisionInput {
  reason: string;
  policyId?: string;
  toolName: string;
  signerAddress: string;
  chainId: number;
  target?: string;
  calldataSummary: string;
}

export function denyExecution(input: CreatePolicyDecisionInput): PolicyDecision {
  return {
    allowed: false,
    reason: input.reason,
    policyId: input.policyId ?? "execution.default-deny",
    createdAt: new Date().toISOString(),
    toolName: input.toolName,
    signerAddress: input.signerAddress,
    chainId: input.chainId,
    ...(input.target ? { target: input.target } : {}),
    calldataSummary: input.calldataSummary
  };
}

export interface EvaluateTelegramSafeActionInput {
  safeAction: string;
  signerAddress: string;
  chainId: number;
}

const supportedTelegramSafeActions = new Set([
  "claim_small_reward",
  "deadman_check_in"
]);

export function evaluateTelegramSafeActionApproval(
  input: EvaluateTelegramSafeActionInput
): PolicyDecision {
  if (!supportedTelegramSafeActions.has(input.safeAction)) {
    return denyExecution({
      policyId: "telegram.safe-action.unsupported",
      reason: "Unsupported action is outside MVP scope.",
      toolName: `telegram.${input.safeAction}`,
      signerAddress: input.signerAddress,
      chainId: input.chainId,
      calldataSummary: "No calldata generated because the requested action is unsupported."
    });
  }

  return {
    allowed: true,
    reason: "Action is supported by the Telegram approval policy. Execution still requires the downstream domain policy before signing.",
    policyId: "telegram.safe-action.supported",
    createdAt: new Date().toISOString(),
    toolName: `telegram.${input.safeAction}`,
    signerAddress: input.signerAddress,
    chainId: input.chainId,
    calldataSummary: "Telegram approval routed to domain policy gate; no transaction signed by this policy."
  };
}
