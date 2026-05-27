export interface AgentEnvelope<T> {
  data: T;
  meta?: {
    requestId?: string;
  };
}

export interface AgentFailure {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class AgentApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

export type Mode = "simulation" | "testnet";
export type ReceiptStatus = "started" | "succeeded" | "failed" | "skipped" | "denied";

export interface Readiness {
  monitoredWallet: {
    ready: boolean;
    walletAddress?: string;
  };
  sessionKey: {
    ready: boolean;
    chainId: number;
  };
  configuration: {
    telegramEnabled: boolean;
    autoClaimEnabled: boolean;
  };
}

export interface PublicChainMetadata {
  key: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  blockExplorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  contracts: {
    inheritanceRegistry?: string;
  };
}

export interface InheritancePlanStatus {
  registryAddress: string;
  smartAccount: string;
  state: "none" | "active" | "cancelled" | "executed";
  active: boolean;
  heartbeatIntervalSeconds: number;
  gracePeriodSeconds: number;
  timelockPeriodSeconds: number;
  lastHeartbeatAt?: string;
  nextDeadlineAt?: string;
  graceEndsAt?: string;
  timelockEndsAt?: string;
  executedAt?: string;
  beneficiaries: Array<{
    address: string;
    shareBps: number;
  }>;
  protectedAssets: Array<{
    token: string;
    kind: "native" | "erc20";
  }>;
  createdAt?: string;
  updatedAt?: string;
}

export interface TelegramConnectSession {
  walletAddress: string;
  smartAccountAddress?: string;
  code: string;
  expiresAt: string;
  status: "waiting" | "connected" | "expired" | "failed";
  connected: boolean;
  botDeepLink: string;
  binding?: {
    chatId: string;
    telegramUserId?: string;
    telegramUsername?: string;
    telegramDisplayName?: string;
    smartAccountAddress?: string;
  };
}

export interface TelegramBindingStatus {
  connected: boolean;
  binding?: {
    chatId: string;
    walletAddress?: string;
    smartAccountAddress?: string;
    telegramUserId?: string;
    telegramUsername?: string;
    telegramDisplayName?: string;
  };
}

export interface SessionKeyActionPermission {
  action: "checkin" | "send" | "swap";
  walletAddress: string;
  smartAccountAddress?: string;
  sessionKeyAddress: string;
  approvedTargets: string[];
  nativeTokenLimitPerTransaction: string;
  permissionStartTimestamp: string;
  permissionEndTimestamp: string;
}

export interface UserRecord {
  userId: string;
  walletAddress: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioSnapshot {
  walletAddress: string;
  source: "demo" | "somnia";
  totalValueUsd: string;
  assets: Array<{
    symbol: string;
    balance: string;
    valueUsd: string;
  }>;
  rewards: Array<{
    protocol: string;
    claimableValueUsd: string;
  }>;
  riskSignals: Array<{
    signalType: string;
    severity: "low" | "medium" | "high";
    description: string;
  }>;
  createdAt: string;
}

export interface RiskSnapshot {
  walletAddress: string;
  status: "succeeded" | "failed";
  score: number;
  explanation: string;
  provider: "groq" | "deepseek" | "none";
  threshold: {
    alertThreshold: number;
    exceeded: boolean;
  };
  safeNextSteps: string[];
  createdAt: string;
}

export interface HeartbeatStatus {
  walletAddress: string;
  beneficiaryAddress: string;
  state: string;
  lastHeartbeatAt: string;
  nextDeadlineAt: string;
  graceEndsAt: string;
  timelockEndsAt: string;
  contractStateReady: boolean;
  executionAvailable: boolean;
  nextAction: string;
  returnAt?: string;
}

export interface RewardStatus {
  walletAddress: string;
  settings: null | {
    autoClaimEnabled: boolean;
    minRewardValueUsd: string;
    maxClaimGasUsd: string;
  };
  latestClaim: null | {
    protocol: string;
    rewardToken: string;
    status: "skipped" | "attempted" | "failed" | "succeeded";
    reason?: string;
    valueUsd: string;
    gasUsd: string;
    txHash?: string;
    createdAt: string;
  };
  claimableRewards: Array<{
    protocol: string;
    rewardToken: string;
    valueUsd: string;
    gasUsd: string;
  }>;
}

export interface AuditEvent {
  auditEventId: string;
  createdAt: string;
  eventType: string;
  status: ReceiptStatus;
  metadata: Record<string, unknown>;
}

export interface DemoScenarioResult {
  scenario: "setup_ready" | "risk_alert" | "reward_claim" | "missed_heartbeat" | "full_demo";
  mode: "simulation";
  walletAddress: string;
  receipts: Array<{
    receiptId: string;
    eventType: string;
    status: ReceiptStatus;
    reason: string;
    createdAt: string;
  }>;
  createdAt: string;
}

function getAgentApiBaseUrl() {
  const configured =
    process.env.NEXT_PUBLIC_AGENT_API_BASE_URL ??
    process.env.NEXT_PUBLIC_AGENT_API_URL;

  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }

  return "http://127.0.0.1:3001";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getAgentApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    },
    cache: "no-store"
  });
  const payload = (await response.json()) as AgentEnvelope<T> | AgentFailure;

  if (!response.ok || "error" in payload) {
    const error = "error" in payload
      ? payload.error
      : { code: "request_failed", message: "Agent API request failed" };
    throw new AgentApiError(response.status, error.code, error.message, error.details);
  }

  return payload.data;
}

function walletQuery(walletAddress?: string) {
  return walletAddress ? `?walletAddress=${encodeURIComponent(walletAddress)}` : "";
}

export const agentApi = {
  getReadiness: () => request<Readiness>("/api/setup/readiness"),
  getPublicChain: () => request<PublicChainMetadata>("/api/public-chain"),
  ensureSessionKeyAction: (body: {
    walletAddress: string;
    smartAccountAddress?: string;
    action: SessionKeyActionPermission["action"];
  }) =>
    request<SessionKeyActionPermission>("/api/session-keys/action", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getInheritancePlan: (smartAccount: string) =>
    request<InheritancePlanStatus | null>(
      `/api/inheritance/plan?smartAccount=${encodeURIComponent(smartAccount)}`
    ),
  registerWallet: (body: { walletAddress: string; message: string; signature: string }) =>
    request<UserRecord>("/api/users", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getUserProfile: (walletAddress: string) =>
    request<UserRecord | null>(`/api/users/profile${walletQuery(walletAddress)}`),
  updateUserProfile: (body: { walletAddress: string; displayName: string }) =>
    request<UserRecord>("/api/users/profile", {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
  getPortfolio: (walletAddress?: string) =>
    request<PortfolioSnapshot | null>(`/api/portfolios/latest${walletQuery(walletAddress)}`),
  getRisk: (walletAddress?: string) =>
    request<RiskSnapshot | null>(`/api/risk-snapshots/latest${walletQuery(walletAddress)}`),
  analyzeRisk: (body: { walletAddress?: string }) =>
    request<RiskSnapshot>("/api/risk-snapshots/analyze", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getHeartbeat: (walletAddress: string) =>
    request<HeartbeatStatus | null>(`/api/heartbeats/status${walletQuery(walletAddress)}`),
  configureHeartbeat: (body: {
    walletAddress: string;
    beneficiaryAddress: string;
    intervalSeconds: number;
    graceSeconds: number;
    timelockSeconds: number;
    message: string;
    signature: string;
  }) =>
    request<HeartbeatStatus>("/api/heartbeats/settings", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  configureRewards: (body: {
    walletAddress: string;
    autoClaimEnabled: boolean;
    minRewardValueUsd: number;
    maxClaimGasUsd: number;
  }) =>
    request<RewardStatus>("/api/rewards/settings", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getRewards: (walletAddress: string) =>
    request<RewardStatus>(`/api/rewards/status${walletQuery(walletAddress)}`),
  linkTelegram: (body: { walletAddress: string; chatId: string; message: string; signature: string }) =>
    request<unknown>("/api/telegram/bindings", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getTelegramBinding: (walletAddress: string) =>
    request<TelegramBindingStatus>(`/api/telegram/bindings${walletQuery(walletAddress)}`),
  unlinkTelegram: (body: { walletAddress: string; message: string; signature: string }) =>
    request<{ unlinked: boolean }>("/api/telegram/bindings", {
      method: "DELETE",
      body: JSON.stringify(body)
    }),
  startTelegramConnect: (body: { walletAddress: string; smartAccountAddress?: string }) =>
    request<TelegramConnectSession>("/api/telegram/connect/start", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getTelegramConnectStatus: (walletAddress: string) =>
    request<TelegramConnectSession>(`/api/telegram/connect/status${walletQuery(walletAddress)}`),
  confirmTelegramConnect: (body: { code: string; chatId: string; telegramUserId?: string }) =>
    request<TelegramConnectSession>("/api/telegram/connect/confirm", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getHealth: () => request<Record<string, unknown>>("/api/health"),
  getAuditEvents: (limit = 20) =>
    request<{ events: AuditEvent[] }>(`/api/audit-events/recent?limit=${limit}`),
  runDemoScenario: (body: {
    scenario: DemoScenarioResult["scenario"];
  }) =>
    request<DemoScenarioResult>("/api/demo/scenarios", {
      method: "POST",
      body: JSON.stringify(body)
    })
};
