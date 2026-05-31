export type Notice = {
  tone: "ok" | "warn" | "bad";
  message: string;
  action?: {
    label: string;
    url: string;
  };
};

export type DashboardSection =
  | "overview"
  | "transfer"
  | "profile"
  | "inheritance";

export type AccountStatus =
  | "restoring"
  | "connected"
  | "disconnected"
  | "disconnecting"
  | "expired"
  | "error";

export type RiskTone = "ok" | "warn" | "bad";

export type GuardRuleId =
  | "large-transfer"
  | "unlimited-approve"
  | "new-contract";

export type RiskGuardRule = {
  id: GuardRuleId;
  label: string;
  status: "armed" | "needs-module" | "needs-settings";
  detail: string;
};

export type RiskGuardConfig = {
  enabled: boolean;
  selectedRules: GuardRuleId[];
  largeTransferMode: "amount" | "percent";
  largeTransferThreshold: string;
};

export type TransferSource = "eoa" | "smart";

export type NativeTransferInput = {
  source: TransferSource;
  recipient: string;
  amount: string;
};

export type NativeTransferEstimate = {
  sourceAddress: string;
  amountWei: string;
  balanceWei: string;
  gasWei: string;
  gasToken: string;
  gasLabel: string;
  totalWei: string;
  totalLabel: string;
};
