import { z } from "zod";

export const policyDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().min(1),
  policyId: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
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
