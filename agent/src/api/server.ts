import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import { ZodError } from "zod";

import {
  AddressValidationError,
  PayloadTooLargeError,
  ServerDependencyError,
  applyCorsHeaders,
  compactAuditMetadata,
  createWeakEtag,
  isSimulationAuditEvent,
  parseOptionalLimit,
  parseOptionalWalletAddress,
  readJsonBody,
  redactSecretSafe
} from "./http-support.js";
import { sessionKeyActionRequestSchema } from "./request-schemas.js";
import { failure, sendJson, success } from "./response.js";
import { handleRiskGuardRoutes } from "./routes/riskguard.routes.js";
import { handleTelegramRoutes } from "./routes/telegram.routes.js";
import type { AgentApiDependencies } from "./dependencies.js";
import {
  setupWalletRequestSchema,
  userProfileUpdateRequestSchema
} from "../services/setup.service.js";
import { demoScenarioRequestSchema } from "../services/demo-scenario.service.js";
import {
  TelegramAlertServiceError
} from "../services/telegram-alert.service.js";
import { TelegramConnectService } from "../services/telegram-connect.service.js";
import {
  deadmanPolicyRequestSchema,
  heartbeatCheckInRequestSchema,
  HeartbeatServiceError,
  heartbeatSettingsRequestSchema
} from "../services/heartbeat.service.js";
import {
  rewardFixtureRequestSchema,
  RewardClaimServiceError,
  rewardPolicyCheckRequestSchema,
  rewardRunSignedRequestSchema,
  rewardSettingsSignedRequestSchema
} from "../services/reward-claim.service.js";
import { InheritanceRegistryClient } from "../integrations/somnia/inheritance-registry.client.js";
import {
  approvalAnalyzePrepareRequestSchema,
  approvalListRequestSchema,
  approvalScanPrepareRequestSchema,
  ApprovalScannerServiceError
} from "../services/approval-scanner/service.js";

export function createAgentApiServer(dependencies: AgentApiDependencies): Server {
  const telegramConnect = dependencies.telegramConnect
    ?? (dependencies.telegramAlerts
      ? new TelegramConnectService(dependencies.telegramAlerts)
      : undefined);

  return createServer(async (request, response) => {
    applyCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

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

      if (request.method === "GET" && url.pathname === "/api/users/profile") {
        const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));

        if (!walletAddress) {
          sendJson(response, 400, failure("validation_failed", "walletAddress is required"));
          return;
        }

        sendJson(response, 200, success(await dependencies.setupService.getUserProfile(walletAddress) ?? null, requestId));
        return;
      }

      if (request.method === "PATCH" && url.pathname === "/api/users/profile") {
        const body = userProfileUpdateRequestSchema.parse(await readJsonBody(request));
        const user = await dependencies.setupService.updateUserProfile(body);
        sendJson(response, 200, success(user, requestId));
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
        const summary = url.searchParams.get("summary") === "1";
        const excludeSimulation = url.searchParams.get("excludeSimulation") === "1";
        const data = (await dependencies.auditEvents.list())
          .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
          .filter((event) => !excludeSimulation || !isSimulationAuditEvent(event))
          .slice(0, limit)
          .map((event) => {
            const redacted = redactSecretSafe(event) as typeof event;
            return summary
              ? {
                  auditEventId: redacted.auditEventId,
                  createdAt: redacted.createdAt,
                  eventType: redacted.eventType,
                  status: redacted.status,
                  metadata: compactAuditMetadata(redacted.metadata)
                }
              : redacted;
          });
        const payload = success({ events: data }, requestId);
        const etag = createWeakEtag(payload.data);
        response.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=45");
        response.setHeader("ETag", etag);

        if (request.headers["if-none-match"] === etag) {
          response.writeHead(304);
          response.end();
          return;
        }

        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        const health = dependencies.health
          ? await dependencies.health()
          : { ok: true };
        sendJson(response, 200, success(health, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/public-chain") {
        if (!dependencies.publicChain) {
          throw new ServerDependencyError("Public chain metadata is not configured");
        }
        sendJson(response, 200, success(dependencies.publicChain, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/approvals/chains") {
        if (!dependencies.approvalScanner) {
          throw new ServerDependencyError("Approval scanner service is not configured");
        }
        sendJson(
          response,
          200,
          success(dependencies.approvalScanner.getSupportedChains(), requestId)
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/approvals/list") {
        if (!dependencies.approvalScanner) {
          throw new ServerDependencyError("Approval scanner service is not configured");
        }
        const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));
        const chainIds = (url.searchParams.get("chainIds") ?? "")
          .split(",")
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isInteger(value) && value > 0);
        const parsed = approvalListRequestSchema.parse({ walletAddress, chainIds });
        const approvals = await dependencies.approvalScanner.discoverApprovalsWithMetadata(
          parsed.walletAddress,
          parsed.chainIds
        );
        sendJson(response, 200, success(approvals, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/approvals/scan/prepare") {
        if (!dependencies.approvalScanner) {
          throw new ServerDependencyError("Approval scanner service is not configured");
        }
        const body = approvalScanPrepareRequestSchema.parse(await readJsonBody(request));
        const prepared = await dependencies.approvalScanner.prepareScan(body.approvals);
        sendJson(response, 200, success(prepared, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/approvals/analyze/prepare") {
        if (!dependencies.approvalScanner) {
          throw new ServerDependencyError("Approval scanner service is not configured");
        }
        const body = approvalAnalyzePrepareRequestSchema.parse(await readJsonBody(request));
        const prepared = await dependencies.approvalScanner.prepareDiscoveredScan(
          body.walletAddress,
          body.chainIds,
          body.mode ? { mode: body.mode } : {}
        );
        sendJson(response, 200, success(prepared, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/approvals/scan/status") {
        if (!dependencies.approvalScanner) {
          throw new ServerDependencyError("Approval scanner service is not configured");
        }
        const scanId = Number(url.searchParams.get("scanId"));
        if (!Number.isInteger(scanId) || scanId < 1) {
          sendJson(response, 400, failure("validation_failed", "scanId must be a positive integer"));
          return;
        }
        const status = await dependencies.approvalScanner.getScanStatus(scanId);
        sendJson(response, 200, success(status, requestId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/session-keys/action") {
        if (!dependencies.publicChain) {
          throw new ServerDependencyError("Public chain metadata is not configured");
        }

        const body = sessionKeyActionRequestSchema.parse(await readJsonBody(request));

        sendJson(response, 200, success(await dependencies.setupService.ensureSessionKeyAction({
          walletAddress: body.walletAddress,
          ...(body.smartAccountAddress ? { smartAccountAddress: body.smartAccountAddress } : {}),
          action: body.action
        }), requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/inheritance/plan") {
        if (!dependencies.publicChain) {
          throw new ServerDependencyError("Public chain metadata is not configured");
        }
        const smartAccount = parseOptionalWalletAddress(url.searchParams.get("smartAccount"));

        if (!smartAccount) {
          sendJson(response, 400, failure("validation_failed", "smartAccount is required"));
          return;
        }

        const client = new InheritanceRegistryClient(dependencies.publicChain);
        sendJson(response, 200, success(await client.getPlan(smartAccount), requestId));
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
        const { message: _message, signature: _signature, ...body } =
          rewardSettingsSignedRequestSchema.parse(await readJsonBody(request));
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
        const { message: _message, signature: _signature, ...body } =
          rewardRunSignedRequestSchema.parse(await readJsonBody(request));
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

      const routeContext = { dependencies, telegramConnect, request, response, url, requestId };

      if (await handleTelegramRoutes(routeContext)) {
        return;
      }

      if (await handleRiskGuardRoutes(routeContext)) {
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

      if (error instanceof ApprovalScannerServiceError) {
        const statusCode = error.code === "scan_not_found" ? 404 : 400;
        sendJson(response, statusCode, failure(error.code, error.message));
        return;
      }

      sendJson(response, 500, failure("internal_error", "Request failed"));
    }
  });
}
