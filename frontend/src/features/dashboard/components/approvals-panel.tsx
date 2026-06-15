"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal, ModalActions } from "@/components/ui/modal";

import {
  approvalKey,
  type ApprovalAnalysisRecord,
  useApprovalScanner
} from "@/hooks/dashboard";
import { formatAddress, readableMetadata } from "@/utils/dashboard";

import type {
  ApprovalEntry,
  PublicChainMetadata,
  ScanItemStatus
} from "@/lib/agent-api";

const MAX_ITEMS_PER_SCAN = 50;

function normalizedRiskLevel(item: ScanItemStatus | undefined): string {
  return item?.verdict?.trim().toUpperCase() || "";
}

function riskTone(item: ScanItemStatus | undefined): "ok" | "warn" | "bad" | "neutral" {
  const level = normalizedRiskLevel(item);
  if (
    level === "CRITICAL" ||
    level === "HIGH" ||
    level === "UNKNOWN" ||
    level.includes("FAILED")
  ) {
    return "bad";
  }
  if (level === "MEDIUM") {
    return "warn";
  }
  if (level === "LOW" || level === "TRUSTED_LOW") {
    return "ok";
  }
  return "neutral";
}

function riskLabel(item: ScanItemStatus | undefined): string {
  if (!item) {
    return "Not analyzed";
  }
  if (item.status !== "complete") {
    return item.status === "inferring" ? "Scoring" : "Analyzing";
  }
  const level = normalizedRiskLevel(item);
  if (level.includes("FAILED")) {
    return "HIGH";
  }
  return level === "TRUSTED_LOW" ? "LOW" : level || "UNKNOWN";
}

function factLabel(value: string | undefined): string {
  return value && value.trim().length > 0 ? value : "Unavailable";
}

function formatAnalysisDay(value: string | null): string {
  if (!value) {
    return "Today";
  }

  const date = new Date(value);
  const today = new Date();

  return date.toDateString() === today.toDateString()
    ? "Today"
    : date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric"
      });
}

function formatAnalysisTime(value: string | null): string {
  return new Date(value ?? Date.now()).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function analyzeButtonLabel({
  analyzing,
  listLoading,
  polling
}: {
  analyzing: boolean;
  listLoading: boolean;
  polling: boolean;
}) {
  if (listLoading) {
    return "Finding approvals";
  }
  if (analyzing) {
    return "Awaiting signature";
  }
  if (polling) {
    return "Agents analyzing";
  }
  return "Analyze";
}

function chainLabel(record: ApprovalAnalysisRecord): string {
  return record.chainNames.length > 0 ? record.chainNames.join(", ") : "selected chains";
}

function chainScope(record: ApprovalAnalysisRecord): string {
  return record.chainIds.length === 1 ? `on ${chainLabel(record)}` : `across ${chainLabel(record)}`;
}

function formatBlockNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function recordBlockSummary(record: ApprovalAnalysisRecord): string {
  const chains = record.scanMeta?.chains ?? [];
  if (chains.length === 0) {
    return "";
  }
  if (chains.length > 1) {
    const partialCount = chains.filter((chain) => chain.partial).length;
    const cacheCount = chains.filter((chain) => chain.fromCache).length;
    const status = partialCount > 0
      ? `${partialCount} partial`
      : cacheCount > 0
        ? `${cacheCount} cached`
        : "complete";
    return `Indexed ${chains.length} chains (${status}).`;
  }
  const fromBlock = Math.min(...chains.map((chain) => chain.scannedFromBlock));
  const toBlock = Math.max(...chains.map((chain) => chain.scannedToBlock));
  const partial = record.scanMeta?.partial || chains.some((chain) => chain.partial);
  const cache = chains.some((chain) => chain.fromCache);
  const suffix = partial ? "partial" : cache ? "cached" : "complete";
  return `Indexed blocks ${formatBlockNumber(fromBlock)}-${formatBlockNumber(toBlock)} (${suffix}).`;
}

function recordStats(record: ApprovalAnalysisRecord) {
  const items = record.scanStatus?.items ?? [];
  const completeItems = items.filter((item) => item.status === "complete");
  const high = completeItems.filter((item) => {
    const level = normalizedRiskLevel(item);
    return level === "HIGH" || level === "CRITICAL" || level === "UNKNOWN" || level.includes("FAILED");
  }).length;
  const low = completeItems.filter((item) => {
    const level = normalizedRiskLevel(item);
    return level === "LOW" || level === "TRUSTED_LOW";
  }).length;
  const medium = completeItems.length - high - low;

  return {
    fetched: record.approvals.length,
    high,
    low,
    medium,
    analyzed: completeItems.length,
    total: items.length || Math.min(record.approvals.length, MAX_ITEMS_PER_SCAN)
  };
}

function chainStats(record: ApprovalAnalysisRecord) {
  const statsByChain = new Map<number, ReturnType<typeof recordStats> & { chainName: string }>();
  const chainNames = new Map<number, string>();

  for (const chain of record.scanMeta?.chains ?? []) {
    chainNames.set(chain.chainId, chain.chainName);
  }
  for (const approval of record.approvals) {
    chainNames.set(approval.chainId, approval.chainName);
  }

  for (const [chainId, chainName] of chainNames.entries()) {
    const approvals = record.approvals.filter((approval) => approval.chainId === chainId);
    const items = record.scanStatus?.items.filter((item) => item.chainId === chainId) ?? [];
    const scopedRecord: ApprovalAnalysisRecord = {
      ...record,
      approvals,
      scanStatus: record.scanStatus
        ? {
            ...record.scanStatus,
            items
          }
        : null
    };
    statsByChain.set(chainId, { ...recordStats(scopedRecord), chainName });
  }

  return [...statsByChain.entries()].map(([chainId, stats]) => ({ chainId, ...stats }));
}

function recordSummary(record: ApprovalAnalysisRecord): string {
  const stats = recordStats(record);
  const blockSummary = recordBlockSummary(record);
  const suffix = blockSummary ? ` ${blockSummary}` : "";

  if (record.status === "empty") {
    return `Fetched 0 active approvals ${chainScope(record)}.${suffix}`;
  }
  if (record.status === "analyzing") {
    return `Analyzing ${stats.total} of ${stats.fetched} approval${stats.fetched === 1 ? "" : "s"} ${chainScope(record)}.${suffix}`;
  }
  if (record.status === "timeout") {
    return `Fetched ${stats.fetched} approvals. Analysis is still running: ${stats.analyzed}/${stats.total} complete.${suffix}`;
  }

  return `Fetched ${stats.fetched} approvals ${chainScope(record)}. ${stats.analyzed} analyzed: ${stats.high} high, ${stats.medium} medium, ${stats.low} low.${suffix}`;
}

function recordTitle(record: ApprovalAnalysisRecord): string {
  if (record.status === "empty") {
    return "No active approvals";
  }
  if (record.status === "analyzing" || record.status === "timeout") {
    return "Approval analysis in progress";
  }
  return "Approval risk summary";
}

function rowKey(entry: ApprovalEntry | undefined, item: ScanItemStatus | undefined, index: number) {
  if (entry) {
    return approvalKey(entry);
  }
  if (item) {
    return approvalKey(item);
  }
  return String(index);
}

function buildRows(record: ApprovalAnalysisRecord) {
  const approvalByKey = new Map<string, ApprovalEntry>();
  for (const entry of record.approvals) {
    approvalByKey.set(approvalKey(entry), entry);
  }

  if (record.scanStatus?.items.length) {
    return record.scanStatus.items.map((item, index) => ({
      entry: approvalByKey.get(approvalKey(item)),
      item,
      key: rowKey(approvalByKey.get(approvalKey(item)), item, index)
    }));
  }

  return record.approvals.map((entry, index) => ({
    entry,
    item: undefined,
    key: rowKey(entry, undefined, index)
  }));
}

export function ApprovalsPanel({
  walletAddress,
  publicChain
}: {
  walletAddress?: string | undefined;
  publicChain: PublicChainMetadata | null;
}) {
  const { state, actions } = useApprovalScanner(walletAddress, publicChain?.chainId);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  const selectedRecord = useMemo(
    () => state.history.find((record) => record.id === selectedRecordId) ?? null,
    [selectedRecordId, state.history]
  );

  const analyzeDisabled =
    state.analyzing ||
    state.polling ||
    state.listLoading ||
    !walletAddress ||
    state.selectedChainIds.length === 0;

  return (
    <section className="panel approvals-chat-panel">
      <div className="approvals-feed">
        {state.history.length > 0 ? (
          <>
            <div className="approvals-feed-day">{formatAnalysisDay(state.history[0]?.createdAt ?? null)}</div>
            {state.history.map((record) => (
              <ApprovalHistoryCard
                key={record.id}
                onOpen={() => setSelectedRecordId(record.id)}
                record={record}
              />
            ))}
          </>
        ) : (
          <div className="approval-empty-state">
            <h2>No approval analysis yet.</h2>
          </div>
        )}
      </div>

      <div className="approval-composer">
        <p className="approval-control-help">Select chains and run one approval risk analysis.</p>

        <div className="approval-controls">
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
            {state.chains.length === 0 ? <span className="muted">Loading chains...</span> : null}
          </div>

          <Button
            disabled={analyzeDisabled}
            onClick={() => void actions.analyze()}
            type="button"
            variant="primary"
          >
            {state.analyzing || state.polling || state.listLoading ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <ShieldAlert size={16} />
            )}
            {analyzeButtonLabel(state)}
          </Button>
        </div>
      </div>

      {selectedRecord ? (
        <ApprovalDetailModal
          onClose={() => setSelectedRecordId(null)}
          record={selectedRecord}
        />
      ) : null}
    </section>
  );
}

function ApprovalHistoryCard({
  onOpen,
  record
}: {
  onOpen: () => void;
  record: ApprovalAnalysisRecord;
}) {
  const tone = record.status === "complete" && recordStats(record).high > 0
    ? "bad"
    : record.status === "complete" && recordStats(record).medium > 0
      ? "warn"
      : "ok";

  return (
    <article className={`approval-info-card approval-summary-card status-${tone}`}>
      <button className="approval-summary-button" onClick={onOpen} type="button">
        <span className="approval-message-meta">
          <span>
            <ShieldAlert size={14} />
            Agent Scanner
          </span>
          <time>{formatAnalysisTime(record.updatedAt)}</time>
        </span>
        <strong>{recordTitle(record)}</strong>
        <span className="approval-result-summary">{recordSummary(record)}</span>
      </button>
    </article>
  );
}

function ApprovalDetailModal({
  onClose,
  record
}: {
  onClose: () => void;
  record: ApprovalAnalysisRecord;
}) {
  const rows = buildRows(record);

  return (
    <Modal className="approval-detail-modal" overlayClassName="approval-modal-overlay">
      <h3>{recordTitle(record)}</h3>
      <p>{recordSummary(record)}</p>
      {record.scanMeta?.chains.length ? (
        <div className="approval-block-meta">
          {record.scanMeta.chains.map((chain) => (
            <span key={chain.chainId}>
              {chain.chainName}: blocks {formatBlockNumber(chain.scannedFromBlock)}-
              {formatBlockNumber(chain.scannedToBlock)}
              {chain.partial ? " (partial)" : chain.fromCache ? " (cached)" : ""}
            </span>
          ))}
          {chainStats(record).map((chain) => (
            <span key={`${chain.chainId}-stats`}>
              {chain.chainName}: {chain.fetched} approvals, {chain.high} high, {chain.medium} medium, {chain.low} low
            </span>
          ))}
        </div>
      ) : null}

      <div className="approval-table-wrap">
        <table className="approval-detail-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Chain</th>
              <th>Type</th>
              <th>Spender</th>
              <th>Allowance</th>
              <th>Risk level</th>
              <th>On-chain facts</th>
              <th>Batch notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map(({ entry, item, key }) => (
                <ApprovalTableRow entry={entry} item={item} key={key} />
              ))
            ) : (
              <tr>
                <td colSpan={8}>No active approvals were found for this scan.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ModalActions>
        <Button onClick={onClose} type="button" variant="secondary">
          Close
        </Button>
      </ModalActions>
    </Modal>
  );
}

function ApprovalTableRow({
  entry,
  item
}: {
  entry: ApprovalEntry | undefined;
  item: ScanItemStatus | undefined;
}) {
  const tone = riskTone(item);
  const spender = item?.spender ?? entry?.spender ?? "";

  return (
    <tr>
      <td>
        <strong>{entry?.symbol ?? "TOKEN"}</strong>
        <span>{entry?.name || item?.token || "Unknown token"}</span>
      </td>
      <td>{entry?.chainName ?? (item ? String(item.chainId) : "-")}</td>
      <td>{entry?.standard?.toUpperCase() ?? readableMetadata(item?.status ?? "pending")}</td>
      <td>
        {entry?.explorerSpenderUrl ? (
          <a href={entry.explorerSpenderUrl} target="_blank" rel="noreferrer">
            {formatAddress(spender)}
          </a>
        ) : (
          formatAddress(spender)
        )}
      </td>
      <td>{entry?.isUnlimited ? "Unlimited" : entry?.allowance ?? "Unknown"}</td>
      <td>
        <span className={`approval-verdict-pill tone-${tone}`}>
          {riskLabel(item)}
        </span>
      </td>
      <td>{factLabel(item?.jsonFacts)}</td>
      <td>{factLabel(item?.webFindings)}</td>
    </tr>
  );
}
