import { describe, expect, it, vi } from "vitest";

import { TelegramAlertServiceError, type TelegramAlertService } from "../telegram-alert/index.js";
import { TelegramConnectService } from "./index.js";

const walletAddress = "0x1111111111111111111111111111111111111111";

function createService(linkChat = vi.fn().mockResolvedValue({ chatId: "123" })) {
  return new TelegramConnectService({
    linkChat
  } as unknown as TelegramAlertService);
}

describe("TelegramConnectService", () => {
  it("generates high-entropy connect codes that fit Telegram start payloads", () => {
    const service = createService();
    const session = service.start(walletAddress);

    expect(session.code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
    expect(service.get(session.code.toLowerCase())).toBe(session);
  });

  it("confirms a /start payload and returns a clear Telegram success message", async () => {
    const linkChat = vi.fn().mockResolvedValue({ chatId: "123" });
    const service = createService(linkChat);
    const session = service.start(walletAddress);

    const result = await service.confirmFromText({
      text: `/start ${session.code}`,
      chatId: "123",
      telegramUserId: "456",
      telegramUsername: "riskguard_user"
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Telegram alerts are now enabled");
    expect(result.message).toContain("0x1111...1111");
    expect(linkChat).toHaveBeenCalledWith({
      walletAddress,
      chatId: "123",
      telegramUserId: "456",
      telegramUsername: "riskguard_user"
    });
  });

  it("does not bind a waiting wallet from a code-less /start message", async () => {
    const linkChat = vi.fn().mockResolvedValue({ chatId: "123" });
    const service = createService(linkChat);
    service.start(walletAddress);

    const result = await service.confirmFromText({
      text: "/start",
      chatId: "123"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Open Telegram Connect");
    expect(linkChat).not.toHaveBeenCalled();
  });

  it("looks up the latest wallet session case-insensitively", () => {
    const service = createService();
    const session = service.start(walletAddress.toUpperCase());

    expect(service.latestForWallet(walletAddress)).toBe(session);
  });

  it("marks the session failed and returns a user-visible message when binding fails", async () => {
    const service = createService(vi.fn().mockRejectedValue(
      new TelegramAlertServiceError(
        "monitored_wallet_not_found",
        "Monitored wallet is not registered",
        404
      )
    ));
    const session = service.start(walletAddress);

    const result = await service.confirmFromText({
      text: `/start ${session.code}`,
      chatId: "123"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("wallet profile is not registered");
    expect(service.serialize(session).status).toBe("failed");
  });
});
