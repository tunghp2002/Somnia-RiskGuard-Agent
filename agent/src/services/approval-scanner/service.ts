import { Contract, JsonRpcProvider, getAddress, zeroPadValue } from "ethers";
import { z } from "zod";

import type { AgentConfig } from "../../config/env.js";
import { loadScanChains, type ScanChain } from "../../config/public-chain.js";
import { JsonStore, type RepositoryStore } from "../../persistence/json-store.js";
import {
  APPROVAL_CACHE_TTL_MS,
  APPROVAL_EVENT_TOPIC,
  APPROVAL_FOR_ALL_TOPIC,
  DEFAULT_APPROVAL_LOOKBACK_BLOCKS,
  EXPLORER_CHUNK_SIZE_BLOCKS,
  EXPLORER_FETCH_RETRIES,
  EXPLORER_RETRY_BASE_DELAY_MS,
  MAX_ITEMS_PER_SCAN,
  UNLIMITED_THRESHOLD,
  erc20Interface,
  scannerInterface
} from "./constants.js";
import {
  approvalAnalyzePrepareRequestSchema,
  approvalListRequestSchema,
  approvalScanCacheRecordSchema,
  approvalScanPrepareRequestSchema,
  type ApprovalScanCacheRecord
} from "./schemas.js";
import { buildLocalBatchStatus, normalizeScanItems } from "./risk.js";
import type {
  ApprovalDiscoveryResult,
  ApprovalEntry,
  ApprovalScanChainProgress,
  ExplorerLog,
  ItemTuple,
  ScanChainSummary,
  ScanItemStatus,
  ScanStatus,
  ScanTuple
} from "./types.js";

export {
  approvalAnalyzePrepareRequestSchema,
  approvalListRequestSchema,
  approvalScanPrepareRequestSchema
} from "./schemas.js";
export type {
  ApprovalDiscoveryResult,
  ApprovalEntry,
  ApprovalScanChainProgress,
  ScanChainSummary,
  ScanItemStatus,
  ScanStatus
} from "./types.js";

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
  private readonly approvalScanStore: RepositoryStore<ApprovalScanCacheRecord[]>;
  private readonly approvalCache = new Map<
    string,
    { result: ApprovalDiscoveryResult; updatedAt: number }
  >();

  public constructor(
    private readonly config: AgentConfig,
    chains: ScanChain[] = loadScanChains(),
    approvalScanStore?: RepositoryStore<ApprovalScanCacheRecord[]>
  ) {
    this.chainsByChainId = new Map(chains.map((chain) => [chain.chainId, chain]));
    this.approvalScanStore = approvalScanStore ?? new JsonStore({
      filename: "approval-scan-cache.json",
      schema: z.array(approvalScanCacheRecordSchema),
      defaultValue: []
    });
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
    const result = await this.discoverApprovalsWithMetadata(walletAddress, chainIds);
    return result.approvals;
  }

  public async discoverApprovalsWithMetadata(
    walletAddress: string,
    chainIds: number[]
  ): Promise<ApprovalDiscoveryResult> {
    const owner = getAddress(walletAddress);
    const results: ApprovalEntry[] = [];
    const chains: ApprovalScanChainProgress[] = [];
    const failures: string[] = [];

    for (const chainId of chainIds) {
      const chain = this.chainsByChainId.get(chainId);
      if (!chain) {
        continue;
      }
      try {
        const chainResult = await this.discoverChainApprovals(owner, chain);
        results.push(...chainResult.approvals);
        chains.push(chainResult.progress);
      } catch (error) {
        const cached = this.readApprovalCache(owner, chain.chainId);
        if (cached) {
          results.push(...cached.result.approvals);
          chains.push(...cached.result.scanMeta.chains);
          continue;
        }
        const stored = await this.readApprovalScanRecord(owner, chain.chainId);
        if (stored) {
          results.push(...stored.approvals);
          chains.push(this.recordToProgress(stored, true));
          continue;
        }
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

    const result: ApprovalDiscoveryResult = {
      approvals: results,
      scanMeta: {
        partial: chains.some((chain) => chain.partial),
        chains
      }
    };
    this.writeApprovalCache(owner, 0, result);
    return result;
  }

  private approvalCacheKey(owner: string, chainId: number): string {
    return `${chainId}:${owner.toLowerCase()}`;
  }

  private readApprovalCache(owner: string, chainId: number): { result: ApprovalDiscoveryResult } | null {
    const cached = this.approvalCache.get(this.approvalCacheKey(owner, chainId));
    if (!cached || Date.now() - cached.updatedAt > APPROVAL_CACHE_TTL_MS) {
      return null;
    }
    return { result: cached.result };
  }

  private writeApprovalCache(owner: string, chainId: number, result: ApprovalDiscoveryResult): void {
    this.approvalCache.set(this.approvalCacheKey(owner, chainId), {
      result,
      updatedAt: Date.now()
    });
  }

  private scanRecordKey(owner: string, chainId: number): string {
    return `${chainId}:${owner.toLowerCase()}`;
  }

  private async readApprovalScanRecord(
    owner: string,
    chainId: number
  ): Promise<ApprovalScanCacheRecord | null> {
    const key = this.scanRecordKey(owner, chainId);
    const records = await this.approvalScanStore.read();
    return records.find((record) => record.key === key) ?? null;
  }

  private async writeApprovalScanRecord(
    owner: string,
    chain: ScanChain,
    approvals: ApprovalEntry[],
    progress: ApprovalScanChainProgress
  ): Promise<void> {
    const key = this.scanRecordKey(owner, chain.chainId);
    const record = approvalScanCacheRecordSchema.parse({
      key,
      owner,
      chainId: chain.chainId,
      chainName: chain.name,
      approvals,
      scannedFromBlock: progress.scannedFromBlock,
      scannedToBlock: progress.scannedToBlock,
      targetFromBlock: progress.targetFromBlock,
      latestBlock: progress.latestBlock,
      partial: progress.partial,
      ...(progress.lastError ? { lastError: progress.lastError } : {}),
      updatedAt: progress.updatedAt
    });

    await this.approvalScanStore.update((records) => [
      ...records.filter((current) => current.key !== key),
      record
    ]);
  }

  private recordToProgress(
    record: ApprovalScanCacheRecord,
    fromCache: boolean
  ): ApprovalScanChainProgress {
    return {
      chainId: record.chainId,
      chainName: record.chainName,
      latestBlock: record.latestBlock,
      scannedFromBlock: record.scannedFromBlock,
      scannedToBlock: record.scannedToBlock,
      targetFromBlock: record.targetFromBlock,
      partial: record.partial,
      fromCache,
      ...(record.lastError ? { lastError: record.lastError } : {}),
      updatedAt: record.updatedAt
    };
  }

  private async discoverChainApprovals(
    owner: string,
    chain: ScanChain
  ): Promise<{ approvals: ApprovalEntry[]; progress: ApprovalScanChainProgress }> {
    const provider = new JsonRpcProvider(chain.rpcUrl, chain.chainId);
    const result = await this.discoverApprovalsFromLogs(provider, chain, owner);
    this.writeApprovalCache(owner, chain.chainId, {
      approvals: result.approvals,
      scanMeta: {
        partial: result.progress.partial,
        chains: [result.progress]
      }
    });
    return result;
  }

  private async discoverApprovalsFromLogs(
    provider: JsonRpcProvider,
    chain: ScanChain,
    owner: string
  ): Promise<{ approvals: ApprovalEntry[]; progress: ApprovalScanChainProgress }> {
    const latestBlock = await provider.getBlockNumber();
    const targetFromBlock = Math.max(0, latestBlock - this.approvalLookbackBlocks());
    const cached = await this.readApprovalScanRecord(owner, chain.chainId);
    const cacheCoversTarget = cached && cached.scannedFromBlock <= targetFromBlock;
    const needsOnlyNewBlocks = cacheCoversTarget && cached.latestBlock >= latestBlock;
    if (cached && needsOnlyNewBlocks) {
      return {
        approvals: cached.approvals,
        progress: this.recordToProgress(cached, true)
      };
    }

    const erc20Pairs = new Map<string, { token: string; spender: string }>();
    const operatorPairs = new Map<string, { token: string; operator: string }>();
    this.seedPairsFromApprovals(cached?.approvals ?? [], erc20Pairs, operatorPairs);

    let scannedFromBlock = cached?.scannedFromBlock ?? latestBlock;
    let partial = false;
    let lastError: string | undefined;
    const ranges = this.buildLogRanges(
      cacheCoversTarget ? cached?.latestBlock : undefined,
      targetFromBlock,
      latestBlock
    );

    for (const range of ranges) {
      try {
        const { approvalLogs, operatorLogs } = await this.fetchIndexedApprovalLogs(
          chain,
          owner,
          range.fromBlock,
          range.toBlock
        );
        this.collectPairsFromLogs(approvalLogs, operatorLogs, erc20Pairs, operatorPairs);
        scannedFromBlock = Math.min(scannedFromBlock, range.fromBlock);
      } catch (error) {
        partial = true;
        lastError = this.cleanExplorerFailure(error);
        break;
      }
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

    const approvals = [...erc20Entries, ...nftEntries].filter(
      (entry): entry is ApprovalEntry => entry !== null
    );
    const progress: ApprovalScanChainProgress = {
      chainId: chain.chainId,
      chainName: chain.name,
      latestBlock,
      scannedFromBlock: Math.min(scannedFromBlock, cached?.scannedFromBlock ?? scannedFromBlock),
      scannedToBlock: latestBlock,
      targetFromBlock,
      partial,
      fromCache: Boolean(cached),
      ...(lastError ? { lastError } : {}),
      updatedAt: new Date().toISOString()
    };

    await this.writeApprovalScanRecord(owner, chain, approvals, progress);
    return { approvals, progress };
  }

  private buildLogRanges(
    cachedLatestBlock: number | undefined,
    targetFromBlock: number,
    latestBlock: number
  ): Array<{ fromBlock: number; toBlock: number }> {
    if (cachedLatestBlock !== undefined) {
      const ranges: Array<{ fromBlock: number; toBlock: number }> = [];
      let fromBlock = Math.max(targetFromBlock, cachedLatestBlock + 1);
      while (fromBlock <= latestBlock) {
        const toBlock = Math.min(latestBlock, fromBlock + EXPLORER_CHUNK_SIZE_BLOCKS - 1);
        ranges.push({ fromBlock, toBlock });
        fromBlock = toBlock + 1;
      }
      return ranges;
    }

    const ranges: Array<{ fromBlock: number; toBlock: number }> = [];
    let toBlock = latestBlock;
    while (toBlock >= targetFromBlock) {
      const fromBlock = Math.max(targetFromBlock, toBlock - EXPLORER_CHUNK_SIZE_BLOCKS + 1);
      ranges.push({ fromBlock, toBlock });
      toBlock = fromBlock - 1;
    }
    return ranges;
  }

  private async fetchIndexedApprovalLogs(
    chain: ScanChain,
    owner: string,
    fromBlock: number,
    toBlock: number
  ): Promise<{ approvalLogs: ExplorerLog[]; operatorLogs: ExplorerLog[] }> {
    const ownerTopic = zeroPadValue(owner, 32).toLowerCase();
    const [approvalLogs, operatorLogs] = await Promise.all([
      this.fetchIndexedLogs(chain, APPROVAL_EVENT_TOPIC, ownerTopic, fromBlock, toBlock),
      this.fetchIndexedLogs(chain, APPROVAL_FOR_ALL_TOPIC, ownerTopic, fromBlock, toBlock)
    ]);
    return { approvalLogs, operatorLogs };
  }

  private collectPairsFromLogs(
    approvalLogs: ExplorerLog[],
    operatorLogs: ExplorerLog[],
    erc20Pairs: Map<string, { token: string; spender: string }>,
    operatorPairs: Map<string, { token: string; operator: string }>
  ): void {
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
  }

  private seedPairsFromApprovals(
    approvals: ApprovalEntry[],
    erc20Pairs: Map<string, { token: string; spender: string }>,
    operatorPairs: Map<string, { token: string; operator: string }>
  ): void {
    for (const approval of approvals) {
      if (approval.standard === "erc721" || approval.standard === "erc1155") {
        operatorPairs.set(`${approval.token}:${approval.spender}`, {
          token: approval.token,
          operator: approval.spender
        });
      } else {
        erc20Pairs.set(`${approval.token}:${approval.spender}`, {
          token: approval.token,
          spender: approval.spender
        });
      }
    }
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
    topic1: string,
    fromBlock: number,
    toBlock: number
  ): Promise<ExplorerLog[]> {
    const urls = this.buildExplorerLogUrls(chain, topic0, topic1, fromBlock, toBlock);
    const failures: string[] = [];

    for (const url of urls) {
      try {
        return await this.fetchExplorerLogUrl(url);
      } catch (error) {
        failures.push(this.cleanExplorerFailure(error));
      }
    }

    throw new Error(`explorer logs unavailable (${failures.join("; ")})`);
  }

  private buildExplorerLogUrls(
    chain: ScanChain,
    topic0: string,
    topic1: string,
    fromBlock: number,
    toBlock: number
  ): URL[] {
    const url = new URL(chain.explorerApiBaseUrl);
    this.appendLogQuery(url, topic0, topic1, fromBlock, toBlock);
    return [url];
  }

  private appendLogQuery(
    url: URL,
    topic0: string,
    topic1: string,
    fromBlock: number,
    toBlock: number
  ): void {
    url.searchParams.set("module", "logs");
    url.searchParams.set("action", "getLogs");
    url.searchParams.set("fromBlock", String(fromBlock));
    url.searchParams.set("toBlock", String(toBlock));
    url.searchParams.set("topic0", topic0);
    url.searchParams.set("topic1", topic1);
    url.searchParams.set("topic0_1_opr", "and");
  }

  private async fetchExplorerLogUrl(url: URL): Promise<ExplorerLog[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= EXPLORER_FETCH_RETRIES; attempt += 1) {
      try {
        return await this.fetchExplorerLogUrlOnce(url);
      } catch (error) {
        lastError = error;
        if (!this.isRetryableExplorerError(error) || attempt === EXPLORER_FETCH_RETRIES) {
          throw this.withRetryContext(error, attempt);
        }
        await this.delay(EXPLORER_RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("unknown explorer error");
  }

  private async fetchExplorerLogUrlOnce(url: URL): Promise<ExplorerLog[]> {
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

  private isRetryableExplorerError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /HTTP 429|too many requests|rate limit|temporarily unavailable|timeout/i.test(message);
  }

  private withRetryContext(error: unknown, attempt: number): Error {
    const message = error instanceof Error ? error.message : String(error);
    return this.isRetryableExplorerError(error)
      ? new Error(`${message} after ${attempt} retries`)
      : new Error(message);
  }

  private cleanExplorerFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/\?.*$/, "");
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private approvalLookbackBlocks(): number {
    const configured = Number(process.env.APPROVAL_SCAN_LOOKBACK_BLOCKS);
    return Number.isInteger(configured) && configured > 0
      ? configured
      : DEFAULT_APPROVAL_LOOKBACK_BLOCKS;
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
    chainIds: number[],
    options: { mode?: "local" | "onchain" } = {}
  ): Promise<{
    analysisMode: "local" | "onchain";
    approvals: ApprovalEntry[];
    scanMeta: ApprovalDiscoveryResult["scanMeta"];
    scannerAddress?: string;
    calldata?: string;
    value?: string;
    deposit?: string;
    limitApplied?: boolean;
    scanStatus?: ScanStatus;
    items: Array<{
      chainId: number;
      spender: string;
      token: string;
      context: string;
    }>;
  }> {
    const discovery = await this.discoverApprovalsWithMetadata(walletAddress, chainIds);
    const approvals = discovery.approvals;
    const selected = approvals.slice(0, MAX_ITEMS_PER_SCAN);

    if (selected.length === 0) {
      return { analysisMode: "local", approvals, scanMeta: discovery.scanMeta, items: [] };
    }

    const items = selected.map((entry) => this.toScanItem(entry));
    if (options.mode !== "local" && await this.supportsBatchedOnchainScanner()) {
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

      if (await this.canSubmitPreparedScan(walletAddress, prepared)) {
        return {
          analysisMode: "onchain",
          approvals,
          scanMeta: discovery.scanMeta,
          limitApplied: approvals.length > selected.length,
          ...prepared
        };
      }
    }

    return this.buildLocalDiscoveredScan(walletAddress, approvals, selected, discovery.scanMeta, items);
  }

  private buildLocalDiscoveredScan(
    walletAddress: string,
    approvals: ApprovalEntry[],
    selected: ApprovalEntry[],
    scanMeta: ApprovalDiscoveryResult["scanMeta"],
    items: Array<{
      chainId: number;
      spender: string;
      token: string;
      context: string;
    }>
  ): {
    analysisMode: "local";
    approvals: ApprovalEntry[];
    scanMeta: ApprovalDiscoveryResult["scanMeta"];
    limitApplied: boolean;
    scanStatus: ScanStatus;
    items: Array<{
      chainId: number;
      spender: string;
      token: string;
      context: string;
    }>;
  } {
    const scanStatus = buildLocalBatchStatus(walletAddress, selected, items);

    return {
      analysisMode: "local",
      approvals,
      scanMeta,
      limitApplied: approvals.length > selected.length,
      scanStatus,
      items: items.map((item) => ({
        chainId: item.chainId,
        spender: item.spender,
        token: item.token,
        context: item.context
      }))
    };
  }

  private async supportsBatchedOnchainScanner(): Promise<boolean> {
    const scannerAddress = this.config.publicChain.contracts.approvalRiskScanner;
    if (!scannerAddress) {
      return false;
    }
    const provider = this.somniaProvider();
    const scanner = new Contract(scannerAddress, scannerInterface, provider);
    try {
      const stages = (await scanner.getFunction("STAGES_PER_SCAN")()) as bigint;
      return stages === 3n;
    } catch {
      return false;
    }
  }

  private async canSubmitPreparedScan(
    walletAddress: string,
    prepared: {
      scannerAddress: string;
      calldata: string;
      value: string;
    }
  ): Promise<boolean> {
    const provider = this.somniaProvider();
    try {
      await provider.call({
        from: getAddress(walletAddress),
        to: prepared.scannerAddress,
        data: prepared.calldata,
        value: BigInt(prepared.value)
      });
      return true;
    } catch {
      return false;
    }
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
    const normalizedItems = normalizeScanItems(items);

    return {
      scanId,
      requester: scan.requester,
      itemCount,
      completedCount: Number(scan.completedCount),
      complete: itemCount > 0 && Number(scan.completedCount) === itemCount,
      items: normalizedItems
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
