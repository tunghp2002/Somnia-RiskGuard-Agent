import type { AgentConfig } from "../../config/env.js";

export interface TelegramInlineButton {
  text: string;
  callbackData: string;
}

export interface TelegramBotCommand {
  command: string;
  description: string;
}

export interface TelegramSendMessageInput {
  chatId: string;
  text: string;
  buttons?: TelegramInlineButton[];
  parseMode?: "HTML" | "MarkdownV2";
}

export interface TelegramSendMessageResult {
  messageId?: string;
}

export interface TelegramDeleteMessageInput {
  chatId: string;
  messageId: string;
}

export interface TelegramEditMessageReplyMarkupInput {
  chatId: string;
  messageId: string;
  buttons?: TelegramInlineButton[];
}

export interface TelegramCallbackUpdate {
  updateId: number;
  callbackQueryId: string;
  chatId: string;
  messageId?: string;
  telegramUserId?: string;
  data: string;
}

export interface TelegramTextUpdate {
  updateId: number;
  chatId: string;
  telegramUserId?: string;
  telegramUsername?: string;
  telegramDisplayName?: string;
  text: string;
}

export interface TelegramPollingHandle {
  stop(): void;
}

export interface StartTelegramPollingOptions {
  handleCallback(update: TelegramCallbackUpdate): Promise<{ ok: boolean; message: string }>;
  handleTextMessage?(update: TelegramTextUpdate): Promise<{ ok: boolean; message: string }>;
  commands?: TelegramBotCommand[];
  intervalMs?: number;
  logger?: Pick<Console, "error" | "info">;
}

export interface TelegramClient {
  health(): Promise<{ ok: boolean; enabled: boolean; reason?: string }> | { ok: boolean; enabled: boolean; reason?: string };
  sendMessage(input: TelegramSendMessageInput): Promise<TelegramSendMessageResult>;
  deleteMessage?(input: TelegramDeleteMessageInput): Promise<void>;
  editMessageReplyMarkup?(input: TelegramEditMessageReplyMarkupInput): Promise<void>;
  startPolling?(options: StartTelegramPollingOptions): TelegramPollingHandle;
}

export class DisabledTelegramClient implements TelegramClient {
  public health() {
    return {
      ok: false,
      enabled: false,
      reason: "Telegram bot token is not configured"
    };
  }

  public async sendMessage(): Promise<TelegramSendMessageResult> {
    throw new Error("Telegram is not configured");
  }

  public async deleteMessage(): Promise<void> {
    throw new Error("Telegram is not configured");
  }

  public async editMessageReplyMarkup(): Promise<void> {
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
          reason: "Telegram bot token is not configured"
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
          parse_mode: input.parseMode,
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

  public async deleteMessage(input: TelegramDeleteMessageInput): Promise<void> {
    if (!this.config.enabled || !this.config.botToken) {
      throw new Error("Telegram is not configured");
    }

    await fetch(
      `https://api.telegram.org/bot${this.config.botToken}/deleteMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: input.chatId,
          message_id: input.messageId
        })
      }
    );
  }

  public async editMessageReplyMarkup(input: TelegramEditMessageReplyMarkupInput): Promise<void> {
    if (!this.config.enabled || !this.config.botToken) {
      throw new Error("Telegram is not configured");
    }

    await fetch(
      `https://api.telegram.org/bot${this.config.botToken}/editMessageReplyMarkup`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: input.chatId,
          message_id: input.messageId,
          reply_markup: {
            inline_keyboard: input.buttons?.length
              ? input.buttons.map((button) => [
                  { text: button.text, callback_data: button.callbackData }
                ])
              : []
          }
        })
      }
    );
  }

  public startPolling(options: StartTelegramPollingOptions): TelegramPollingHandle {
    let stopped = false;
    let offset = 0;
    const intervalMs = options.intervalMs ?? 1_000;

    const poll = async () => {
      try {
        await this.deleteWebhook();
        if (options.commands?.length) {
          await this.setMyCommands(options.commands);
        }
      } catch (error) {
        options.logger?.error(
          { error: error instanceof Error ? error.message : "deleteWebhook failed" },
          "telegram deleteWebhook failed"
        );
      }

      while (!stopped) {
        try {
          const updates = await this.getUpdates(offset);
          for (const update of updates) {
            offset = Math.max(offset, update.update_id + 1);
            const callbackUpdate = this.toCallbackUpdate(update);

            if (callbackUpdate) {
              const result = await options.handleCallback(callbackUpdate);
              await this.answerCallbackQuery(
                callbackUpdate.callbackQueryId,
                result.message
              );
              continue;
            }

            const textUpdate = this.toTextUpdate(update);
            if (textUpdate && options.handleTextMessage) {
              const isCheckIn = /^\/checkin(?:@\w+)?$/i.test(textUpdate.text.trim());
              const pending = isCheckIn
                ? await this.sendMessage({
                    chatId: textUpdate.chatId,
                    text: "Checking in..."
                  })
                : undefined;
              const result = await options.handleTextMessage(textUpdate);
              if (pending?.messageId) {
                try {
                  await this.deleteMessage({
                    chatId: textUpdate.chatId,
                    messageId: pending.messageId
                  });
                } catch (error) {
                  options.logger?.error(
                    { error: error instanceof Error ? error.message : "delete checking message failed" },
                    "telegram delete checking message failed"
                  );
                }
              }
              await this.sendMessage({
                chatId: textUpdate.chatId,
                text: result.message
              });
            }
          }
        } catch (error) {
          options.logger?.error(
            { error: error instanceof Error ? error.message : "polling failed" },
            "telegram polling failed"
          );
        }

        if (!stopped) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }
    };

    void poll();

    return {
      stop() {
        stopped = true;
      }
    };
  }

  private async getUpdates(offset: number) {
    if (!this.config.botToken) {
      throw new Error("Telegram is not configured");
    }

    const response = await fetch(
      `https://api.telegram.org/bot${this.config.botToken}/getUpdates`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          offset,
          timeout: 25,
          allowed_updates: ["callback_query", "message"]
        })
      }
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      result?: TelegramRawUpdate[];
      description?: string;
    };

    if (!response.ok || !payload.ok) {
      throw new Error(payload.description ?? "Telegram getUpdates failed");
    }

    return payload.result ?? [];
  }

  private async deleteWebhook() {
    if (!this.config.botToken) {
      throw new Error("Telegram is not configured");
    }

    const response = await fetch(
      `https://api.telegram.org/bot${this.config.botToken}/deleteWebhook`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ drop_pending_updates: false })
      }
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      description?: string;
    };

    if (!response.ok || !payload.ok) {
      throw new Error(payload.description ?? "Telegram deleteWebhook failed");
    }
  }

  private async setMyCommands(commands: TelegramBotCommand[]) {
    if (!this.config.botToken) {
      throw new Error("Telegram is not configured");
    }

    const response = await fetch(
      `https://api.telegram.org/bot${this.config.botToken}/setMyCommands`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commands })
      }
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      description?: string;
    };

    if (!response.ok || !payload.ok) {
      throw new Error(payload.description ?? "Telegram setMyCommands failed");
    }
  }

  private async answerCallbackQuery(callbackQueryId: string, text: string) {
    if (!this.config.botToken) {
      throw new Error("Telegram is not configured");
    }

    await fetch(
      `https://api.telegram.org/bot${this.config.botToken}/answerCallbackQuery`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: text.slice(0, 200)
        })
      }
    );
  }

  private toCallbackUpdate(update: TelegramRawUpdate): TelegramCallbackUpdate | undefined {
    const callback = update.callback_query;
    const chatId = callback?.message?.chat?.id;
    const telegramUserId = callback?.from?.id;

    if (!callback?.id || !callback.data || chatId === undefined) {
      return undefined;
    }

    return {
      updateId: update.update_id,
      callbackQueryId: callback.id,
      chatId: chatId.toString(),
      ...(callback.message?.message_id === undefined ? {} : { messageId: callback.message.message_id.toString() }),
      ...(telegramUserId === undefined ? {} : { telegramUserId: telegramUserId.toString() }),
      data: callback.data
    };
  }

  private toTextUpdate(update: TelegramRawUpdate): TelegramTextUpdate | undefined {
    const message = update.message;
    const chatId = message?.chat?.id;
    const from = message?.from;
    const telegramUserId = from?.id;
    const telegramDisplayName = [from?.first_name, from?.last_name].filter(Boolean).join(" ");

    if (!message?.text || chatId === undefined) {
      return undefined;
    }

    return {
      updateId: update.update_id,
      chatId: chatId.toString(),
      ...(telegramUserId === undefined ? {} : { telegramUserId: telegramUserId.toString() }),
      ...(from?.username ? { telegramUsername: from.username } : {}),
      ...(telegramDisplayName ? { telegramDisplayName } : {}),
      text: message.text
    };
  }
}

interface TelegramRawUpdate {
  update_id: number;
  message?: {
    from?: { id?: number; username?: string; first_name?: string; last_name?: string };
    chat?: { id?: number };
    text?: string;
  };
  callback_query?: {
    id?: string;
    from?: { id?: number };
    message?: { chat?: { id?: number }; message_id?: number };
    data?: string;
  };
}

export function createTelegramClient(config: AgentConfig): TelegramClient {
  return config.telegram.enabled
    ? new TelegramBotApiClient(config.telegram)
    : new DisabledTelegramClient();
}
