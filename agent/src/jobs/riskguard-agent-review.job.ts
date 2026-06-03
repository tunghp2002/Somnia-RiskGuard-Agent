import { Contract, Interface, JsonRpcProvider } from "ethers";

import type { AgentConfig } from "../config/env.js";
import type { AuditService } from "../services/audit.service.js";
import type { TelegramAlertService } from "../services/telegram-alert.service.js";
import type { TelegramClient } from "../integrations/telegram/telegram.client.js";
import type { TelegramBindingsRepository } from "../persistence/telegram-bindings.repository.js";

const riskGuardValidatorAbi = [
  "event RiskAgentReviewCompleted(uint256 indexed requestId,address indexed smartAccount,bytes32 indexed txHash,bool approved,string reason)"
] as const;
const riskGuardValidatorInterface = new Interface(riskGuardValidatorAbi);

export class RiskGuardAgentReviewJob {
  private readonly provider: JsonRpcProvider;
  private lastScannedBlock: number | undefined;

  public constructor(
    private readonly config: AgentConfig,
    private readonly bindings: TelegramBindingsRepository,
    private readonly telegram: TelegramClient,
    private readonly audit: AuditService,
    private readonly telegramAlerts?: TelegramAlertService
  ) {
    this.provider = new JsonRpcProvider(config.somnia.rpcUrl, config.somnia.chainId);
  }

  public async runOnce() {
    const validatorAddress = this.config.publicChain.contracts.riskGuardValidatorModule;

    if (!validatorAddress || !this.config.telegram.enabled) {
      return { skipped: true };
    }

    const latestBlock = await this.provider.getBlockNumber();
    const fromBlock = this.lastScannedBlock === undefined
      ? Math.max(0, latestBlock - 20)
      : this.lastScannedBlock + 1;

    if (fromBlock > latestBlock) {
      return { scanned: 0, notified: 0 };
    }

    const contract = new Contract(validatorAddress, riskGuardValidatorAbi, this.provider);
    const event = contract.getEvent("RiskAgentReviewCompleted");
    const logs = await contract.queryFilter(event, fromBlock, latestBlock);
    let notified = 0;

    for (const log of logs) {
      const parsed = riskGuardValidatorInterface.parseLog(log);

      if (!parsed) {
        continue;
      }

      const smartAccount = String(parsed.args.smartAccount);
      const txHash = String(parsed.args.txHash);
      const binding = await this.bindings.latestForSmartAccount(smartAccount);

      if (!binding) {
        await this.audit.record({
          eventType: "riskguard.agent-review.telegram.skipped",
          status: "skipped",
          metadata: {
            reason: "missing_telegram_binding",
            smartAccount,
            txHash
          }
        });
        continue;
      }

      const approved = Boolean(parsed.args.approved);
      const reason = String(parsed.args.reason || "No reason returned by Somnia agent.");
      if (this.telegramAlerts) {
        await this.telegramAlerts.sendRiskGuardAgentReviewDecision({
          walletAddress: binding.walletAddress,
          smartAccountAddress: smartAccount,
          txHash,
          approved,
          reason
        });
      } else {
        await this.telegram.sendMessage({
          chatId: binding.chatId,
          text: [
            "Somnia Agent RiskGuard Review",
            `Agent Recommendation: ${approved ? "Approve" : "Decline"}`,
            `Smart Account: ${formatAddress(smartAccount)}`,
            `Tx Hash: ${formatAddress(txHash)}`,
            `Analysis: ${reason}`,
            "Choose Approve to submit a one-time approval, or Decline to reject execution."
          ].join("\n")
        });
      }
      notified += 1;

      await this.audit.record({
        eventType: "riskguard.agent-review.telegram.sent",
        status: "succeeded",
        metadata: {
          approved,
          requestId: parsed.args.requestId?.toString(),
          smartAccount,
          txHash
        }
      });
    }

    this.lastScannedBlock = latestBlock;
    return { scanned: logs.length, notified };
  }
}

function formatAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}
