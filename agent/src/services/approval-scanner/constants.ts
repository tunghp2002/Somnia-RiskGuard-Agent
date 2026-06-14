import { Interface, id as keccakId } from "ethers";

export const APPROVAL_EVENT_TOPIC = keccakId("Approval(address,address,uint256)");
export const APPROVAL_FOR_ALL_TOPIC = keccakId("ApprovalForAll(address,address,bool)");
export const UNLIMITED_THRESHOLD = 1n << 255n;
export const MAX_ITEMS_PER_SCAN = 50;
export const EXPLORER_FETCH_RETRIES = 3;
export const EXPLORER_RETRY_BASE_DELAY_MS = process.env.NODE_ENV === "test" ? 1 : 800;
export const EXPLORER_CHUNK_SIZE_BLOCKS = 100_000_000;
export const APPROVAL_CACHE_TTL_MS = 10 * 60 * 1_000;
export const DEFAULT_APPROVAL_LOOKBACK_BLOCKS = 400_000_000;

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
