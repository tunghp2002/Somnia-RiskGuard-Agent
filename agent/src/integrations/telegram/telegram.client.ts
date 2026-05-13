import type { AgentConfig } from "../../config/env.js";

export interface TelegramInlineButton {
  text: string;
  callbackData: string;
}

export interface TelegramSendMessageInput {
  chatId: string;
  text: string;
  buttons?: TelegramInlineButton[];
}

export interface TelegramSendMessageResult {
  messageId?: string;
}

export interface TelegramClient {
  health(): Promise<{ ok: boolean; enabled: boolean; reason?: string }> | { ok: boolean; enabled: boolean; reason?: string };
  sendMessage(input: TelegramSendMessageInput): Promise<TelegramSendMessageResult>;
}

export class DisabledTelegramClient implements TelegramClient {
  public health() {
    return {
      ok: false,
      enabled: false,
      reason: "Telegram bot token and chat ID are not configured"
    };
  }

  public async sendMessage(): Promise<TelegramSendMessageResult> {
    throw new Error("Telegram is not configured");
  }
}

export class TelegramBotApiClient implements TelegramClient {
  public constructor(private readonly config: AgentConfig["telegram"]) {}

  public health() {
    return this.config.enabled && this.config.botToken
      ? { ok: true, enabled: true }
      : {
          ok: false,
          enabled: false,
          reason: "Telegram bot token and chat ID are not configured"
        };
  }

  public async sendMessage(input: TelegramSendMessageInput): Promise<TelegramSendMessageResult> {
    if (!this.config.enabled || !this.config.botToken) {
      throw new Error("Telegram is not configured");
    }

    const response = await fetch(
      `https://api.telegram.org/bot${this.config.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: input.chatId,
          text: input.text,
          reply_markup: input.buttons?.length
            ? {
                inline_keyboard: input.buttons.map((button) => [
                  { text: button.text, callback_data: button.callbackData }
                ])
              }
            : undefined
        })
      }
    );

    const payload = (await response.json()) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
    };

    if (!response.ok || !payload.ok) {
      throw new Error(payload.description ?? "Telegram sendMessage failed");
    }

    const messageId = payload.result?.message_id?.toString();
    return messageId ? { messageId } : {};
  }
}

export function createTelegramClient(config: AgentConfig): TelegramClient {
  return config.telegram.enabled
    ? new TelegramBotApiClient(config.telegram)
    : new DisabledTelegramClient();
}
