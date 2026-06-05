"use client";

import { Loader2, ScanLine, ShieldAlert } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";

import { useApprovalScanner, approvalKey } from "../hooks/use-approval-scanner";
import { formatAddress } from "../utils";
import { PanelHeading } from "./common/panel-heading";

import type { ApprovalEntry, PublicChainMetadata, ScanItemStatus } from "@/lib/agent-api";

function riskTone(score: number): "ok" | "warn" | "bad" {
  if (score >= 67) {
    return "bad";
  }
  if (score >= 34) {
    return "warn";
  }
  return "ok";
}

function riskLabel(item: ScanItemStatus | undefined): string {
  if (!item) {
    return "Not analyzed";
  }
  if (item.status !== "complete") {
    return item.status === "inferring" ? "Scoring…" : "Analyzing…";
  }
  return `${item.riskScore}/100`;
}

export function ApprovalsPanel({
  walletAddress,
  publicChain
}: {
  walletAddress?: string | undefined;
  publicChain: PublicChainMetadata | null;
}) {
  const { state, actions } = useApprovalScanner(walletAddress, publicChain?.chainId);

  const riskByKey = useMemo(() => {
    const map = new Map<string, ScanItemStatus>();
    for (const item of state.scanStatus?.items ?? []) {
      map.set(
        approvalKey({ chainId: item.chainId, token: item.token, spender: item.spender }),
        item
      );
    }
    return map;
  }, [state.scanStatus]);

  const analyzeDisabled =
    state.analyzing || state.polling || state.approvals.length === 0 || !walletAddress;

  return (
    <section className="panel">
      <PanelHeading icon={<ScanLine size={18} />} title="Approval Risk Scanner" />

      <p className="muted" style={{ marginTop: 0 }}>
        Review every contract you have approved as a token spender and score each one for risk using
        the Somnia JSON API, Parse Website, and LLM Inference agents.
      </p>

      <div className="chain-select" role="group" aria-label="Chains to scan">
        {state.chains.map((chain) => {
          const selected = state.selectedChainIds.includes(chain.chainId);
          return (
            <button
              key={chain.id}
              type="button"
              className={`chain-chip ${selected ? "is-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => actions.toggleChain(chain.chainId)}
            >
              {chain.name}
            </button>
          );
        })}
        {state.chains.length === 0 ? <span className="muted">Loading chains…</span> : null}
      </div>

      <div className="panel-actions" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void actions.loadApprovals()}
          disabled={state.listLoading || !walletAddress}
        >
          {state.listLoading ? <Loader2 className="spin" size={16} /> : null}
          {state.listLoading ? "Scanning…" : "Scan approvals"}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => void actions.analyze()}
          disabled={analyzeDisabled}
        >
          {state.analyzing || state.polling ? <Loader2 className="spin" size={16} /> : <ShieldAlert size={16} />}
          {state.analyzing
            ? "Awaiting signature…"
            : state.polling
              ? "Analyzing on-chain…"
              : "Analyze risk"}
        </Button>
      </div>

      {state.error ? <p className="status-bad">{state.error}</p> : null}
      {state.note ? <p className="muted">{state.note}</p> : null}

      {state.approvals.length > 0 ? (
        <div className="approvals-table">
          <div className="approvals-row approvals-head">
            <span>Token</span>
            <span>Spender</span>
            <span>Allowance</span>
            <span>Chain</span>
            <span>Risk</span>
          </div>
          {state.approvals.map((entry) => (
            <ApprovalRow
              key={approvalKey(entry)}
              entry={entry}
              risk={riskByKey.get(approvalKey(entry))}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ApprovalRow({
  entry,
  risk
}: {
  entry: ApprovalEntry;
  risk: ScanItemStatus | undefined;
}) {
  const tone = risk && risk.status === "complete" ? riskTone(risk.riskScore) : "neutral";
  return (
    <div className="approvals-row">
      <span title={entry.name || entry.symbol}>
        <strong>{entry.symbol}</strong>
        <small className="muted"> {entry.standard.toUpperCase()}</small>
      </span>
      <span>
        <a href={entry.explorerSpenderUrl} target="_blank" rel="noreferrer">
          {formatAddress(entry.spender)}
        </a>
      </span>
      <span>
        {entry.isUnlimited ? (
          <span className="badge badge-warn">Unlimited</span>
        ) : (
          formatAddress(entry.token)
        )}
      </span>
      <span className="muted">{entry.chainName}</span>
      <span className={`status-${tone}`} title={risk?.verdict ?? ""}>
        <strong>{riskLabel(risk)}</strong>
        {risk && risk.status === "complete" && risk.verdict ? (
          <small className="muted" style={{ display: "block" }}>
            {risk.verdict}
          </small>
        ) : null}
      </span>
    </div>
  );
}
