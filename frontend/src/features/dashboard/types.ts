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
