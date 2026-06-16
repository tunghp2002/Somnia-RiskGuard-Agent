import type { TelegramClient } from "../../integrations/telegram/telegram.client.js";
import type { TelegramBindingsRepository } from "../../persistence/telegram-bindings.repository.js";
import type { RewardClaimRecord } from "../../persistence/reward-claims.repository.js";
import type { AuditService } from "../audit.service.js";

export class TelegramRewardClaimNotifier {
  public constructor(
    private readonly bindings: TelegramBindingsRepository,
    private readonly telegram: TelegramClient,
    private readonly audit?: AuditService
  ) {}

  public async sendRewardClaimOutcome(claim: RewardClaimRecord): Promise<void> {
    const binding = await this.bindings.latestForWallet(claim.walletAddress);

    if (!binding) {
      await this.audit?.record({
        eventType: "reward.notification.skipped",
        status: "skipped",
        metadata: {
          walletAddress: claim.walletAddress,
          rewardClaimId: claim.rewardClaimId,
          reason: "missing_binding"
        }
      });
      return;
    }

    const health = await this.telegram.health();
    if (!health.ok) {
      await this.audit?.record({
        eventType: "reward.notification.skipped",
        status: "skipped",
        metadata: {
          walletAddress: claim.walletAddress,
          rewardClaimId: claim.rewardClaimId,
          reason: health.reason ?? "telegram_unhealthy"
        }
      });
      return;
    }

    await this.telegram.sendMessage({
      chatId: binding.chatId,
      text: [
        `Reward claim ${claim.status}.`,
        `Wallet: ${claim.walletAddress}`,
        `Protocol: ${claim.protocol}`,
        `Reward: ${claim.rewardToken} (${claim.valueUsd} USD)`,
        `Gas condition: ${claim.gasUsd} USD`,
        ...(claim.reason ? [`Reason: ${claim.reason}`] : []),
        ...(claim.txHash ? [`Transaction: ${claim.txHash}`] : [])
      ].join("\n")
    });

    await this.audit?.record({
      eventType: "reward.notification.sent",
      status: "succeeded",
      metadata: {
        walletAddress: claim.walletAddress,
        rewardClaimId: claim.rewardClaimId,
        status: claim.status
      }
    });
  }
}
