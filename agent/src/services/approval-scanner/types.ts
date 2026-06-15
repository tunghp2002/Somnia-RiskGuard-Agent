import { Interface } from "ethers";
import { z } from "zod";

export const MAX_ITEMS_PER_SCAN = 50;

export const erc20Interface = new Interface([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)"
]);

export const scannerInterface = new Interface([
  "function STAGES_PER_SCAN() view returns (uint256)",
  "function quoteScan(uint256 itemCount) view returns (uint256)",
  "function requestScan(tuple(uint256 chainId, address spender, address token, string context, string explorerApiUrl, string explorerApiSelector, string explorerPageUrl)[] items) payable returns (uint256 scanId)",
  "function getScan(uint256 scanId) view returns (tuple(address requester, uint256 escrow, uint256 agentDeposit, uint256 itemCount, uint256 completedCount, bool jsonReturned, bool webReturned, bool inferenceFired, bool inferenceSucceeded, string jsonFacts, string webFindings, string inferenceSummary, bool exists))",
  "function getItem(uint256 scanId, uint256 itemIndex) view returns (tuple(uint256 chainId, address spender, address token, string context, bool jsonReturned, bool webReturned, bool inferenceFired, uint8 status, string jsonFacts, string webFindings, uint8 riskScore, string verdict))",
  "function getScanResult(uint256 scanId) view returns (tuple(address requester, uint256 escrow, uint256 agentDeposit, uint256 itemCount, uint256 completedCount, bool jsonReturned, bool webReturned, bool inferenceFired, bool inferenceSucceeded, string jsonFacts, string webFindings, string inferenceSummary, bool exists) scan, tuple(uint256 chainId, address spender, address token, string context, bool jsonReturned, bool webReturned, bool inferenceFired, uint8 status, string jsonFacts, string webFindings, uint8 riskScore, string verdict)[] items)",
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
    .max(MAX_ITEMS_PER_SCAN)
});

export const approvalAnalyzePrepareRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainIds: z.array(z.number().int().positive()).min(1),
  mode: z.enum(["local", "onchain"]).optional()
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

export interface ApprovalScanChainProgress {
  chainId: number;
  chainName: string;
  latestBlock: number;
  scannedFromBlock: number;
  scannedToBlock: number;
  targetFromBlock: number;
  partial: boolean;
  fromCache: boolean;
  lastError?: string;
  updatedAt: string;
}

export interface ApprovalDiscoveryResult {
  approvals: ApprovalEntry[];
  scanMeta: {
    partial: boolean;
    chains: ApprovalScanChainProgress[];
  };
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

export interface ScanTuple {
  requester: string;
  escrow: bigint;
  agentDeposit: bigint;
  itemCount: bigint;
  completedCount: bigint;
  jsonReturned: boolean;
  webReturned: boolean;
  inferenceFired: boolean;
  inferenceSucceeded: boolean;
  jsonFacts: string;
  webFindings: string;
  inferenceSummary: string;
  exists: boolean;
}

export interface ItemTuple {
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

export interface ScanItem {
  chainId: number;
  spender: string;
  token: string;
  context: string;
  explorerApiUrl: string;
  explorerApiSelector: string;
  explorerPageUrl: string;
}

export type ApprovalScanPrepareApproval = z.infer<
  typeof approvalScanPrepareRequestSchema
>["approvals"][number];

export const approvalEntrySchema = z.object({
  chainId: z.number().int().positive(),
  chainName: z.string(),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  symbol: z.string(),
  name: z.string(),
  standard: z.enum(["erc20", "erc721", "erc1155"]),
  spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  allowance: z.string(),
  isUnlimited: z.boolean(),
  explorerSpenderUrl: z.string()
});

export const approvalScanCacheRecordSchema = z.object({
  key: z.string(),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
  chainName: z.string(),
  approvals: z.array(approvalEntrySchema),
  scannedFromBlock: z.number().int().nonnegative(),
  scannedToBlock: z.number().int().nonnegative(),
  targetFromBlock: z.number().int().nonnegative(),
  latestBlock: z.number().int().nonnegative(),
  partial: z.boolean(),
  lastError: z.string().optional(),
  updatedAt: z.string()
});

export const approvalScanCacheRecordsSchema = z.array(approvalScanCacheRecordSchema);

export type ApprovalScanCacheRecord = z.infer<typeof approvalScanCacheRecordSchema>;
