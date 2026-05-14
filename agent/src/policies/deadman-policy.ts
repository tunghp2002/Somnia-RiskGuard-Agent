import { getAddress } from "ethers";
import { z } from "zod";

import { denyExecution, type PolicyDecision } from "./execution-policy.js";

export const deadmanExecutionPolicyInputSchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value)),
  beneficiaryAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value)),
  requestedBy: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value)),
  signerAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value)),
  chainId: z.number().int().positive(),
  contractAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .transform((value) => getAddress(value))
    .optional(),
  heartbeatExpired: z.boolean(),
  timelockReady: z.boolean(),
  contractStateReady: z.boolean(),
  alreadyExecuted: z.boolean().default(false)
});

export type DeadmanExecutionPolicyInput = z.infer<typeof deadmanExecutionPolicyInputSchema>;

export function evaluateDeadmanExecutionPolicy(
  input: DeadmanExecutionPolicyInput
): PolicyDecision {
  const parsed = deadmanExecutionPolicyInputSchema.parse(input);
  const base = {
    toolName: "deadman.safe-execution",
    signerAddress: parsed.signerAddress,
    chainId: parsed.chainId,
    calldataSummary: `Dead Man's Switch execution check for ${parsed.walletAddress}`,
    ...(parsed.contractAddress ? { target: parsed.contractAddress } : {})
  };

  if (parsed.requestedBy !== parsed.beneficiaryAddress) {
    return denyExecution({
      ...base,
      policyId: "deadman.execution.unauthorized",
      reason: "Only the configured beneficiary can request this path."
    });
  }

  if (parsed.alreadyExecuted) {
    return denyExecution({
      ...base,
      policyId: "deadman.execution.already-executed",
      reason: "Dead Man's Switch execution has already been marked complete."
    });
  }

  if (!parsed.contractStateReady) {
    return denyExecution({
      ...base,
      policyId: "deadman.execution.contract-state-required",
      reason: "Contract state is not available or not ready for execution."
    });
  }

  if (!parsed.heartbeatExpired) {
    return denyExecution({
      ...base,
      policyId: "deadman.execution.not-expired",
      reason: "Heartbeat grace period has not expired."
    });
  }

  if (!parsed.timelockReady) {
    return denyExecution({
      ...base,
      policyId: "deadman.execution.timelock-pending",
      reason: "Dead Man's Switch timelock is still pending."
    });
  }

  return {
    allowed: true,
    reason: "Configured beneficiary path is available after expiry and timelock completion.",
    policyId: "deadman.execution.available",
    createdAt: new Date().toISOString(),
    toolName: base.toolName,
    signerAddress: base.signerAddress,
    chainId: base.chainId,
    ...(base.target ? { target: base.target } : {}),
    calldataSummary: base.calldataSummary
  };
}
