import { createThirdwebClient, defineChain } from "thirdweb";
import { bundleUserOp, waitForUserOpReceipt, type UserOperation } from "thirdweb/wallets/smart";
import { getAddress } from "ethers";
import { z } from "zod";

import type { AgentConfig } from "../config/env.js";
import type {
  RiskGuardPendingUserOpsRepository
} from "../persistence/riskguard-pending-userops.repository.js";
import type { AuditService } from "./audit.service.js";

export const riskGuardPendingUserOpRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => getAddress(value)),
  smartAccountAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => getAddress(value)),
  guardedTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  entrypointAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  userOp: z.record(z.string(), z.unknown())
});

export type RiskGuardPendingUserOpRequest = z.infer<typeof riskGuardPendingUserOpRequestSchema>;

export class RiskGuardPendingUserOpService {
  public constructor(
    private readonly config: AgentConfig,
    private readonly repository: RiskGuardPendingUserOpsRepository,
    private readonly audit: AuditService
  ) {}

  public async store(input: RiskGuardPendingUserOpRequest) {
    const parsed = riskGuardPendingUserOpRequestSchema.parse(input);
    const record = await this.repository.upsert({
      walletAddress: parsed.walletAddress,
      smartAccountAddress: parsed.smartAccountAddress,
      guardedTxHash: parsed.guardedTxHash,
      userOp: parsed.userOp,
      ...(parsed.entrypointAddress ? { entrypointAddress: parsed.entrypointAddress } : {})
    });

    await this.audit.record({
      eventType: "riskguard.pending-userop.stored",
      status: "succeeded",
      metadata: {
        pendingUserOpId: record.pendingUserOpId,
        walletAddress: record.walletAddress,
        smartAccountAddress: record.smartAccountAddress,
        guardedTxHash: record.guardedTxHash
      }
    });

    return {
      pendingUserOpId: record.pendingUserOpId,
      stored: true
    };
  }

  public async replayApproved(input: {
    smartAccountAddress: string;
    guardedTxHash: string;
  }) {
    const record = await this.repository.findPending(
      input.smartAccountAddress,
      input.guardedTxHash
    );

    if (!record) {
      return { replayed: false as const, reason: "pending_userop_not_found" };
    }

    if (!this.config.thirdweb.secretKey) {
      await this.repository.markFailed(record.pendingUserOpId, "THIRDWEB_SECRET_KEY is missing.");
      throw new Error("THIRDWEB_SECRET_KEY is required to replay approved UserOps.");
    }

    const client = createThirdwebClient({
      secretKey: this.config.thirdweb.secretKey
    });
    const chain = defineChain({
      id: this.config.publicChain.chainId,
      name: this.config.publicChain.name,
      nativeCurrency: this.config.publicChain.nativeCurrency,
      rpc: this.config.publicChain.rpcUrl,
      blockExplorers: [
        {
          name: "Somnia Explorer",
          url: this.config.publicChain.blockExplorerUrl
        }
      ],
      testnet: true
    });

    try {
      const userOpHash = await bundleUserOp({
        userOp: record.userOp as UserOperation,
        options: {
          chain,
          client,
          ...(record.entrypointAddress ? { entrypointAddress: record.entrypointAddress } : {})
        }
      });
      const receipt = await waitForUserOpReceipt({
        chain,
        client,
        ...(record.entrypointAddress ? { entrypointAddress: record.entrypointAddress } : {}),
        userOpHash
      });
      await this.repository.markSubmitted(record.pendingUserOpId, userOpHash, receipt.transactionHash);
      await this.audit.record({
        eventType: "riskguard.pending-userop.replayed",
        status: "succeeded",
        metadata: {
          pendingUserOpId: record.pendingUserOpId,
          smartAccountAddress: record.smartAccountAddress,
          guardedTxHash: record.guardedTxHash,
          userOpHash,
          submittedTxHash: receipt.transactionHash
        }
      });

      return { replayed: true as const, userOpHash, txHash: receipt.transactionHash };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "UserOp replay failed.";
      await this.repository.markFailed(record.pendingUserOpId, reason);
      await this.audit.record({
        eventType: "riskguard.pending-userop.replay.failed",
        status: "failed",
        metadata: {
          pendingUserOpId: record.pendingUserOpId,
          smartAccountAddress: record.smartAccountAddress,
          guardedTxHash: record.guardedTxHash,
          reason
        }
      });
      throw error;
    }
  }
}
