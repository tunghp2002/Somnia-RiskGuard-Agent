import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Wallet } from "ethers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAgentApiServer } from "./server.js";
import { SetupService } from "../services/setup.service.js";
import { UsersRepository } from "../persistence/users.repository.js";
import { createTestConfig } from "../test-helpers/env.js";

let server: ReturnType<typeof createAgentApiServer>;
let baseUrl: string;
let dataDirectory: string;
let wallet: Wallet;
let message: string;
let signature: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "riskguard-api-"));
  wallet = Wallet.createRandom();
  message = `Register Somnia RiskGuard monitored wallet: ${wallet.address}`;
  signature = await wallet.signMessage(message);
  const setupService = new SetupService(
    new UsersRepository(dataDirectory),
    createTestConfig()
  );
  server = createAgentApiServer({
    setupService,
    health: () => ({ ok: true })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  baseUrl = `http://${address.address}:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(dataDirectory, { force: true, recursive: true });
});

describe("agent setup API", () => {
  it("wraps successful responses in data and meta", async () => {
    const response = await fetch(`${baseUrl}/api/setup/readiness`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.agentWallet.ready).toBe(true);
    expect(payload.meta.requestId).toBeDefined();
  });

  it("persists checksum-normalized monitored wallet registrations", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        message,
        signature
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.walletAddress).toBe(
      wallet.address
    );
  });

  it("rejects private-key bearing setup payloads", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        message,
        signature,
        privateKey: "0xsecret"
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_failed");
  });

  it("returns validation errors for invalid checksum wallet input", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: "0x8ba1f109551bD432803012645Ac136ddd64DBA72",
        message,
        signature
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("validation_failed");
  });

  it("rejects oversized request bodies", async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        message: "x".repeat(1_048_577),
        signature
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload.error.code).toBe("payload_too_large");
  });
});
