export interface ExplorerLog {
  address: string;
  topics: string[];
  data: string;
}

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
