import { describe, expect, it, vi } from "vitest";

import {
  SomniaAgentKitClient,
  SomniaExecutionDisabledError,
  SomniaIntegrationUnavailableError,
  createSomniaAgentKitClient
} from "./somnia-agent-kit.client.js";
import { createTestConfig } from "../../test-helpers/env.js";

const config = createTestConfig();

const allowedPolicy = () => ({
  allowed: true,
  reason: "demo policy passed",
  policyId: "test.policy",
  createdAt: new Date().toISOString(),
  toolName: "claimReward",
  signerAddress: config.somnia.agentWalletAddress,
  chainId: config.somnia.chainId,
  target: config.somnia.deadManSwitchContractAddress,
  calldataSummary: "claimReward()"
});

describe("Somnia Agent Kit integration boundary", () => {
  it("blocks state-changing calls without an allowed policy decision", async () => {
    const client = createSomniaAgentKitClient(config, {
      callTool: vi.fn(),
      health: vi.fn()
    });

    await expect(
      client.callTool({
        toolName: "claimReward",
        stateChanging: true,
        target: config.somnia.deadManSwitchContractAddress,
        calldataSummary: "claimReward()"
      })
    ).rejects.toBeInstanceOf(SomniaExecutionDisabledError);
  });

  it("allows state-changing calls with an allowed policy decision", async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    const client = createSomniaAgentKitClient(config, {
      callTool,
      health: vi.fn().mockResolvedValue({ ok: true })
    });

    const result = await client.callTool({
      toolName: "claimReward",
      stateChanging: true,
      target: config.somnia.deadManSwitchContractAddress,
      calldataSummary: "claimReward()",
      policyDecision: allowedPolicy()
    });

    expect(callTool).toHaveBeenCalledOnce();
    expect(result.submitted).toBe(true);
    expect(result.policyDecision).toMatchObject({ allowed: true });
  });

  it("blocks state-changing tools misclassified as read-only", async () => {
    const client = createSomniaAgentKitClient(config, {
      callTool: vi.fn(),
      health: vi.fn()
    });

    await expect(
      client.callTool({
        toolName: "claimReward",
        stateChanging: false
      })
    ).rejects.toBeInstanceOf(SomniaExecutionDisabledError);
  });

  it("fails tool calls when no adapter is configured", async () => {
    const client = new SomniaAgentKitClient(config);

    await expect(
      client.callTool({
        toolName: "getBalance",
        stateChanging: false
      })
    ).rejects.toBeInstanceOf(SomniaIntegrationUnavailableError);
  });

  it("exposes disabled subsystem health when adapter setup fails", async () => {
    const client = createSomniaAgentKitClient(config, {
      callTool: vi.fn(),
      health: vi.fn().mockRejectedValue(new Error("RPC unavailable"))
    });

    await expect(client.health()).resolves.toMatchObject({
      subsystem: "somnia-agent-kit",
      ok: false,
      executionEnabled: false
    });
  });

  it("reports disabled subsystem health when no adapter is configured", async () => {
    const client = new SomniaAgentKitClient(config);

    await expect(client.health()).resolves.toMatchObject({
      subsystem: "somnia-agent-kit",
      ok: false,
      executionEnabled: false
    });
  });
});
