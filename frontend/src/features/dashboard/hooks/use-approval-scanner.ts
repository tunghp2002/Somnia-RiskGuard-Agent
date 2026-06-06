"use client";

import { id as keccakId } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  agentApi,
  AgentApiError,
  type ApprovalEntry,
  type ScanChainSummary,
  type ScanStatus
} from "@/lib/agent-api";
import {
  ensureBrowserChain,
  sendBrowserTransaction,
  waitForBrowserReceipt
} from "@/lib/wallet";

const SCAN_REQUESTED_TOPIC = keccakId("ScanRequested(uint256,address,uint256,uint256)");
const MAX_ITEMS_PER_SCAN = 20;
const HISTORY_LIMIT = 20;
const STORAGE_PREFIX = "riskguard.approval-scans";

export interface ApprovalAnalysisRecord {
  id: string;
  walletAddress: string;
  createdAt: string;
  updatedAt: string;
  chainIds: number[];
  chainNames: string[];
  approvals: ApprovalEntry[];
  scanStatus: ScanStatus | null;
  status: "analyzing" | "complete" | "empty" | "timeout";
  limitApplied?: boolean;
  note?: string;
}

export interface ApprovalScannerState {
  chains: ScanChainSummary[];
  selectedChainIds: number[];
  approvals: ApprovalEntry[];
  analyzedAt: string | null;
  history: ApprovalAnalysisRecord[];
  listLoading: boolean;
  analyzing: boolean;
  polling: boolean;
  scanStatus: ScanStatus | null;
  error: string | null;
  note: string | null;
}

export interface ApprovalScannerActions {
  toggleChain: (chainId: number) => void;
  loadApprovals: () => Promise<void>;
  analyze: () => Promise<void>;
}

function approvalKey(entry: { chainId: number; token: string; spender: string }): string {
  return `${entry.chainId}:${entry.token.toLowerCase()}:${entry.spender.toLowerCase()}`;
}

function chainIdToHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

function createRecordId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function storageKey(walletAddress: string): string {
  return `${STORAGE_PREFIX}:${walletAddress.toLowerCase()}`;
}

function readStoredHistory(walletAddress: string | undefined): ApprovalAnalysisRecord[] {
  if (!walletAddress || typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey(walletAddress));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is ApprovalAnalysisRecord =>
            Boolean(item && typeof item === "object" && item.status !== "error")
          )
          .slice(0, HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function writeStoredHistory(walletAddress: string | undefined, history: ApprovalAnalysisRecord[]) {
  if (!walletAddress || typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    storageKey(walletAddress),
    JSON.stringify(history.slice(0, HISTORY_LIMIT))
  );
}

function messageFromError(error: unknown): string {
  if (error instanceof AgentApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

export function useApprovalScanner(
  walletAddress: string | undefined,
  somniaChainId: number | undefined
): { state: ApprovalScannerState; actions: ApprovalScannerActions } {
  const [chains, setChains] = useState<ScanChainSummary[]>([]);
  const [selectedChainIds, setSelectedChainIds] = useState<number[]>([]);
  const [approvals, setApprovals] = useState<ApprovalEntry[]>([]);
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<ApprovalAnalysisRecord[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [polling, setPolling] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const supported = await agentApi.getApprovalChains();
        if (!active) {
          return;
        }
        setChains(supported);
        // Default-select the highest-priority chain (Somnia is priority 0).
        setSelectedChainIds((current) =>
          current.length > 0 ? current : supported.slice(0, 1).map((chain) => chain.chainId)
        );
      } catch (caught) {
        if (active) {
          const message = messageFromError(caught);
          setError(message);
          toast.error("Approval scanner unavailable", {
            description: message
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setHistory(readStoredHistory(walletAddress));
  }, [walletAddress]);

  const updateHistory = useCallback((
    updater: (current: ApprovalAnalysisRecord[]) => ApprovalAnalysisRecord[]
  ) => {
    setHistory((current) => {
      const next = updater(current).slice(0, HISTORY_LIMIT);
      writeStoredHistory(walletAddress, next);
      return next;
    });
  }, [walletAddress]);

  const toggleChain = useCallback((chainId: number) => {
    setSelectedChainIds((current) =>
      current.includes(chainId)
        ? current.filter((id) => id !== chainId)
        : [...current, chainId]
    );
  }, []);

  const loadApprovals = useCallback(async () => {
    if (!walletAddress) {
      const message = "Connect a wallet to scan approvals.";
      setError(message);
      toast.error("Approval scan failed", {
        description: message
      });
      return;
    }
    if (selectedChainIds.length === 0) {
      const message = "Select at least one chain.";
      setError(message);
      toast.error("Approval scan failed", {
        description: message
      });
      return;
    }

    setError(null);
    setNote(null);
    setListLoading(true);
    setScanStatus(null);
    try {
      const result = await agentApi.listApprovals(walletAddress, selectedChainIds);
      setApprovals(result.approvals);
      if (result.approvals.length === 0) {
        setNote("No active approvals found on the selected chains.");
      }
    } catch (caught) {
      const message = messageFromError(caught);
      setError(message);
      toast.error("Approval scan failed", {
        description: message
      });
    } finally {
      setListLoading(false);
    }
  }, [walletAddress, selectedChainIds]);

  const pollScan = useCallback(async (scanId: number, recordId: string) => {
    setPolling(true);
    const deadline = Date.now() + 180_000;
    try {
      // eslint-disable-next-line no-constant-condition
      while (Date.now() < deadline) {
        const status = await agentApi.getApprovalScanStatus(scanId);
        const now = new Date().toISOString();
        setScanStatus(status);
        setAnalyzedAt(now);
        updateHistory((current) =>
          current.map((record) =>
            record.id === recordId
              ? {
                  ...record,
                  scanStatus: status,
                  status: status.complete ? "complete" : "analyzing",
                  updatedAt: now
                }
              : record
          )
        );
        if (status.complete) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 4_000));
      }
      setNote("Risk analysis is still running on-chain. Results will update as agents respond.");
      updateHistory((current) =>
        current.map((record) =>
          record.id === recordId
            ? {
                ...record,
                status: "timeout",
                updatedAt: new Date().toISOString()
              }
            : record
        )
      );
    } finally {
      setPolling(false);
    }
  }, [updateHistory]);

  const analyze = useCallback(async () => {
    if (!walletAddress) {
      const message = "Connect a wallet to analyze approvals.";
      setError(message);
      toast.error("Approval analysis failed", {
        description: message
      });
      return;
    }
    if (selectedChainIds.length === 0) {
      const message = "Select at least one chain.";
      setError(message);
      toast.error("Approval analysis failed", {
        description: message
      });
      return;
    }

    setError(null);
    setNote(null);
    setAnalyzing(true);
    setListLoading(true);
    setScanStatus(null);
    try {
      const prepared = await agentApi.prepareApprovalAnalysis({
        walletAddress,
        chainIds: selectedChainIds
      });
      setApprovals(prepared.approvals);
      setListLoading(false);

      if (prepared.approvals.length === 0) {
        const now = new Date().toISOString();
        const record: ApprovalAnalysisRecord = {
          id: createRecordId(),
          walletAddress,
          createdAt: now,
          updatedAt: now,
          chainIds: selectedChainIds,
          chainNames: chains
            .filter((chain) => selectedChainIds.includes(chain.chainId))
            .map((chain) => chain.name),
          approvals: [],
          scanStatus: null,
          status: "empty",
          note: "No active approvals found on the selected chains."
        };
        updateHistory((current) => [record, ...current]);
        setNote("No active approvals found on the selected chains.");
        setAnalyzedAt(now);
        return;
      }

      if (!prepared.scannerAddress || !prepared.calldata || !prepared.value) {
        throw new Error("Approval analysis was not prepared.");
      }

      if (somniaChainId) {
        await ensureBrowserChain(chainIdToHex(somniaChainId));
      }

      const txHash = await sendBrowserTransaction({
        to: prepared.scannerAddress,
        data: prepared.calldata,
        value: prepared.value
      });

      const receipt = await waitForBrowserReceipt(txHash);
      const scannerAddress = prepared.scannerAddress.toLowerCase();
      const scanLog = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === scannerAddress &&
          log.topics[0]?.toLowerCase() === SCAN_REQUESTED_TOPIC.toLowerCase()
      );
      const scanIdTopic = scanLog?.topics[1];
      if (!scanIdTopic) {
        throw new Error("Scan transaction did not emit a scan id.");
      }
      const scanId = Number(BigInt(scanIdTopic));
      const now = new Date().toISOString();
      const record: ApprovalAnalysisRecord = {
        id: createRecordId(),
        walletAddress,
        createdAt: now,
        updatedAt: now,
        chainIds: selectedChainIds,
        chainNames: chains
          .filter((chain) => selectedChainIds.includes(chain.chainId))
          .map((chain) => chain.name),
        approvals: prepared.approvals,
        scanStatus: null,
        status: "analyzing",
        limitApplied: prepared.approvals.length > MAX_ITEMS_PER_SCAN
      };
      updateHistory((current) => [record, ...current]);
      setAnalyzedAt(now);
      await pollScan(scanId, record.id);
    } catch (caught) {
      const message = messageFromError(caught);
      setError(message);
      toast.error("Approval analysis failed", {
        description: message
      });
    } finally {
      setAnalyzing(false);
      setListLoading(false);
    }
  }, [
    chains,
    selectedChainIds,
    somniaChainId,
    pollScan,
    updateHistory,
    walletAddress
  ]);

  return {
    state: {
      chains,
      selectedChainIds,
      approvals,
      analyzedAt,
      history,
      listLoading,
      analyzing,
      polling,
      scanStatus,
      error,
      note
    },
    actions: { toggleChain, loadApprovals, analyze }
  };
}

export { approvalKey };
