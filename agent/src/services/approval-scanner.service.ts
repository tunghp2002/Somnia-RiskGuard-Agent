import {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  id as keccakId,
  zeroPadValue
} from "ethers";
import { z } from "zod";

import type { AgentConfig } from "../config/env.js";
import { loadScanChains, type ScanChain } from "../config/public-chain.js";

const APPROVAL_EVENT_TOPIC = keccakId("Approval(address,address,uint256)");
const APPROVAL_FOR_ALL_TOPIC = keccakId("ApprovalForAll(address,address,bool)");
const UNLIMITED_THRESHOLD = (1n << 255n); // anything at/above this is treated as "unlimited"
const DEFAULT_BLOCKSCOUT_PRO_API_BASE_URL = "https://api.blockscout.com/v2/api";

interface ExplorerLog {
  address: string;
  topics: string[];
  data: string;
}

const erc20Interface = new Interface([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)"
]);

const scannerInterface = new Interface([
  "function quoteScan(uint256 itemCount) view returns (uint256)",
  "function requestScan(tuple(uint256 chainId, address spender, address token, string context, string explorerApiUrl, string explorerApiSelector, string explorerPageUrl)[] items) payable returns (uint256 scanId)",
  "function getScan(uint256 scanId) view returns (tuple(address requester, uint256 escrow, uint256 agentDeposit, uint256 itemCount, uint256 completedCount, bool exists))",
  "function getItem(uint256 scanId, uint256 itemIndex) view returns (tuple(uint256 chainId, address spender, address token, string context, bool jsonReturned, bool webReturned, bool inferenceFired, uint8 status, string jsonFacts, string webFindings, uint8 riskScore, string verdict))",
  "function getScanResult(uint256 scanId) view returns (tuple(address requester, uint256 escrow, uint256 agentDeposit, uint256 itemCount, uint256 completedCount, bool exists) scan, tuple(uint256 chainId, address spender, address token, string context, bool jsonReturned, bool webReturned, bool inferenceFired, uint8 status, string jsonFacts, string webFindings, uint8 riskScore, string verdict)[] items)",
  "function isScanComplete(uint256 scanId) view returns (bool)",
  "event ScanRequested(uint256 indexed scanId, address indexed requester, uint256 itemCount, uint256 escrow)"
]);

export const approvalListRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainIds: z.array(z.number().int().positive()).min(1)
});

export const approvalScanPrepareRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  approvals: z
    .array(
      z.object({
        chainId: z.number().int().positive(),
        token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        name: z.string().optional(),
        symbol: z.string().optional(),
        standard: z.enum(["erc20", "erc721", "erc1155"]).optional(),
        allowance: z.string().optional(),
        isUnlimited: z.boolean().optional()
      })
    )
    .min(1)
    .max(20)
});

export const approvalAnalyzePrepareRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainIds: z.array(z.number().int().positive()).min(1)
});

export interface ApprovalEntry {
  chainId: number;
  chainName: string;
  token: string;
  symbol: string;
  name: string;
  standard: "erc20" | "erc721" | "erc1155";
  spender: string;
  allowance: string;
  isUnlimited: boolean;
  explorerSpenderUrl: string;
}

export interface ScanChainSummary {
  id: string;
  name: string;
  chainId: number;
  blockExplorerUrl: string;
  nativeCurrencySymbol: string;
  priority: number;
}

export interface ScanItemStatus {
  itemIndex: number;
  chainId: number;
  spender: string;
  token: string;
  context: string;
  status: "pending" | "inferring" | "complete";
  riskScore: number;
  verdict: string;
  jsonFacts: string;
  webFindings: string;
}

export interface ScanStatus {
  scanId: number;
  requester: string;
  itemCount: number;
  completedCount: number;
  complete: boolean;
  items: ScanItemStatus[];
}

interface ScanTuple {
  requester: string;
  escrow: bigint;
  agentDeposit: bigint;
  itemCount: bigint;
  completedCount: bigint;
  exists: boolean;
}

interface ItemTuple {
  chainId: bigint;
  spender: string;
  token: string;
  context: string;
  jsonReturned: boolean;
  webReturned: boolean;
  inferenceFired: boolean;
  status: bigint;
  jsonFacts: string;
  webFindings: string;
  riskScore: bigint;
  verdict: string;
}

export class ApprovalScannerServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApprovalScannerServiceError";
  }
}

export class ApprovalScannerService {
  private readonly chainsByChainId: Map<number, ScanChain>;

  public constructor(
    private readonly config: AgentConfig,
    chains: ScanChain[] = loadScanChains()
  ) {
    this.chainsByChainId = new Map(chains.map((chain) => [chain.chainId, chain]));
  }

  public getSupportedChains(): ScanChainSummary[] {
    return [...this.chainsByChainId.values()]
      .sort((a, b) => a.priority - b.priority)
      .map((chain) => ({
        id: chain.id,
        name: chain.name,
        chainId: chain.chainId,
        blockExplorerUrl: chain.blockExplorerUrl,
        nativeCurrencySymbol: chain.nativeCurrency.symbol,
        priority: chain.priority
      }));
  }

  public async discoverApprovals(
    walletAddress: string,
    chainIds: number[]
  ): Promise<ApprovalEntry[]> {
    const owner = getAddress(walletAddress);
    const results: ApprovalEntry[] = [];
    const failures: string[] = [];

    for (const chainId of chainIds) {
      const chain = this.chainsByChainId.get(chainId);
      if (!chain) {
        continue;
      }
      try {
        const chainApprovals = await this.discoverChainApprovals(owner, chain);
        results.push(...chainApprovals);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown scanner error";
        failures.push(`${chain.name}: ${reason}`);
      }
    }

    if (results.length === 0 && failures.length > 0) {
      throw new ApprovalScannerServiceError(
        "approval_discovery_failed",
        `Could not scan approvals. ${failures.join("; ")}`
      );
    }

    return results;
  }

  private async discoverChainApprovals(
    owner: string,
    chain: ScanChain
  ): Promise<ApprovalEntry[]> {
    const provider = new JsonRpcProvider(chain.rpcUrl, chain.chainId);
    // Raw RPC eth_getLogs on Somnia caps at a 1000-block range, so historical
    // discovery uses the chain's Blockscout indexer (full-range, topic-filtered).
    const ownerTopic = zeroPadValue(owner, 32).toLowerCase();

    const [approvalLogs, operatorLogs] = await Promise.all([
      this.fetchIndexedLogs(chain, APPROVAL_EVENT_TOPIC, ownerTopic),
      this.fetchIndexedLogs(chain, APPROVAL_FOR_ALL_TOPIC, ownerTopic)
    ]);

    // ERC-20 Approval has 3 topics (sig, owner, spender); ERC-721 Approval has 4
    // (sig, owner, approved, tokenId) and shares the same signature hash — so split
    // by topic count. Single-NFT approvals are covered by ApprovalForAll instead.
    const erc20Pairs = new Map<string, { token: string; spender: string }>();
    const operatorPairs = new Map<string, { token: string; operator: string }>();

    for (const log of approvalLogs) {
      const spenderTopic = log.topics[2];
      if (log.topics.length !== 3 || !spenderTopic) {
        continue;
      }
      const spender = getAddress(`0x${spenderTopic.slice(26)}`);
      const token = getAddress(log.address);
      erc20Pairs.set(`${token}:${spender}`, { token, spender });
    }
    for (const log of operatorLogs) {
      const operatorTopic = log.topics[2];
      if (!operatorTopic) {
        continue;
      }
      const operator = getAddress(`0x${operatorTopic.slice(26)}`);
      const token = getAddress(log.address);
      operatorPairs.set(`${token}:${operator}`, { token, operator });
    }

    // Verify every candidate pair concurrently (live allowance / isApprovedForAll reads).
    const erc20Entries = await Promise.all(
      [...erc20Pairs.values()].map(({ token, spender }) =>
        this.resolveErc20Approval(provider, chain, owner, token, spender)
      )
    );
    const nftEntries = await Promise.all(
      [...operatorPairs.values()].map(({ token, operator }) =>
        this.resolveOperatorApproval(provider, chain, owner, token, operator)
      )
    );

    return [...erc20Entries, ...nftEntries].filter(
      (entry): entry is ApprovalEntry => entry !== null
    );
  }

  private async resolveErc20Approval(
    provider: JsonRpcProvider,
    chain: ScanChain,
    owner: string,
    token: string,
    spender: string
  ): Promise<ApprovalEntry | null> {
    const contract = new Contract(token, erc20Interface, provider);
    try {
      const allowance = (await contract.getFunction("allowance")(owner, spender)) as bigint;
      if (allowance === 0n) {
        return null; // already revoked
      }
      const meta = await this.readErc20Meta(contract);
      return {
        chainId: chain.chainId,
        chainName: chain.name,
        token,
        symbol: meta.symbol,
        name: meta.name,
        standard: "erc20",
        spender,
        allowance: allowance.toString(),
        isUnlimited: allowance >= UNLIMITED_THRESHOLD,
        explorerSpenderUrl: chain.explorerPageUrlTemplate.replace("{spender}", spender)
      };
    } catch {
      return null; // not a standard ERC20 allowance or read failed
    }
  }

  private async resolveOperatorApproval(
    provider: JsonRpcProvider,
    chain: ScanChain,
    owner: string,
    token: string,
    operator: string
  ): Promise<ApprovalEntry | null> {
    const contract = new Contract(token, erc20Interface, provider);
    try {
      const approved = (await contract.getFunction("isApprovedForAll")(owner, operator)) as boolean;
      if (!approved) {
        return null;
      }
      const meta = await this.readErc20Meta(contract);
      return {
        chainId: chain.chainId,
        chainName: chain.name,
        token,
        symbol: meta.symbol,
        name: meta.name,
        standard: "erc721",
        spender: operator,
        allowance: "all",
        isUnlimited: true,
        explorerSpenderUrl: chain.explorerPageUrlTemplate.replace("{spender}", operator)
      };
    } catch {
      return null;
    }
  }

  private async readErc20Meta(contract: Contract): Promise<{ symbol: string; name: string }> {
    let symbol = "TOKEN";
    let name = "";
    try {
      symbol = (await contract.getFunction("symbol")()) as string;
    } catch {
      // optional
    }
    try {
      name = (await contract.getFunction("name")()) as string;
    } catch {
      // optional
    }
    return { symbol, name };
  }

  private async fetchIndexedLogs(
    chain: ScanChain,
    topic0: string,
    topic1: string
  ): Promise<ExplorerLog[]> {
    const urls = this.buildExplorerLogUrls(chain, topic0, topic1);
    const failures: string[] = [];

    for (const url of urls) {
      try {
        return await this.fetchExplorerLogUrl(url);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "unknown explorer error");
      }
    }

    throw new Error(`explorer logs unavailable (${failures.join("; ")})`);
  }

  private buildExplorerLogUrls(
    chain: ScanChain,
    topic0: string,
    topic1: string
  ): URL[] {
    const apiKey = this.config.approvalScanner.blockscoutApiKey;
    const urls: URL[] = [];

    if (apiKey?.startsWith("proapi_")) {
      const proUrl = new URL(
        this.config.approvalScanner.blockscoutProApiBaseUrl
          ?? DEFAULT_BLOCKSCOUT_PRO_API_BASE_URL
      );
      proUrl.searchParams.set("chain_id", String(chain.chainId));
      this.appendLogQuery(proUrl, topic0, topic1);
      proUrl.searchParams.set("apikey", apiKey);
      urls.push(proUrl);
    }

    // Blockscout Etherscan-compatible logs endpoint. It is DB-indexed, so it
    // returns the full history without the RPC's 1000-block range limit.
    const url = new URL(chain.explorerApiBaseUrl);
    this.appendLogQuery(url, topic0, topic1);
    if (apiKey && !apiKey.startsWith("proapi_")) {
      url.searchParams.set("apikey", apiKey);
    }
    urls.push(url);

    return urls;
  }

  private appendLogQuery(url: URL, topic0: string, topic1: string): void {
    url.searchParams.set("module", "logs");
    url.searchParams.set("action", "getLogs");
    url.searchParams.set("fromBlock", "0");
    url.searchParams.set("toBlock", "latest");
    url.searchParams.set("topic0", topic0);
    url.searchParams.set("topic1", topic1);
    url.searchParams.set("topic0_1_opr", "and");
  }

  private async fetchExplorerLogUrl(url: URL): Promise<ExplorerLog[]> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      message?: unknown;
      result?: unknown;
      status?: unknown;
    };
    if (!Array.isArray(body.result)) {
      const message = typeof body.message === "string" ? body.message : "invalid response";
      const result = typeof body.result === "string" ? body.result : "";
      if (/no records found/i.test(message) || /no records found/i.test(result)) {
        return [];
      }
      throw new Error(message);
    }
    return body.result
      .map((entry) => entry as { address?: unknown; topics?: unknown })
      .filter(
        (entry): entry is ExplorerLog =>
          typeof entry.address === "string" && Array.isArray(entry.topics)
      )
      .map((entry) => ({
        address: entry.address,
        topics: entry.topics.filter((topic): topic is string => typeof topic === "string"),
        data: ""
      }));
  }

  public async prepareScan(
    approvals: z.infer<typeof approvalScanPrepareRequestSchema>["approvals"]
  ): Promise<{
    scannerAddress: string;
    calldata: string;
    value: string;
    deposit: string;
    items: Array<{
      chainId: number;
      spender: string;
      token: string;
      context: string;
    }>;
  }> {
    const scannerAddress = this.requireScannerAddress();
    const provider = this.somniaProvider();
    const scanner = new Contract(scannerAddress, scannerInterface, provider);

    const items = approvals.map((approval) => this.toScanItem(approval));
    let deposit: bigint;
    try {
      deposit = (await scanner.getFunction("quoteScan")(items.length)) as bigint;
    } catch (error) {
      throw new ApprovalScannerServiceError(
        "scanner_not_ready",
        `Could not quote scan deposit from ${scannerAddress}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }

    const calldata = scannerInterface.encodeFunctionData("requestScan", [
      items.map((item) => [
        item.chainId,
        item.spender,
        item.token,
        item.context,
        item.explorerApiUrl,
        item.explorerApiSelector,
        item.explorerPageUrl
      ])
    ]);

    return {
      scannerAddress,
      calldata,
      value: deposit.toString(),
      deposit: deposit.toString(),
      items: items.map((item) => ({
        chainId: item.chainId,
        spender: item.spender,
        token: item.token,
        context: item.context
      }))
    };
  }

  public async prepareDiscoveredScan(
    walletAddress: string,
    chainIds: number[]
  ): Promise<{
    approvals: ApprovalEntry[];
    scannerAddress?: string;
    calldata?: string;
    value?: string;
    deposit?: string;
    items: Array<{
      chainId: number;
      spender: string;
      token: string;
      context: string;
    }>;
  }> {
    const approvals = await this.discoverApprovals(walletAddress, chainIds);
    const selected = approvals.slice(0, 20);

    if (selected.length === 0) {
      return { approvals, items: [] };
    }

    const prepared = await this.prepareScan(
      selected.map((entry) => ({
        chainId: entry.chainId,
        token: entry.token,
        spender: entry.spender,
        name: entry.name,
        symbol: entry.symbol,
        standard: entry.standard,
        allowance: entry.allowance,
        isUnlimited: entry.isUnlimited
      }))
    );

    return { approvals, ...prepared };
  }

  public async getScanStatus(scanId: number): Promise<ScanStatus> {
    const scannerAddress = this.requireScannerAddress();
    const provider = this.somniaProvider();
    const scanner = new Contract(scannerAddress, scannerInterface, provider);

    let scan: ScanTuple;
    let itemTuples: ItemTuple[];
    try {
      [scan, itemTuples] = (await scanner.getFunction("getScanResult")(scanId)) as unknown as [
        ScanTuple,
        ItemTuple[]
      ];
    } catch (error) {
      throw new ApprovalScannerServiceError(
        "scan_not_found",
        `Scan ${scanId} could not be read: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }

    const itemCount = Number(scan.itemCount);
    const items: ScanItemStatus[] = [];
    for (const [i, item] of itemTuples.entries()) {
      items.push({
        itemIndex: i,
        chainId: Number(item.chainId),
        spender: item.spender,
        token: item.token,
        context: item.context,
        status: this.mapItemStatus(Number(item.status)),
        riskScore: Number(item.riskScore),
        verdict: item.verdict,
        jsonFacts: item.jsonFacts,
        webFindings: item.webFindings
      });
    }

    return {
      scanId,
      requester: scan.requester,
      itemCount,
      completedCount: Number(scan.completedCount),
      complete: itemCount > 0 && Number(scan.completedCount) === itemCount,
      items
    };
  }

  private toScanItem(
    approval: z.infer<typeof approvalScanPrepareRequestSchema>["approvals"][number]
  ): {
    chainId: number;
    spender: string;
    token: string;
    context: string;
    explorerApiUrl: string;
    explorerApiSelector: string;
    explorerPageUrl: string;
  } {
    const chain = this.chainsByChainId.get(approval.chainId);
    if (!chain) {
      throw new ApprovalScannerServiceError(
        "unsupported_chain",
        `Chain ${approval.chainId} is not a supported scan chain`
      );
    }
    const spender = getAddress(approval.spender);
    const token = getAddress(approval.token);
    const allowanceLabel = approval.isUnlimited
      ? "unlimited"
      : approval.allowance ?? "unknown";
    const tokenLabel = `${approval.symbol ?? "TOKEN"}${
      approval.name ? ` / ${approval.name}` : ""
    }`;
    const context = `token=${tokenLabel} (${token}); standard=${
      approval.standard ?? "erc20"
    }; allowance=${allowanceLabel}; chainId=${approval.chainId}; riskTarget=spender contract; tokenReputationDoesNotMakeUnknownSpenderSafe=true`;

    return {
      chainId: approval.chainId,
      spender,
      token,
      context,
      explorerApiUrl: chain.explorerApiUrlTemplate.replace("{spender}", spender),
      explorerApiSelector: chain.explorerApiSelector,
      explorerPageUrl: chain.explorerPageUrlTemplate.replace("{spender}", spender)
    };
  }

  private mapItemStatus(status: number): ScanItemStatus["status"] {
    switch (status) {
      case 3:
        return "complete";
      case 2:
        return "inferring";
      default:
        return "pending";
    }
  }

  private requireScannerAddress(): string {
    const address = this.config.publicChain.contracts.approvalRiskScanner;
    if (!address) {
      throw new ApprovalScannerServiceError(
        "scanner_not_configured",
        "ApprovalRiskScanner is not deployed/configured (set APPROVAL_SCANNER_CONTRACT_ADDRESS)."
      );
    }
    return address;
  }

  private somniaProvider(): JsonRpcProvider {
    return new JsonRpcProvider(this.config.somnia.rpcUrl, this.config.somnia.chainId);
  }
}
