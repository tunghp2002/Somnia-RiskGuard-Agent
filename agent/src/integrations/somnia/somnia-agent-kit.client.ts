import { JsonRpcProvider, Wallet } from "ethers";
import {
  formatEther,
  SomniaAgentKit,
  type AgentKitConfig
} from "somnia-agent-kit";

import type { AgentConfig } from "../../config/env.js";
import { policyDecisionSchema, type PolicyDecision } from "../../policies/execution-policy.js";

const readOnlyToolNames = new Set(["health", "getBalance", "getPortfolio", "readContract"]);
const defaultSomniaAgentKitContracts = {
  agentRegistry: "0xC9f3452090EEB519467DEa4a390976D38C008347",
  agentManager: "0x77F6dC5924652e32DBa0B4329De0a44a2C95691E",
  agentExecutor: "0x157C56dEdbAB6caD541109daabA4663Fc016026e",
  agentVault: "0x7cEe3142A9c6d15529C322035041af697B2B5129"
} as const;

export interface SomniaToolCall {
  toolName: string;
  args?: Record<string, unknown>;
  stateChanging: boolean;
  policyDecision?: PolicyDecision;
  target?: string;
  calldata?: string;
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

export class SomniaAgentKitSdkAdapter implements SomniaAgentKitAdapter {
  private kit: SomniaAgentKit | undefined;
  private initializePromise: Promise<SomniaAgentKit> | undefined;

  public constructor(private readonly config: AgentConfig) {}

  public async health() {
    const kit = await this.getKit();
    const signer = kit.getSigner();
    const signerAddress = signer ? await signer.getAddress() : undefined;

    return {
      provider: "somnia-agent-kit",
      initialized: kit.isInitialized(),
      network: kit.getNetworkInfo(),
      signerAddress,
      agentContracts: defaultSomniaAgentKitContracts
    };
  }

  public async callTool(request: SomniaToolCall): Promise<unknown> {
    const kit = await this.getKit();

    switch (request.toolName) {
      case "health":
        return this.health();
      case "getBalance":
        return this.getBalance(kit, request.args);
      case "getPortfolio":
        return this.getPortfolio(kit, request.args);
      case "readContract":
        return this.readContract(kit, request.args);
      default:
        return this.executePolicyGatedTransaction(kit, request);
    }
  }

  private async getKit(): Promise<SomniaAgentKit> {
    if (this.kit?.isInitialized()) {
      return this.kit;
    }

    this.initializePromise ??= (async () => {
      const kit = new SomniaAgentKit(this.createSdkConfig());
      await kit.initialize();
      this.kit = kit;
      return kit;
    })().catch((error) => {
      this.initializePromise = undefined;
      throw error;
    });

    return this.initializePromise;
  }

  private createSdkConfig(): Partial<AgentKitConfig> {
    return {
      network: {
        rpcUrl: this.config.somnia.rpcUrl,
        chainId: this.config.somnia.chainId,
        name: this.config.publicChain.name,
        explorer: this.config.publicChain.blockExplorerUrl,
        token: this.config.publicChain.nativeCurrency.symbol
      },
      contracts: defaultSomniaAgentKitContracts,
      privateKey: this.config.somnia.agentPrivateKey,
      logLevel: toSomniaAgentKitLogLevel(this.config.logLevel),
      metricsEnabled: true,
      telemetryEnabled: false
    };
  }

  private async getBalance(
    kit: SomniaAgentKit,
    args: Record<string, unknown> | undefined
  ) {
    const address = parseAddressArg(args, "address")
      ?? parseAddressArg(args, "walletAddress")
      ?? this.config.somnia.agentWalletAddress;
    const balanceWei = await kit.getNativeTokenManager().getBalance(address);

    return {
      address,
      balanceWei: balanceWei.toString(),
      balance: formatEther(balanceWei),
      symbol: this.config.publicChain.nativeCurrency.symbol
    };
  }

  private async getPortfolio(
    kit: SomniaAgentKit,
    args: Record<string, unknown> | undefined
  ) {
    const balance = await this.getBalance(kit, args);

    return {
      totalValueUsd: "0",
      assets: [
        {
          symbol: balance.symbol,
          balance: balance.balance,
          valueUsd: "0"
        }
      ],
      rewards: [],
      riskSignals: []
    };
  }

  private async readContract(
    kit: SomniaAgentKit,
    args: Record<string, unknown> | undefined
  ) {
    const target = parseAddressArg(args, "target");
    const abi = args?.abi;
    const functionName = args?.functionName;
    const functionArgs = args?.args;

    if (!target || !Array.isArray(abi) || typeof functionName !== "string") {
      throw new SomniaIntegrationUnavailableError(
        "readContract requires target, abi, and functionName arguments"
      );
    }

    const contract = kit.getChainClient().getReadOnlyContract(target, abi);
    const method = contract.getFunction(functionName);
    return method(...(Array.isArray(functionArgs) ? functionArgs : []));
  }

  private async executePolicyGatedTransaction(
    kit: SomniaAgentKit,
    request: SomniaToolCall
  ) {
    if (!request.target || !request.calldata) {
      throw new SomniaExecutionDisabledError(
        "State-changing Somnia Agent Kit calls require target and calldata"
      );
    }

    const receipt = await kit.getChainClient().sendTransaction({
      to: request.target,
      data: request.calldata
    });

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      status: receipt.status
    };
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

      const adapter = await withTimeout(
        this.adapter.health(),
        5_000,
        "Somnia Agent Kit health check timed out"
      );
      return {
        subsystem: "somnia-agent-kit",
        ok: true,
        executionEnabled: true,
        chainId: this.config.somnia.chainId,
        agentWalletAddress: this.config.somnia.agentWalletAddress,
        adapter
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
  return new SomniaAgentKitClient(
    config,
    adapter ?? new SomniaAgentKitSdkAdapter(config)
  );
}

function parseAddressArg(
  args: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = args?.[key];
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? value
    : undefined;
}

function toSomniaAgentKitLogLevel(
  level: AgentConfig["logLevel"]
): "debug" | "info" | "warn" | "error" {
  if (level === "trace") {
    return "debug";
  }

  if (level === "fatal") {
    return "error";
  }

  return level;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
