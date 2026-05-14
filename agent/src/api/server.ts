import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

import { getAddress } from "ethers";
import { ZodError } from "zod";

import { failure, sendJson, success } from "./response.js";
import type { SetupService } from "../services/setup.service.js";
import { setupWalletRequestSchema } from "../services/setup.service.js";
import type { AuditEventsRepository } from "../persistence/audit-events.repository.js";
import type { PortfolioSnapshotsRepository } from "../persistence/portfolio-snapshots.repository.js";
import type { RiskSnapshotsRepository } from "../persistence/risk-snapshots.repository.js";
import {
  demoScenarioRequestSchema,
  type DemoScenarioService
} from "../services/demo-scenario.service.js";
import {
  telegramBindingRequestSchema,
  telegramCallbackRequestSchema,
  TelegramAlertServiceError,
  type TelegramAlertService
} from "../services/telegram-alert.service.js";
import {
  deadmanPolicyRequestSchema,
  heartbeatCheckInRequestSchema,
  HeartbeatServiceError,
  heartbeatSettingsRequestSchema,
  type HeartbeatService
} from "../services/heartbeat.service.js";
import {
  rewardFixtureRequestSchema,
  RewardClaimServiceError,
  rewardPolicyCheckRequestSchema,
  rewardRunRequestSchema,
  rewardSettingsRequestSchema,
  type RewardClaimService
} from "../services/reward-claim.service.js";

const defaultMaxBodyBytes = 1_048_576;
const sensitiveResponseKeyPattern =
  /(private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|authorization|cookie|password|credential)/i;

class PayloadTooLargeError extends Error {
  public constructor() {
    super("Request body is too large");
    this.name = "PayloadTooLargeError";
  }
}

class AddressValidationError extends Error {
  public constructor() {
    super("Wallet address is invalid");
    this.name = "AddressValidationError";
  }
}

class ServerDependencyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ServerDependencyError";
  }
}

function parseOptionalWalletAddress(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return getAddress(value);
  } catch {
    throw new AddressValidationError();
  }
}

function parseOptionalLimit(value: string | null, defaultValue = 20): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new AddressValidationError();
  }

  return parsed;
}

function redactSecretSafe(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretSafe(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveResponseKeyPattern.test(key) ? "[REDACTED]" : redactSecretSafe(item)
    ])
  );
}

async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes = defaultMaxBodyBytes
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;

    if (byteLength > maxBodyBytes) {
      throw new PayloadTooLargeError();
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export interface AgentApiDependencies {
  setupService: SetupService;
  auditEvents?: AuditEventsRepository;
  portfolioSnapshots?: PortfolioSnapshotsRepository;
  riskSnapshots?: RiskSnapshotsRepository;
  demoScenarios?: DemoScenarioService;
  telegramAlerts?: TelegramAlertService;
  heartbeats?: HeartbeatService;
  rewards?: RewardClaimService;
  health?: () => Promise<unknown> | unknown;
}

export function createAgentApiServer(dependencies: AgentApiDependencies): Server {
  return createServer(async (request, response) => {
    const requestId = request.headers["x-riskguard-request-id"]?.toString() ?? randomUUID();
    const url = new URL(request.url ?? "/", "http://localhost");

    try {
      if (request.method === "GET" && url.pathname === "/api/setup/readiness") {
        sendJson(response, 200, success(await dependencies.setupService.getReadiness(), requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/users") {
        const body = setupWalletRequestSchema.parse(await readJsonBody(request));
        const user = await dependencies.setupService.registerMonitoredWallet(body);
        sendJson(response, 201, success(user, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/portfolios/latest") {
        if (!dependencies.portfolioSnapshots) {
          throw new ServerDependencyError("Portfolio snapshots repository is not configured");
        }
        const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));
        const data = walletAddress
          ? await dependencies.portfolioSnapshots.latestForWallet(walletAddress)
          : await dependencies.portfolioSnapshots.latest();
        sendJson(response, 200, success(data ?? null, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/risk-snapshots/latest") {
        if (!dependencies.riskSnapshots) {
          throw new ServerDependencyError("Risk snapshots repository is not configured");
        }
        const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));
        const data = walletAddress
          ? await dependencies.riskSnapshots.latestForWallet(walletAddress)
          : await dependencies.riskSnapshots.latest();
        sendJson(response, 200, success(data ?? null, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/audit-events/recent") {
        if (!dependencies.auditEvents) {
          throw new ServerDependencyError("Audit events repository is not configured");
        }
        const limit = parseOptionalLimit(url.searchParams.get("limit"));
        const data = (await dependencies.auditEvents.list())
          .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
          .slice(0, limit)
          .map((event) => redactSecretSafe(event));
        sendJson(response, 200, success({ events: data }, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        const health = dependencies.health
          ? await dependencies.health()
          : { ok: true };
        sendJson(response, 200, success(health, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/demo/scenarios") {
        if (!dependencies.demoScenarios) {
          throw new ServerDependencyError("Demo scenario service is not configured");
        }
        const body = demoScenarioRequestSchema.parse(await readJsonBody(request));
        const result = await dependencies.demoScenarios.run(body);
        sendJson(response, 200, success(result, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/heartbeats/settings") {
        if (!dependencies.heartbeats) {
          throw new ServerDependencyError("Heartbeat service is not configured");
        }
        const body = heartbeatSettingsRequestSchema.parse(await readJsonBody(request));
        const status = await dependencies.heartbeats.configure(body);
        sendJson(response, 201, success(status, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/heartbeats/check-in") {
        if (!dependencies.heartbeats) {
          throw new ServerDependencyError("Heartbeat service is not configured");
        }
        const body = heartbeatCheckInRequestSchema.parse(await readJsonBody(request));
        const status = await dependencies.heartbeats.checkIn(body);
        sendJson(response, 200, success(status, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/heartbeats/status") {
        if (!dependencies.heartbeats) {
          throw new ServerDependencyError("Heartbeat service is not configured");
        }
        const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));

        if (!walletAddress) {
          sendJson(response, 400, failure("validation_failed", "walletAddress is required"));
          return;
        }

        const status = await dependencies.heartbeats.getStatus(walletAddress);
        sendJson(response, 200, success(status ?? null, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/heartbeats/beneficiary-status") {
        if (!dependencies.heartbeats) {
          throw new ServerDependencyError("Heartbeat service is not configured");
        }
        const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));
        const beneficiaryAddress = parseOptionalWalletAddress(url.searchParams.get("beneficiaryAddress"));

        if (!walletAddress) {
          sendJson(response, 400, failure("validation_failed", "walletAddress is required"));
          return;
        }

        const status = await dependencies.heartbeats.getBeneficiaryStatus(
          walletAddress,
          beneficiaryAddress
        );
        sendJson(response, 200, success(status ?? null, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/deadman/policy-check") {
        if (!dependencies.heartbeats) {
          throw new ServerDependencyError("Heartbeat service is not configured");
        }
        const body = deadmanPolicyRequestSchema.parse(await readJsonBody(request));
        const decision = await dependencies.heartbeats.evaluateExecution(body);
        sendJson(response, 200, success(decision, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/rewards/settings") {
        if (!dependencies.rewards) {
          throw new ServerDependencyError("Reward claim service is not configured");
        }
        const body = rewardSettingsRequestSchema.parse(await readJsonBody(request));
        const status = await dependencies.rewards.configure(body);
        sendJson(response, 201, success(status, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/rewards/status") {
        if (!dependencies.rewards) {
          throw new ServerDependencyError("Reward claim service is not configured");
        }
        const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));

        if (!walletAddress) {
          sendJson(response, 400, failure("validation_failed", "walletAddress is required"));
          return;
        }

        const status = await dependencies.rewards.getStatus(walletAddress);
        sendJson(response, 200, success(status, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/rewards/fixtures") {
        if (!dependencies.rewards) {
          throw new ServerDependencyError("Reward claim service is not configured");
        }
        const body = rewardFixtureRequestSchema.parse(await readJsonBody(request));
        const fixture = await dependencies.rewards.addDemoFixture(body);
        sendJson(response, 201, success(fixture, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/rewards/run") {
        if (!dependencies.rewards) {
          throw new ServerDependencyError("Reward claim service is not configured");
        }
        const body = rewardRunRequestSchema.parse(await readJsonBody(request));
        const result = await dependencies.rewards.run(body);
        sendJson(response, 200, success(result, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/rewards/policy-check") {
        if (!dependencies.rewards) {
          throw new ServerDependencyError("Reward claim service is not configured");
        }
        const body = rewardPolicyCheckRequestSchema.parse(await readJsonBody(request));
        const decision = await dependencies.rewards.evaluatePolicy(body);
        sendJson(response, 200, success(decision, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/telegram/health") {
        if (!dependencies.telegramAlerts) {
          throw new ServerDependencyError("Telegram alert service is not configured");
        }
        sendJson(response, 200, success(await dependencies.telegramAlerts.health(), requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/telegram/bindings") {
        if (!dependencies.telegramAlerts) {
          throw new ServerDependencyError("Telegram alert service is not configured");
        }
        const body = telegramBindingRequestSchema.parse(await readJsonBody(request));
        const binding = await dependencies.telegramAlerts.linkChat(body);
        sendJson(response, 201, success(binding, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/telegram/callback") {
        if (!dependencies.telegramAlerts) {
          throw new ServerDependencyError("Telegram alert service is not configured");
        }
        const body = telegramCallbackRequestSchema.parse(await readJsonBody(request));
        const result = await dependencies.telegramAlerts.processCallback(body);
        sendJson(response, result.ok ? 200 : 400, success(result, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/telegram/test-alert") {
        if (!dependencies.telegramAlerts || !dependencies.riskSnapshots) {
          throw new ServerDependencyError("Telegram alert dependencies are not configured");
        }
        const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));
        const riskSnapshot = walletAddress
          ? await dependencies.riskSnapshots.latestForWallet(walletAddress)
          : await dependencies.riskSnapshots.latest();

        if (!riskSnapshot) {
          sendJson(response, 404, failure("not_found", "No risk snapshot is available"));
          return;
        }

        const alert = await dependencies.telegramAlerts.sendRiskAlert(riskSnapshot);
        sendJson(response, 200, success(alert ?? null, requestId));
        return;
      }

      sendJson(response, 404, failure("not_found", "Route not found"));
    } catch (error) {
      if (error instanceof ZodError) {
        sendJson(
          response,
          400,
          failure("validation_failed", "Request validation failed", error.flatten())
        );
        return;
      }

      if (error instanceof SyntaxError) {
        sendJson(response, 400, failure("invalid_json", "Request body must be valid JSON"));
        return;
      }

      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, failure("payload_too_large", "Request body is too large"));
        return;
      }

      if (error instanceof AddressValidationError) {
        sendJson(response, 400, failure("validation_failed", "Request validation failed"));
        return;
      }

      if (error instanceof ServerDependencyError) {
        sendJson(response, 500, failure("server_misconfigured", error.message));
        return;
      }

      if (error instanceof TelegramAlertServiceError) {
        sendJson(response, error.statusCode, failure(error.code, error.message));
        return;
      }

      if (error instanceof HeartbeatServiceError) {
        sendJson(response, error.statusCode, failure(error.code, error.message));
        return;
      }

      if (error instanceof RewardClaimServiceError) {
        sendJson(response, error.statusCode, failure(error.code, error.message));
        return;
      }

      sendJson(response, 500, failure("internal_error", "Request failed"));
    }
  });
}
