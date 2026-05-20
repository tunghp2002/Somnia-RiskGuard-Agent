export type Notice = { tone: "ok" | "warn" | "bad"; message: string };

export type DashboardSection =
  | "overview"
  | "setup"
  | "inheritance"
  | "risk"
  | "heartbeat"
  | "rewards"
  | "receipts"
  | "demo"
  | "health";

export type AccountStatus =
  | "restoring"
  | "connected"
  | "disconnected"
  | "disconnecting"
  | "expired"
  | "error";

export type RiskTone = "ok" | "warn" | "bad";
