import { JsonRpcProvider, Wallet } from "ethers";

import type { AgentConfig } from "../../config/env.js";
import { policyDecisionSchema, type PolicyDecision } from "../../policies/execution-policy.js";

const readOnlyToolNames = new Set(["health", "getBalance", "getPortfolio", "readContract"]);

export interface SomniaToolCall {
  toolName: string;
  args?: Record<string, unknown>;
  stateChanging: boolean;
  policyDecision?: PolicyDecision;
  target?: string;
  calldataSummary?: string;
}

export interface SomniaToolResult {
  toolName: string;
  submitted: boolean;
  policyDecision?: PolicyDecision;
  result?: unknown;
}

export interface SomniaAgentKitAdapter {
  callTool: (request: SomniaToolCall) => Promise<unknown>;
  health: () => Promise<unknown>;
}

export class SomniaExecutionDisabledError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SomniaExecutionDisabledError";
  }
}

export class SomniaIntegrationUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SomniaIntegrationUnavailableError";
  }
}

export class SomniaAgentKitClient {
  public readonly provider: JsonRpcProvider;
  public readonly signer: Wallet;

  public constructor(
    private readonly config: AgentConfig,
    private readonly adapter?: SomniaAgentKitAdapter
  ) {
    this.provider = new JsonRpcProvider(config.somnia.rpcUrl, config.somnia.chainId);
    this.signer = new Wallet(config.somnia.agentPrivateKey, this.provider);
  }

  public async health() {
    try {
      if (!this.adapter) {
        throw new SomniaIntegrationUnavailableError(
          "Somnia Agent Kit adapter is not configured"
        );
      }

      await this.provider.getNetwork();
      await this.adapter.health();
      return {
        subsystem: "somnia-agent-kit",
        ok: true,
        executionEnabled: true,
        chainId: this.config.somnia.chainId,
        agentWalletAddress: this.config.somnia.agentWalletAddress
      };
    } catch (error) {
      return {
        subsystem: "somnia-agent-kit",
        ok: false,
        executionEnabled: false,
        error: error instanceof Error ? error.message : "Somnia health check failed"
      };
    }
  }

  public async callTool(request: SomniaToolCall): Promise<SomniaToolResult> {
    if (!this.adapter) {
      throw new SomniaIntegrationUnavailableError(
        "Somnia Agent Kit adapter is not configured"
      );
    }

    if (!request.stateChanging && !readOnlyToolNames.has(request.toolName)) {
      throw new SomniaExecutionDisabledError(
        "Somnia tool calls must be explicitly read-only or policy-gated"
      );
    }

    if (request.stateChanging) {
      const policy = policyDecisionSchema.safeParse(request.policyDecision);

      if (!policy.success || !policy.data.allowed) {
        throw new SomniaExecutionDisabledError(
          "State-changing Somnia calls require an allowed policy decision"
        );
      }

      if (
        policy.data.toolName !== request.toolName ||
        policy.data.signerAddress !== this.config.somnia.agentWalletAddress ||
        policy.data.chainId !== this.config.somnia.chainId ||
        policy.data.target !== request.target ||
        policy.data.calldataSummary !== request.calldataSummary ||
        (policy.data.expiresAt && Date.parse(policy.data.expiresAt) <= Date.now())
      ) {
        throw new SomniaExecutionDisabledError(
          "Policy decision does not match the requested Somnia call"
        );
      }
    }

    const result = await this.adapter.callTool(request);

    return {
      toolName: request.toolName,
      submitted: Boolean(request.stateChanging),
      ...(request.policyDecision ? { policyDecision: request.policyDecision } : {}),
      result
    };
  }
}

export function createSomniaAgentKitClient(
  config: AgentConfig,
  adapter?: SomniaAgentKitAdapter
): SomniaAgentKitClient {
  return new SomniaAgentKitClient(config, adapter);
}
