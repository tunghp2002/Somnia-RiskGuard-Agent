"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  agentApi,
  type AuditEvent,
  type DemoScenarioResult,
  type InheritancePlanStatus,
  type Mode,
  type PortfolioSnapshot,
  type PublicChainMetadata,
  type Readiness,
  type RiskSnapshot,
  type TelegramConnectSession,
  type UserRecord
} from "@/lib/agent-api";
import { cancelInheritancePlan, saveInheritancePlan } from "@/lib/inheritance-registry";
import {
  connectBrowserWallet,
  disconnectBrowserWallet,
  restoreBrowserWallet,
  subscribeBrowserWalletChanges,
  type BrowserWalletState
} from "@/lib/wallet";
import type { AccountStatus, DashboardSection, Notice, RiskTone } from "../types";
import { durationToSeconds, errorMessage, formatAddress, isSimulationEvent, readableMetadata } from "../utils";

const telegramConnectTimeoutMs = 60_000;

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
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [inheritancePlan, setInheritancePlan] = useState<InheritancePlanStatus | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [telegramSession, setTelegramSession] = useState<TelegramConnectSession | null>(null);
  const [userProfile, setUserProfile] = useState<UserRecord | null>(null);
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

    return fromAudit.slice(0, 8);
  }, [events]);

  const clearWalletScopedState = useCallback(() => {
    setPortfolio(null);
    setRisk(null);
    setInheritancePlan(null);
    setEvents([]);
    setTelegramSession(null);
    setUserProfile(null);
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
        inheritancePlanResult,
        eventsResult,
        profileResult
      ] = await Promise.allSettled([
        agentApi.getPublicChain(),
        agentApi.getReadiness(),
        walletAddress || mode === "simulation" ? agentApi.getPortfolio(walletAddress) : Promise.resolve(null),
        walletAddress || mode === "simulation" ? agentApi.getRisk(walletAddress) : Promise.resolve(null),
        agentApi.getHealth(),
        walletAddress && mode === "testnet" ? agentApi.getInheritancePlan(walletAddress) : Promise.resolve(null),
        agentApi.getAuditEvents(20),
        wallet ? agentApi.getUserProfile(wallet.address) : Promise.resolve(null)
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
      if (inheritancePlanResult.status === "fulfilled") {
        setInheritancePlan(inheritancePlanResult.value);
      } else {
        failedReads.push("inheritance plan");
        setInheritancePlan(null);
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
      if (profileResult.status === "fulfilled") {
        setUserProfile(profileResult.value);
      } else {
        failedReads.push("profile");
        setUserProfile(null);
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
  }, [activeWalletAddress, mode, wallet]);

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

    const interval = setInterval(() => {
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
    const timeout = setTimeout(() => {
      setTelegramSession(null);
      setNotice({
        tone: "bad",
        message: "Telegram did not connect in time. Check the bot username and try again."
      });
    }, telegramConnectTimeoutMs);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [loadData, telegramSession?.code, telegramSession?.status, telegramSession?.walletAddress]);

  async function handleConnectWallet() {
    setActionLoading("wallet");
    try {
      const nextWallet = await connectBrowserWallet();
      setWallet(nextWallet);
      setAccountStatus("connected");
      setUserProfile(await agentApi.getUserProfile(nextWallet.address));
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

  async function handleInheritancePlanSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet) {
      setNotice({ tone: "warn", message: "Connect a browser wallet before configuring inheritance." });
      return;
    }

    const registryAddress = publicChain?.contracts.inheritanceRegistry;
    if (!registryAddress) {
      setNotice({ tone: "warn", message: "Inheritance Registry is not deployed/configured for this chain yet." });
      return;
    }

    const form = new FormData(event.currentTarget);
    const beneficiaryAddresses = form.getAll("beneficiaryAddress").map((value) => String(value).trim());
    const sharePercents = form.getAll("sharePercent").map((value) => Number(value || 0));
    const beneficiaries = beneficiaryAddresses
      .map((address, index) => ({ address, sharePercent: sharePercents[index] ?? 0 }))
      .filter((beneficiary) => beneficiary.address);
    const shareTotal = beneficiaries.reduce((total, beneficiary) => total + beneficiary.sharePercent, 0);
    const intervalSeconds = Number(form.get("intervalSeconds") ?? durationToSeconds(form, "interval", 30));
    const graceSeconds = Number(form.get("graceSeconds") ?? durationToSeconds(form, "grace", 0));
    const timelockSeconds = Number(form.get("timelockSeconds") ?? durationToSeconds(form, "timelock", 0));

    if (beneficiaries.length === 0) {
      setNotice({ tone: "warn", message: "Add at least one recipient wallet address." });
      return;
    }

    if (Math.abs(shareTotal - 100) > 0.001) {
      setNotice({ tone: "warn", message: "Recipient shares must add up to exactly 100%." });
      return;
    }

    if (intervalSeconds < 86_400) {
      setNotice({ tone: "warn", message: "Heartbeat renewal window must be at least 1 day." });
      return;
    }

    setActionLoading("inheritance-plan");
    try {
      const txHash = await saveInheritancePlan(registryAddress, {
        beneficiaries,
        heartbeatIntervalSeconds: intervalSeconds,
        gracePeriodSeconds: graceSeconds,
        timelockPeriodSeconds: timelockSeconds
      }, inheritancePlan);
      setNotice({
        tone: "ok",
        message: inheritancePlan?.active
          ? `Inheritance plan updated on-chain: ${formatAddress(txHash)}`
          : `Inheritance plan created on-chain: ${formatAddress(txHash)}`
      });
      await loadData();
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTelegramConnect() {
    const walletAddress = wallet?.address ?? activeWalletAddress;
    if (!walletAddress) {
      setNotice({ tone: "warn", message: "Connect or seed a wallet before starting Telegram Connect." });
      return;
    }

    if (telegramSession?.status === "waiting") {
      window.open(telegramSession.botDeepLink, "_blank", "noopener,noreferrer");
      return;
    }

    setActionLoading("telegram");
    try {
      if (wallet && !userProfile) {
        setUserProfile(await agentApi.updateUserProfile({
          walletAddress: wallet.address,
          displayName: formatAddress(wallet.address)
        }));
      }
      const session = await agentApi.startTelegramConnect({ walletAddress });
      setTelegramSession(session);
      window.open(session.botDeepLink, "_blank", "noopener,noreferrer");
      setNotice({ tone: "ok", message: "Telegram bot opened. Press Start in Telegram to connect." });
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

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!wallet) {
      setNotice({ tone: "warn", message: "Connect a browser wallet before editing your profile." });
      return;
    }

    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();

    if (!displayName) {
      setNotice({ tone: "warn", message: "Display name is required." });
      return;
    }

    setActionLoading("profile");
    try {
      const profile = await agentApi.updateUserProfile({
        walletAddress: wallet.address,
        displayName
      });
      setUserProfile(profile);
      setNotice({ tone: "ok", message: "Profile saved." });
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleInheritancePlanCancel() {
    if (!wallet) {
      setNotice({ tone: "warn", message: "Connect a browser wallet before cancelling inheritance." });
      return;
    }

    const registryAddress = publicChain?.contracts.inheritanceRegistry;
    if (!registryAddress) {
      setNotice({ tone: "warn", message: "Inheritance Registry is not deployed/configured for this chain yet." });
      return;
    }

    if (!inheritancePlan?.active) {
      setNotice({ tone: "warn", message: "No active inheritance plan found for this account." });
      return;
    }

    setActionLoading("inheritance-cancel");
    try {
      const txHash = await cancelInheritancePlan(registryAddress);
      setNotice({ tone: "ok", message: `Inheritance plan cancelled on-chain: ${formatAddress(txHash)}` });
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
      inheritancePlan,
      loading,
      mobileMoreOpen,
      mode,
      notice,
      portfolio,
      publicChain,
      readiness,
      receipts,
      risk,
      riskScore,
      riskTone,
      telegramSession,
      userProfile,
      wallet,
      activeWalletAddress
    },
    actions: {
      handleAnalyzeRisk,
      handleConnectWallet,
      handleDisconnectWallet,
      handleInheritancePlanCancel,
      handleInheritancePlanSubmit,
      handleRunDemo,
      handleTelegramConnect,
      handleProfileSubmit,
      loadData,
      setActiveSection,
      setMobileMoreOpen,
      setMode
    }
  };
}
