import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

import { getAddress } from "ethers";
import { ZodError } from "zod";

import { failure, sendJson, success } from "./response.js";
import type { SetupService } from "../services/setup.service.js";
import { setupWalletRequestSchema } from "../services/setup.service.js";
import type { PortfolioSnapshotsRepository } from "../persistence/portfolio-snapshots.repository.js";
import type { RiskSnapshotsRepository } from "../persistence/risk-snapshots.repository.js";

const defaultMaxBodyBytes = 1_048_576;

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
  portfolioSnapshots?: PortfolioSnapshotsRepository;
  riskSnapshots?: RiskSnapshotsRepository;
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
        const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));
        const data = walletAddress
          ? await dependencies.portfolioSnapshots?.latestForWallet(walletAddress)
          : (await dependencies.portfolioSnapshots?.list())?.at(-1);
        sendJson(response, 200, success(data ?? null, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/risk-snapshots/latest") {
        const walletAddress = parseOptionalWalletAddress(url.searchParams.get("walletAddress"));
        const data = walletAddress
          ? await dependencies.riskSnapshots?.latestForWallet(walletAddress)
          : (await dependencies.riskSnapshots?.list())?.at(-1);
        sendJson(response, 200, success(data ?? null, requestId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        const health = dependencies.health
          ? await dependencies.health()
          : { ok: true };
        sendJson(response, 200, success(health, requestId));
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

      sendJson(response, 500, failure("internal_error", "Request failed"));
    }
  });
}
