import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { z } from "zod";

import type { AgentConfig } from "../config/env.js";
import type { AuditService } from "./audit.service.js";
import type { SessionKeyService } from "./session-key.service.js";

const validatorAbi = [
  "function agentBudgetOf(address smartAccount) view returns (uint256)",
  "function agentPlatform() view returns (address)",
  "function riskAgentRewardPerCall() view returns (uint256)",
  "function AGENT_SUBCOMMITTEE_SIZE() view returns (uint256)",
  "function fundAgentBudget(address smartAccount) payable"
] as const;
const agentPlatformAbi = [
  "function getRequestDeposit() view returns (uint256)"
] as const;
const zeroAddress = "0x0000000000000000000000000000000000000000";

export const riskGuardReviewBudgetRequestSchema = z
  .object({
    smartAccountAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value))
  })
  .strict();

export type RiskGuardReviewBudgetRequest = z.infer<typeof riskGuardReviewBudgetRequestSchema>;

export interface RiskGuardReviewBudgetResult {
  funded: boolean;
  sufficient: boolean;
  budgetWei: string;
  requiredWei: string;
  fundingTxHash?: string;
}

/**
 * Tops up the validator's per-smart-account agent-review budget on behalf of the
 * user so the browser never has to send the `fundAgentBudget` transaction.
 *
 * `fundAgentBudget` is permissionless, so the agent's `riskguard-approval`
 * session-key wallet (funded during RiskGuard setup) can pay it. This removes
 * one wallet signature from the agent-review flow without touching the contract
 * or requiring the agent to be an owner/admin of the smart account.
 */
export class RiskGuardReviewBudgetService {
  private readonly provider: JsonRpcProvider;

  public constructor(
    private readonly config: AgentConfig,
    private readonly audit: AuditService,
    private readonly sessionKeys: SessionKeyService
  ) {
    this.provider = new JsonRpcProvider(config.somnia.rpcUrl);
  }

  public async ensureBudget(
    input: RiskGuardReviewBudgetRequest
  ): Promise<RiskGuardReviewBudgetResult> {
    const validatorAddress = this.requireValidator();
    const smartAccountAddress = getAddress(input.smartAccountAddress);
    const validator = new Contract(validatorAddress, validatorAbi, this.provider);

    const [currentBudget, requiredBudget] = await Promise.all([
      validator.getFunction("agentBudgetOf").staticCall(smartAccountAddress) as Promise<bigint>,
      this.computeRequiredBudget(validator)
    ]);

    if (currentBudget >= requiredBudget) {
      return {
        funded: false,
        sufficient: true,
        budgetWei: currentBudget.toString(),
        requiredWei: requiredBudget.toString()
      };
    }

    const { record, privateKey } = await this.sessionKeys.getPrivateKeyForSmartAccount(
      smartAccountAddress,
      "riskguard-approval"
    );
    const wallet = new Wallet(privateKey, this.provider);
    const writableValidator = validator.connect(wallet) as Contract;
    const deficit = requiredBudget - currentBudget;

    const tx = await writableValidator.getFunction("fundAgentBudget")(smartAccountAddress, {
      value: deficit
    });
    const receipt = await tx.wait();
    await this.sessionKeys.markUsed(record.sessionKeyId);

    const fundingTxHash = receipt?.hash ?? tx.hash;
    await this.audit.record({
      eventType: "riskguard.agent-budget.funded",
      status: "succeeded",
      metadata: {
        smartAccountAddress,
        validatorAddress,
        fundingTxHash,
        fundedWei: deficit.toString(),
        budgetWei: requiredBudget.toString()
      }
    });

    return {
      funded: true,
      sufficient: true,
      budgetWei: requiredBudget.toString(),
      requiredWei: requiredBudget.toString(),
      fundingTxHash
    };
  }

  private async computeRequiredBudget(validator: Contract): Promise<bigint> {
    const agentPlatformAddress = getAddress(
      await validator.getFunction("agentPlatform").staticCall()
    );
    if (agentPlatformAddress === getAddress(zeroAddress)) {
      throw new Error("RiskGuard agent platform is not configured on the validator contract.");
    }

    const platform = new Contract(agentPlatformAddress, agentPlatformAbi, this.provider);
    const [requestDeposit, rewardPerCall, subcommitteeSize] = (await Promise.all([
      platform.getFunction("getRequestDeposit").staticCall(),
      validator.getFunction("riskAgentRewardPerCall").staticCall(),
      validator.getFunction("AGENT_SUBCOMMITTEE_SIZE").staticCall()
    ])) as [bigint, bigint, bigint];

    return requestDeposit + rewardPerCall * subcommitteeSize;
  }

  private requireValidator(): string {
    const validatorAddress = this.config.publicChain.contracts.riskGuardValidatorModule;
    if (!validatorAddress) {
      throw new Error("RiskGuard validator module is not configured.");
    }
    return validatorAddress;
  }
}
