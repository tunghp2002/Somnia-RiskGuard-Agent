import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { z } from "zod";

import type { AgentConfig } from "../../config/env.js";
import type { AuditService } from "../audit.service.js";
import type { SessionKeyService } from "../session-key.service.js";

const approvalStoreAbi = [
  "function submitApproval(address smartAccount, bytes32 txHash) external",
  "function registeredAgent(address smartAccount) view returns (address)"
] as const;

export const riskGuardPendingApprovalRequestSchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value))
      .optional(),
    smartAccountAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value)),
    txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    target: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .transform((value) => getAddress(value))
      .optional(),
    valueWei: z.string().regex(/^\d+$/).optional(),
    selector: z.string().regex(/^0x[a-fA-F0-9]{8}$/).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().min(1).max(800).optional(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]).default("medium")
  })
  .strict();

export type RiskGuardPendingApprovalRequest = z.infer<typeof riskGuardPendingApprovalRequestSchema>;

export interface RiskGuardApprovalReceipt {
  txHash: string;
  approvalStore: string;
}

export class RiskGuardApprovalService {
  private readonly provider: JsonRpcProvider;

  public constructor(
    private readonly config: AgentConfig,
    private readonly audit: AuditService,
    private readonly sessionKeys: SessionKeyService
  ) {
    this.provider = new JsonRpcProvider(config.somnia.rpcUrl);
  }

  public async submitApproval(input: {
    smartAccountAddress: string;
    txHash: string;
  }): Promise<RiskGuardApprovalReceipt> {
    const approvalStore = this.requireApprovalStore();
    const smartAccountAddress = getAddress(input.smartAccountAddress);
    const { record, privateKey } = await this.sessionKeys.getPrivateKeyForSmartAccount(
      smartAccountAddress,
      "riskguard-approval"
    );
    const wallet = new Wallet(privateKey, this.provider);
    const contract = new Contract(approvalStore, approvalStoreAbi, wallet);

    const registeredAgent = getAddress(
      await contract.getFunction("registeredAgent").staticCall(smartAccountAddress)
    );
    if (registeredAgent !== getAddress(wallet.address)) {
      throw new Error(
        `RiskGuard agent wallet ${wallet.address} is not registered for ${smartAccountAddress}.`
      );
    }

    const tx = await contract.getFunction("submitApproval")(smartAccountAddress, input.txHash);
    const receipt = await tx.wait();
    await this.sessionKeys.markUsed(record.sessionKeyId);

    await this.audit.record({
      eventType: "riskguard.approval.submitted",
      status: "succeeded",
      metadata: {
        smartAccountAddress,
        approvalTxHash: receipt?.hash ?? tx.hash,
        guardedTxHash: input.txHash,
        approvalStore
      }
    });

    return {
      txHash: receipt?.hash ?? tx.hash,
      approvalStore
    };
  }

  private requireApprovalStore() {
    const approvalStore = this.config.publicChain.contracts.riskGuardApprovalStore;
    if (!approvalStore) {
      throw new Error("RiskGuard ApprovalStore is not configured.");
    }
    return approvalStore;
  }
}
