import { Activity, Bot, Clock3, Cpu, Link2, RadioTower, Send, Shield, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  DemoScenarioResult,
  Mode,
  PortfolioSnapshot,
  PublicChainMetadata,
  Readiness
} from "@/lib/agent-api";
import { scenarios } from "../config";
import { classForStatus, formatAddress, formatDate, formatUsd, hasOkFlag, readableMetadata } from "../utils";
import { HealthRow, PanelHeading } from "./status-panels";

export function PortfolioWatch({
  loading,
  portfolio
}: {
  loading: boolean;
  portfolio: PortfolioSnapshot | null;
}) {
  return (
    <section className="panel portfolio-panel">
      <PanelHeading icon={<Activity size={17} />} title="Portfolio Watch" action={loading ? "refreshing" : portfolio?.source ?? "no data"} />
      <div className="portfolio-total">{formatUsd(portfolio?.totalValueUsd)}</div>
      <div className="asset-list">
        {(portfolio?.assets ?? []).slice(0, 4).map((asset) => (
          <div className="asset-row" key={asset.symbol}>
            <span>{asset.symbol}</span>
            <span>{asset.balance}</span>
            <strong>{formatUsd(asset.valueUsd)}</strong>
          </div>
        ))}
        {!portfolio ? <p className="muted">No portfolio snapshot yet. Run a simulation scenario or start the agent monitor.</p> : null}
      </div>
      <div className="signal-list">
        {(portfolio?.riskSignals ?? []).map((signal) => (
          <span className={`signal ${signal.severity}`} key={`${signal.signalType}-${signal.description}`}>
            {signal.severity}: {signal.description}
          </span>
        ))}
      </div>
    </section>
  );
}

export function DemoScenarioControl({
  actionLoading,
  mode,
  onRunDemo
}: {
  actionLoading: string | null;
  mode: Mode;
  onRunDemo: (scenario: DemoScenarioResult["scenario"]) => void;
}) {
  return (
    <section className="panel demo-panel">
      <PanelHeading icon={<Sparkles size={17} />} title="Demo Scenario Control" action={mode} />
      <p className="muted">Deterministic simulation states are seeded through the agent API and then shown from the same read models as live status.</p>
      <div className="scenario-grid">
        {scenarios.map((scenario) => (
          <Button
            className="scenario-button"
            disabled={mode !== "simulation" || actionLoading === scenario.id}
            key={scenario.id}
            onClick={() => onRunDemo(scenario.id)}
            type="button"
            variant="secondary"
          >
            <span>{scenario.label}</span>
            <small>{actionLoading === scenario.id ? "Running..." : scenario.detail}</small>
          </Button>
        ))}
      </div>
    </section>
  );
}

export function OperatorHealth({
  health,
  publicChain,
  readiness
}: {
  health: Record<string, unknown> | null;
  publicChain: PublicChainMetadata | null;
  readiness: Readiness | null;
}) {
  return (
    <section className="panel">
      <PanelHeading icon={<Cpu size={17} />} title="Operator Health" action="secret-safe" />
      <div className="health-list">
        <HealthRow icon={<RadioTower size={15} />} label="Agent API" value={health ? health.ok === false ? "degraded" : "reachable" : "unavailable"} tone={health ? health.ok === false ? "bad" : "ok" : "warn"} />
        <HealthRow icon={<Bot size={15} />} label="Telegram" value={readableMetadata(health?.telegram)} tone={health?.telegram ? "ok" : "warn"} />
        <HealthRow icon={<Send size={15} />} label="Somnia adapter" value={readableMetadata(health?.somnia)} tone={hasOkFlag(health?.somnia) && health.somnia.ok ? "ok" : "warn"} />
        <HealthRow icon={<Shield size={15} />} label="Signer" value={readiness?.agentWallet.ready ? formatAddress(readiness.agentWallet.walletAddress) : "missing"} tone={readiness?.agentWallet.ready ? "ok" : "bad"} />
        <HealthRow icon={<Link2 size={15} />} label="Chain" value={publicChain ? `${publicChain.name} (${publicChain.chainId})` : "unknown"} tone="neutral" />
      </div>
    </section>
  );
}

export function SafetyReceipts({
  receipts
}: {
  receipts: Array<{
    id: string;
    title: string;
    status: string;
    detail: string;
    createdAt: string;
  }>;
}) {
  return (
    <section className="panel timeline-panel">
      <PanelHeading icon={<Clock3 size={17} />} title="Safety Receipts" action={`${receipts.length} recent`} />
      <div className="timeline">
        {receipts.map((receipt) => (
          <article className="receipt" key={receipt.id}>
            <span className={`receipt-dot ${classForStatus(receipt.status)}`} />
            <div>
              <div className="receipt-title">
                <strong>{receipt.title}</strong>
                <span className={classForStatus(receipt.status)}>{receipt.status}</span>
              </div>
              <p>{receipt.detail}</p>
              <time>{formatDate(receipt.createdAt)}</time>
            </div>
          </article>
        ))}
        {receipts.length === 0 ? <p className="muted">No receipts yet. Run a demo scenario or save settings.</p> : null}
      </div>
    </section>
  );
}
