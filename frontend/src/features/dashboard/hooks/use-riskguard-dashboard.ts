"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  agentApi,
  type AuditEvent,
  type DemoScenarioResult,
  type HeartbeatStatus,
  type Mode,
  type PortfolioSnapshot,
  type PublicChainMetadata,
  type Readiness,
  type RewardStatus,
  type RiskSnapshot,
  type TelegramConnectSession
} from "@/lib/agent-api";
import {
  connectBrowserWallet,
  disconnectBrowserWallet,
  restoreBrowserWallet,
  signWalletMessage,
  subscribeBrowserWalletChanges,
  type BrowserWalletState
} from "@/lib/wallet";
import type { AccountStatus, DashboardSection, Notice, RiskTone } from "../types";
import { durationToSeconds, errorMessage, isSimulationEvent, readableMetadata } from "../utils";

export function useRiskGuardDashboard() {
  const [activeSection, setActiveSection] = useState<DashboardSection>("overview");
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>("restoring");
  const [wallet, setWallet] = useState<BrowserWalletState | null>(null);
  const [demoWalletAddress, setDemoWalletAddress] = useState<string>();
  const [mode, setMode] = useState<Mode>("simulation");
  const [publicChain, setPublicChain] = useState<PublicChainMetadata | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [risk, setRisk] = useState<RiskSnapshot | null>(null);
  const [heartbeat, setHeartbeat] = useState<HeartbeatStatus | null>(null);
  const [rewards, setRewards] = useState<RewardStatus | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [telegramSession, setTelegramSession] = useState<TelegramConnectSession | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const loadRequestRef = useRef(0);

  const activeWalletAddress = mode === "simulation" ? demoWalletAddress : wallet?.address;
  const guardianReady = Boolean(readiness?.agentWallet.ready && readiness.monitoredWallet.ready);
  const riskScore = risk?.score ?? 0;
  const riskTone: RiskTone = riskScore >= 75 ? "bad" : riskScore >= 50 ? "warn" : "ok";

  const receipts = useMemo(() => {
    const fromAudit = events.map((event) => ({
      id: event.auditEventId,
      title: event.eventType.replaceAll(".", " "),
      status: event.status,
      detail: readableMetadata(event.metadata),
      createdAt: event.createdAt
    }));
    const latestClaim = rewards?.latestClaim
      ? [{
        id: rewards.latestClaim.createdAt,
        title: `reward ${rewards.latestClaim.status}`,
        status: rewards.latestClaim.status,
        detail: rewards.latestClaim.reason ?? `${rewards.latestClaim.protocol} ${rewards.latestClaim.rewardToken}`,
        createdAt: rewards.latestClaim.createdAt
      }]
      : [];

    return [...latestClaim, ...fromAudit].slice(0, 8);
  }, [events, rewards]);

  const clearWalletScopedState = useCallback(() => {
    setPortfolio(null);
    setRisk(null);
    setHeartbeat(null);
    setRewards(null);
    setEvents([]);
    setTelegramSession(null);
  }, []);

  const loadData = useCallback(async () => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setLoading(true);
    try {
      const walletAddress = activeWalletAddress;
      const [
        publicChainResult,
        readinessResult,
        portfolioResult,
        riskResult,
        healthResult,
        eventsResult,
        heartbeatResult,
        rewardsResult
      ] = await Promise.allSettled([
        agentApi.getPublicChain(),
        agentApi.getReadiness(),
        walletAddress || mode === "simulation" ? agentApi.getPortfolio(walletAddress) : Promise.resolve(null),
        walletAddress || mode === "simulation" ? agentApi.getRisk(walletAddress) : Promise.resolve(null),
        agentApi.getHealth(),
        agentApi.getAuditEvents(20),
        walletAddress ? agentApi.getHeartbeat(walletAddress) : Promise.resolve(null),
        walletAddress ? agentApi.getRewards(walletAddress) : Promise.resolve(null)
      ]);
      const failedReads: string[] = [];

      if (requestId !== loadRequestRef.current) {
        return;
      }

      if (publicChainResult.status === "fulfilled") {
        setPublicChain(publicChainResult.value);
      } else {
        failedReads.push("public chain");
      }
      if (readinessResult.status === "fulfilled") {
        setReadiness(readinessResult.value);
      }

      if (portfolioResult.status === "fulfilled") {
        const nextPortfolio = mode === "testnet" && portfolioResult.value?.source === "demo"
          ? null
          : portfolioResult.value;
        setPortfolio(nextPortfolio);
      } else {
        failedReads.push("portfolio");
        setPortfolio(null);
      }
      if (riskResult.status === "fulfilled") {
        setRisk(riskResult.value);
      } else {
        failedReads.push("risk");
        setRisk(null);
      }
      if (healthResult.status === "fulfilled") {
        setHealth(healthResult.value);
      } else {
        failedReads.push("health");
        setHealth({ ok: false, subsystem: "agent-api" });
      }
      if (eventsResult.status === "fulfilled") {
        const nextEvents = mode === "testnet"
          ? eventsResult.value.events.filter((event) => !isSimulationEvent(event))
          : eventsResult.value.events;
        setEvents(nextEvents);
      } else {
        failedReads.push("audit events");
        setEvents([]);
      }
      if (heartbeatResult.status === "fulfilled") {
        setHeartbeat(heartbeatResult.value);
      } else {
        failedReads.push("heartbeat");
        setHeartbeat(null);
      }
      if (rewardsResult.status === "fulfilled") {
        setRewards(rewardsResult.value);
      } else {
        failedReads.push("rewards");
        setRewards(null);
      }

      if (failedReads.length > 0) {
        setNotice({
          tone: "warn",
          message: `Some agent API reads are unavailable: ${failedReads.join(", ")}.`
        });
      }
    } catch (error) {
      if (requestId !== loadRequestRef.current) {
        return;
      }
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, [activeWalletAddress, mode]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let mounted = true;

    restoreBrowserWallet()
      .then((restored) => {
        if (!mounted) {
          return;
        }

        setWallet(restored);
        setAccountStatus(restored ? "connected" : "disconnected");
      })
      .catch(() => {
        if (!mounted) {
          return;
        }

        setAccountStatus("error");
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => subscribeBrowserWalletChanges(() => {
    loadRequestRef.current += 1;
    restoreBrowserWallet()
      .then((restored) => {
        setWallet(restored);
        setAccountStatus(restored ? "connected" : "expired");
        clearWalletScopedState();
      })
      .catch(() => {
        setWallet(null);
        setAccountStatus("error");
        clearWalletScopedState();
      });
  }), [clearWalletScopedState]);

  useEffect(() => {
    if (!telegramSession || telegramSession.status !== "waiting") {
      return;
    }

    const timer = setInterval(() => {
      void agentApi.getTelegramConnectStatus(telegramSession.walletAddress)
        .then((session) => {
          setTelegramSession(session);
          if (session.status === "connected") {
            setNotice({ tone: "ok", message: "Telegram is connected." });
            void loadData();
          } else if (session.status === "expired") {
            setNotice({ tone: "warn", message: "Telegram Connect code expired. Start a new connection." });
          }
        })
        .catch(() => undefined);
    }, 3_000);

    return () => clearInterval(timer);
  }, [loadData, telegramSession]);

  async function handleConnectWallet() {
    setActionLoading("wallet");
    try {
      const nextWallet = await connectBrowserWallet();
      setWallet(nextWallet);
      setAccountStatus("connected");
      setNotice({ tone: "ok", message: "Browser wallet connected. Backend agent wallet remains separate." });
    } catch (error) {
      setAccountStatus("error");
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDisconnectWallet() {
    setActionLoading("wallet");
    setAccountStatus("disconnecting");
    try {
      await disconnectBrowserWallet();
      setWallet(null);
      loadRequestRef.current += 1;
      clearWalletScopedState();
      setAccountStatus("disconnected");
      setNotice({ tone: "ok", message: "Browser wallet disconnected from this dashboard." });
    } catch (error) {
      setAccountStatus("error");
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRegisterWallet() {
    if (!wallet) {
      setNotice({ tone: "warn", message: "Connect a browser wallet before registering a monitored wallet." });
      return;
    }

    setActionLoading("register");
    try {
      const message = `Register Somnia RiskGuard monitored wallet: ${wallet.address}`;
      const signature = await signWalletMessage(message);
      await agentApi.registerWallet({ walletAddress: wallet.address, message, signature });
      setNotice({ tone: "ok", message: "Monitored wallet registered with signed proof." });
      await loadData();
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleHeartbeatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet) {
      setNotice({ tone: "warn", message: "Connect a browser wallet before configuring heartbeat." });
      return;
    }

    const form = new FormData(event.currentTarget);
    const beneficiaryAddresses = form
      .getAll("beneficiaryAddress")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const shareTotal = form
      .getAll("sharePercent")
      .reduce((total, value) => total + Number(value || 0), 0);
    const intervalSeconds = Number(form.get("intervalSeconds") ?? durationToSeconds(form, "interval", 30));
    const graceSeconds = Number(form.get("graceSeconds") ?? durationToSeconds(form, "grace", 7));
    const timelockSeconds = Number(form.get("timelockSeconds") ?? durationToSeconds(form, "timelock", 2));

    if (beneficiaryAddresses.length === 0) {
      setNotice({ tone: "warn", message: "Add at least one recipient wallet address." });
      return;
    }

    if (Math.abs(shareTotal - 100) > 0.001) {
      setNotice({ tone: "warn", message: "Recipient shares must add up to exactly 100%." });
      return;
    }

    if ([intervalSeconds, graceSeconds, timelockSeconds].some((seconds) => seconds < 86_400)) {
      setNotice({ tone: "warn", message: "Each timing rule must be at least 1 day to match the contract." });
      return;
    }

    const primaryBeneficiaryAddress = beneficiaryAddresses[0] ?? "";

    setActionLoading("heartbeat");
    try {
      const message = `Configure heartbeat: ${wallet.address}`;
      const signature = await signWalletMessage(message);
      await agentApi.configureHeartbeat({
        walletAddress: wallet.address,
        beneficiaryAddress: primaryBeneficiaryAddress,
        intervalSeconds,
        graceSeconds,
        timelockSeconds,
        message,
        signature
      });
      setNotice({
        tone: "ok",
        message: beneficiaryAddresses.length > 1
          ? "Inheritance plan saved for monitoring. Current agent API stores the primary recipient; the full weighted list is ready for the contract flow."
          : "Inheritance heartbeat settings saved with signed proof."
      });
      await loadData();
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTelegramConnect() {
    const walletAddress = activeWalletAddress;
    if (!walletAddress) {
      setNotice({ tone: "warn", message: "Connect or seed a wallet before starting Telegram Connect." });
      return;
    }

    setActionLoading("telegram");
    try {
      const session = await agentApi.startTelegramConnect({ walletAddress });
      setTelegramSession(session);
      setNotice({ tone: "ok", message: "Telegram Connect started. Send the one-time code to the bot." });
      await loadData();
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRewardsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const walletAddress = activeWalletAddress;
    if (!walletAddress) {
      setNotice({ tone: "warn", message: "Connect or seed a wallet before configuring rewards." });
      return;
    }

    const form = new FormData(event.currentTarget);
    setActionLoading("rewards");
    try {
      await agentApi.configureRewards({
        walletAddress,
        autoClaimEnabled: form.get("autoClaimEnabled") === "on",
        minRewardValueUsd: Number(form.get("minRewardValueUsd") ?? 1),
        maxClaimGasUsd: Number(form.get("maxClaimGasUsd") ?? 2)
      });
      setNotice({ tone: "ok", message: "Reward policy settings saved." });
      await loadData();
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRunDemo(scenario: DemoScenarioResult["scenario"]) {
    if (mode !== "simulation") {
      setNotice({ tone: "warn", message: "Demo scenarios are disabled in Testnet mode." });
      return;
    }

    setActionLoading(scenario);
    try {
      const result = await agentApi.runDemoScenario({ scenario });
      setDemoWalletAddress(result.walletAddress);
      setNotice({ tone: "ok", message: `${scenario.replaceAll("_", " ")} seeded in simulation mode.` });
      await loadData();
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAnalyzeRisk() {
    setActionLoading("risk-analysis");
    try {
      const nextRisk = await agentApi.analyzeRisk(
        activeWalletAddress ? { walletAddress: activeWalletAddress } : {}
      );
      setRisk(nextRisk);
      setNotice({ tone: "ok", message: `${nextRisk.provider} generated a fresh risk analysis.` });
      await loadData();
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  return {
    state: {
      activeSection,
      accountStatus,
      actionLoading,
      guardianReady,
      health,
      heartbeat,
      loading,
      mobileMoreOpen,
      mode,
      notice,
      portfolio,
      publicChain,
      readiness,
      receipts,
      rewards,
      risk,
      riskScore,
      riskTone,
      telegramSession,
      wallet,
      activeWalletAddress
    },
    actions: {
      handleAnalyzeRisk,
      handleConnectWallet,
      handleDisconnectWallet,
      handleHeartbeatSubmit,
      handleRegisterWallet,
      handleRewardsSubmit,
      handleRunDemo,
      handleTelegramConnect,
      loadData,
      setActiveSection,
      setMobileMoreOpen,
      setMode
    }
  };
}
