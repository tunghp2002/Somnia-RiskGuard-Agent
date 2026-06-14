import { ServerDependencyError, parseOptionalWalletAddress, readJsonBody } from "../http-support.js";
import { failure, sendJson, success } from "../response.js";
import type { ApiRouteContext } from "./route-context.js";
import {
  telegramCallbackRequestSchema,
  telegramSignedBindingRequestSchema,
  telegramUnlinkRequestSchema
} from "../../services/telegram-alert.service.js";

export async function handleTelegramRoutes(context: ApiRouteContext): Promise<boolean> {
  const { dependencies, request, response, telegramConnect, url, requestId } = context;

  if (request.method === "GET" && url.pathname === "/api/telegram/health") {
    if (!dependencies.telegramAlerts) {
      throw new ServerDependencyError("Telegram alert service is not configured");
    }
    sendJson(response, 200, success(await dependencies.telegramAlerts.health(), requestId));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/telegram/connect/start") {
    if (!telegramConnect) {
      throw new ServerDependencyError("Telegram alert service is not configured");
    }

    const body = await readJsonBody(request);
    const walletAddress = parseOptionalWalletAddress(
      typeof body === "object" && body && "walletAddress" in body
        ? String((body as { walletAddress?: unknown }).walletAddress ?? "")
        : null
    );
    const smartAccountAddress = parseOptionalWalletAddress(
      typeof body === "object" && body && "smartAccountAddress" in body
        ? String((body as { smartAccountAddress?: unknown }).smartAccountAddress ?? "")
        : null
    );

    if (!walletAddress) {
      sendJson(response, 400, failure("validation_failed", "walletAddress is required"));
      return true;
    }

    const session = telegramConnect.start(walletAddress, smartAccountAddress);
    sendJson(response, 201, success(telegramConnect.serialize(session), requestId));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/telegram/connect/status") {
    const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));

    if (!walletAddress) {
      sendJson(response, 400, failure("validation_failed", "walletAddress is required"));
      return true;
    }

    if (!telegramConnect) {
      throw new ServerDependencyError("Telegram alert service is not configured");
    }

    const session = telegramConnect.latestForWallet(walletAddress);

    if (!session) {
      sendJson(response, 404, failure("not_found", "No Telegram Connect session is active"));
      return true;
    }

    sendJson(response, 200, success(telegramConnect.serialize(session), requestId));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/telegram/connect/confirm") {
    if (!telegramConnect) {
      throw new ServerDependencyError("Telegram alert service is not configured");
    }

    const body = await readJsonBody(request);
    const code = typeof body === "object" && body && "code" in body
      ? String((body as { code?: unknown }).code ?? "").toUpperCase()
      : "";
    const chatId = typeof body === "object" && body && "chatId" in body
      ? String((body as { chatId?: unknown }).chatId ?? "")
      : "";
    const telegramUserId = typeof body === "object" && body && "telegramUserId" in body
      ? String((body as { telegramUserId?: unknown }).telegramUserId ?? "")
      : undefined;
    const telegramUsername = typeof body === "object" && body && "telegramUsername" in body
      ? String((body as { telegramUsername?: unknown }).telegramUsername ?? "")
      : undefined;
    const telegramDisplayName = typeof body === "object" && body && "telegramDisplayName" in body
      ? String((body as { telegramDisplayName?: unknown }).telegramDisplayName ?? "")
      : undefined;
    const session = telegramConnect.get(code);

    if (!session) {
      sendJson(response, 404, failure("not_found", "Telegram Connect code was not found"));
      return true;
    }

    if (Date.parse(session.expiresAt) <= Date.now()) {
      await telegramConnect.confirm({
        code,
        chatId,
        ...(telegramUserId ? { telegramUserId } : {}),
        ...(telegramUsername ? { telegramUsername } : {}),
        ...(telegramDisplayName ? { telegramDisplayName } : {})
      });
      sendJson(response, 410, failure("telegram_connect_expired", "Telegram Connect code expired"));
      return true;
    }

    const confirmed = await telegramConnect.confirm({
      code,
      chatId,
      ...(telegramUserId ? { telegramUserId } : {}),
      ...(telegramUsername ? { telegramUsername } : {}),
      ...(telegramDisplayName ? { telegramDisplayName } : {})
    });
    sendJson(response, 200, success(telegramConnect.serialize(confirmed ?? session), requestId));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/telegram/bindings") {
    if (!dependencies.telegramAlerts) {
      throw new ServerDependencyError("Telegram alert service is not configured");
    }

    const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));

    if (!walletAddress) {
      sendJson(response, 400, failure("validation_failed", "walletAddress is required"));
      return true;
    }

    const binding = await dependencies.telegramAlerts.latestBindingForWallet(walletAddress);
    sendJson(response, 200, success({
      connected: Boolean(binding),
      botUrl: telegramConnect?.botUrl(),
      ...(binding ? { binding } : {})
    }, requestId));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/telegram/bindings") {
    if (!dependencies.telegramAlerts) {
      throw new ServerDependencyError("Telegram alert service is not configured");
    }
    const body = telegramSignedBindingRequestSchema.parse(await readJsonBody(request));
    const binding = await dependencies.telegramAlerts.linkChat(body);
    sendJson(response, 201, success(binding, requestId));
    return true;
  }

  if (request.method === "DELETE" && url.pathname === "/api/telegram/bindings") {
    if (!dependencies.telegramAlerts) {
      throw new ServerDependencyError("Telegram alert service is not configured");
    }

    const body = telegramUnlinkRequestSchema.parse(await readJsonBody(request));
    const binding = await dependencies.telegramAlerts.unlinkChat(body.walletAddress);
    sendJson(response, 200, success({ unlinked: Boolean(binding) }, requestId));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/telegram/callback") {
    if (!dependencies.telegramAlerts) {
      throw new ServerDependencyError("Telegram alert service is not configured");
    }
    const body = telegramCallbackRequestSchema.parse(await readJsonBody(request));
    const result = await dependencies.telegramAlerts.processCallback(body);
    sendJson(response, result.ok ? 200 : 400, success(result, requestId));
    return true;
  }

  return false;
}
