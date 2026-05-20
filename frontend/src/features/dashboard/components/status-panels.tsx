import type { CSSProperties, ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Loader2,
  Shield,
  ShieldAlert,
  Sparkles,
  XCircle
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { HeartbeatStatus, Mode, Readiness, RewardStatus, RiskSnapshot } from "@/lib/agent-api";
import type { BrowserWalletState } from "@/lib/wallet";
import type { RiskTone } from "../types";
import { classForStatus, formatAddress, formatDate, formatUsd } from "../utils";

export function GuardianStatus({
  ready,
  readiness,
  wallet,
  mode
}: {
  ready: boolean;
  readiness: Readiness | null;
  wallet: BrowserWalletState | null;
  mode: Mode;
}) {
  return (
    <section className="panel guardian-panel">
      <PanelHeading icon={<Shield size={18} />} title="Guardian Status" action={mode} />
      <div className={`guardian-state ${ready ? "ready" : "blocked"}`}>
        {ready ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}
        <div>
          <strong>{ready ? "Ready" : "Needs setup"}</strong>
          <span>{ready ? "Monitoring can explain and gate actions." : "Complete wallet, Telegram, heartbeat, and policy setup."}</span>
        </div>
      </div>
      <div className="role-chips">
        <RoleChip label="Browser" value={formatAddress(wallet?.address)} />
        <RoleChip label="Monitored" value={formatAddress(readiness?.monitoredWallet.walletAddress)} />
        <RoleChip label="Agent" value={formatAddress(readiness?.agentWallet.walletAddress)} />
      </div>
    </section>
  );
}

export function RiskScore({
  actionLoading,
  onAnalyzeRisk,
  score,
  tone,
  risk
}: {
  actionLoading: string | null;
  onAnalyzeRisk: () => void;
  score: number;
  tone: RiskTone;
  risk: RiskSnapshot | null;
}) {
  return (
    <section className="panel risk-panel">
      <PanelHeading icon={<ShieldAlert size={18} />} title="Risk Score" action={risk?.provider ?? "none"} />
      <div className={`score-ring ${tone}`} style={{ "--score": `${score * 3.6}deg` } as CSSProperties}>
        <span>{score}</span>
        <small>/100</small>
      </div>
      <p>{risk?.explanation ?? "No risk snapshot yet."}</p>
      <div className="next-steps">
        {(risk?.safeNextSteps ?? []).slice(0, 3).map((step) => (
          <span key={step}>{step}</span>
        ))}
      </div>
      <Button
        className="secondary-button"
        disabled={actionLoading === "risk-analysis"}
        onClick={onAnalyzeRisk}
        type="button"
        variant="secondary"
      >
        {actionLoading === "risk-analysis" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
        Analyze with AI
      </Button>
    </section>
  );
}

export function HeartbeatPanel({ heartbeat }: { heartbeat: HeartbeatStatus | null }) {
  return (
    <section className="panel">
      <PanelHeading icon={<Clock3 size={18} />} title="Heartbeat Timer" action={heartbeat?.state ?? "unconfigured"} />
      <div className="metric-line">
        <span>Next deadline</span>
        <strong>{formatDate(heartbeat?.nextDeadlineAt)}</strong>
      </div>
      <div className="metric-line">
        <span>DMS status</span>
        <strong>{heartbeat?.executionAvailable ? "beneficiary available" : heartbeat?.nextAction ?? "not configured"}</strong>
      </div>
      <div className={`status-strip ${classForStatus(heartbeat?.state)}`}>
        <Shield size={15} />
        {heartbeat?.contractStateReady ? "Contract state visible" : "No contract state"}
      </div>
    </section>
  );
}

export function RewardPanel({ rewards }: { rewards: RewardStatus | null }) {
  return (
    <section className="panel">
      <PanelHeading icon={<CircleDollarSign size={18} />} title="Reward Policy" action={rewards?.settings?.autoClaimEnabled ? "auto" : "manual"} />
      <div className="metric-line">
        <span>Minimum value</span>
        <strong>{formatUsd(rewards?.settings?.minRewardValueUsd)}</strong>
      </div>
      <div className="metric-line">
        <span>Max gas</span>
        <strong>{formatUsd(rewards?.settings?.maxClaimGasUsd)}</strong>
      </div>
      <div className={`status-strip ${classForStatus(rewards?.latestClaim?.status)}`}>
        {rewards?.latestClaim?.status === "failed" ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
        {rewards?.latestClaim?.reason ?? "No reward decision yet"}
      </div>
    </section>
  );
}

export function PanelHeading({
  icon,
  title,
  action
}: {
  icon: ReactNode;
  title: string;
  action?: string;
}) {
  return (
    <div className="panel-heading">
      <div>{icon}<h2>{title}</h2></div>
      {action ? <span>{action}</span> : null}
    </div>
  );
}

export function HealthRow({
  icon,
  label,
  value,
  tone
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className="health-row">
      <span>{icon}{label}</span>
      <strong className={`status-${tone}`}>{value}</strong>
    </div>
  );
}

function RoleChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="role-chip">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}
