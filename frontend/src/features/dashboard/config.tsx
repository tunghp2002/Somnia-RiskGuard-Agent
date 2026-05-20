import type { ReactNode } from "react";
import {
  CircleDollarSign,
  Clock3,
  Cpu,
  FileText,
  KeyRound,
  Shield,
  ShieldAlert,
  Sparkles,
  Wallet
} from "lucide-react";

import type { DemoScenarioResult } from "@/lib/agent-api";
import type { DashboardSection } from "./types";

export const navItems: Array<{ id: DashboardSection; label: string; icon: ReactNode; primaryMobile?: boolean }> = [
  { id: "overview", label: "Overview", icon: <Shield size={17} />, primaryMobile: true },
  { id: "setup", label: "Setup", icon: <KeyRound size={17} />, primaryMobile: true },
  { id: "inheritance", label: "Inheritance", icon: <Wallet size={17} />, primaryMobile: true },
  { id: "risk", label: "Risk", icon: <ShieldAlert size={17} />, primaryMobile: true },
  { id: "heartbeat", label: "Heartbeat", icon: <Clock3 size={17} /> },
  { id: "rewards", label: "Rewards", icon: <CircleDollarSign size={17} /> },
  { id: "receipts", label: "Receipts", icon: <FileText size={17} /> },
  { id: "demo", label: "Demo", icon: <Sparkles size={17} /> },
  { id: "health", label: "Health", icon: <Cpu size={17} /> }
];

export const sectionDescriptions: Record<DashboardSection, string> = {
  overview: "Live account posture across setup, risk, heartbeat, rewards, and receipts.",
  setup: "Connect the monitored wallet, Telegram alerts, and reward policy.",
  inheritance: "Design the dead-man switch timing and beneficiary release plan for protected funds.",
  risk: "Analyze portfolio exposure, risk signals, and safe next steps.",
  heartbeat: "Track renewal deadlines, grace period, and beneficiary execution readiness.",
  rewards: "Tune auto-claim policy bounds and inspect recent reward decisions.",
  receipts: "Review signed safety receipts and agent audit events.",
  demo: "Seed deterministic simulation states for product walkthroughs.",
  health: "Inspect operator services, signer readiness, and Somnia connectivity."
};

export const scenarios: Array<{
  id: DemoScenarioResult["scenario"];
  label: string;
  detail: string;
}> = [
  {
    id: "setup_ready",
    label: "Setup Ready",
    detail: "Register demo wallet and show readiness"
  },
  {
    id: "risk_alert",
    label: "Risk Alert",
    detail: "Seed high Risk Score and safety steps"
  },
  {
    id: "reward_claim",
    label: "Reward Policy",
    detail: "Show a policy skip receipt"
  },
  {
    id: "missed_heartbeat",
    label: "Missed Heartbeat",
    detail: "Expose DMS/timelock visibility"
  },
  {
    id: "full_demo",
    label: "Full Demo",
    detail: "Run all deterministic states"
  }
];
