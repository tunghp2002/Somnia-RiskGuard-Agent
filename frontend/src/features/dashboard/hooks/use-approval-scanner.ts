"use client";

import { id as keccakId } from "ethers";
import { useCallback, useEffect, useState } from "react";

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

export interface ApprovalScannerState {
  chains: ScanChainSummary[];
  selectedChainIds: number[];
  approvals: ApprovalEntry[];
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
          setError(messageFromError(caught));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const toggleChain = useCallback((chainId: number) => {
    setSelectedChainIds((current) =>
      current.includes(chainId)
        ? current.filter((id) => id !== chainId)
        : [...current, chainId]
    );
  }, []);

  const loadApprovals = useCallback(async () => {
    if (!walletAddress) {
      setError("Connect a wallet to scan approvals.");
      return;
    }
    if (selectedChainIds.length === 0) {
      setError("Select at least one chain.");
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
      setError(messageFromError(caught));
    } finally {
      setListLoading(false);
    }
  }, [walletAddress, selectedChainIds]);

  const pollScan = useCallback(async (scanId: number) => {
    setPolling(true);
    const deadline = Date.now() + 180_000;
    try {
      // eslint-disable-next-line no-constant-condition
      while (Date.now() < deadline) {
        const status = await agentApi.getApprovalScanStatus(scanId);
        setScanStatus(status);
        if (status.complete) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 4_000));
      }
      setNote("Risk analysis is still running on-chain. Results will update as agents respond.");
    } finally {
      setPolling(false);
    }
  }, []);

  const analyze = useCallback(async () => {
    if (!walletAddress) {
      setError("Connect a wallet to analyze approvals.");
      return;
    }
    if (approvals.length === 0) {
      setError("Scan approvals first.");
      return;
    }

    setError(null);
    setNote(null);
    setAnalyzing(true);
    try {
      const selected = approvals.slice(0, MAX_ITEMS_PER_SCAN);
      if (approvals.length > MAX_ITEMS_PER_SCAN) {
        setNote(`Analyzing the first ${MAX_ITEMS_PER_SCAN} approvals (batch limit).`);
      }

      const prepared = await agentApi.prepareApprovalScan({
        walletAddress,
        approvals: selected.map((entry) => ({
          chainId: entry.chainId,
          token: entry.token,
          spender: entry.spender,
          symbol: entry.symbol,
          standard: entry.standard,
          allowance: entry.allowance,
          isUnlimited: entry.isUnlimited
        }))
      });

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
      await pollScan(scanId);
    } catch (caught) {
      setError(messageFromError(caught));
    } finally {
      setAnalyzing(false);
    }
  }, [walletAddress, approvals, somniaChainId, pollScan]);

  return {
    state: {
      chains,
      selectedChainIds,
      approvals,
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
