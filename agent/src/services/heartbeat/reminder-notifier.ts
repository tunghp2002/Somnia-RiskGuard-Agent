import type { TelegramBindingsRepository } from "../../persistence/telegram-bindings.repository.js";
import type { TelegramClient } from "../../integrations/telegram/telegram.client.js";
import type { HeartbeatReminderNotifier } from "./index.js";

export class TelegramHeartbeatReminderNotifier implements HeartbeatReminderNotifier {
  public constructor(
    private readonly bindings: TelegramBindingsRepository,
    private readonly telegram: TelegramClient
  ) {}

  public async sendHeartbeatReminder(input: {
    walletAddress: string;
    beneficiaryAddress: string;
    nextDeadlineAt: string;
    graceEndsAt: string;
  }): Promise<void> {
    const binding = await this.bindings.latestForWallet(input.walletAddress);

    if (!binding) {
      return;
    }

    const health = await this.telegram.health();
    if (!health.ok) {
      throw new Error(health.reason ?? "Telegram is not healthy");
    }

    await this.telegram.sendMessage({
      chatId: binding.chatId,
      text: [
        "Heartbeat reminder: your RiskGuard check-in is due soon.",
        `Wallet: ${input.walletAddress}`,
        `Next deadline: ${input.nextDeadlineAt}`,
        `Grace period ends: ${input.graceEndsAt}`,
        `Beneficiary: ${input.beneficiaryAddress}`
      ].join("\n")
    });
  }
}
