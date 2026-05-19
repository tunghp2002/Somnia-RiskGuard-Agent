"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Cpu,
  FileText,
  KeyRound,
  Link2,
  Loader2,
  Menu,
  RadioTower,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  Wallet,
  XCircle
} from "lucide-react";

import {
  agentApi,
  AgentApiError,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GuardianSettings, InheritanceSettings } from "@/features/settings/guardian-settings";

type Notice = { tone: "ok" | "warn" | "bad"; message: string };
type DashboardSection = "overview" | "setup" | "inheritance" | "risk" | "heartbeat" | "rewards" | "receipts" | "demo" | "health";
type AccountStatus = "restoring" | "connected" | "disconnected" | "disconnecting" | "expired" | "error";

const navItems: Array<{ id: DashboardSection; label: string; icon: ReactNode; primaryMobile?: boolean }> = [
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

const sectionDescriptions: Record<DashboardSection, string> = {
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

const scenarios: Array<{
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

function formatAddress(address?: string) {
  if (!address) {
    return "not set";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDate(value?: string) {
  if (!value) {
    return "not available";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatUsd(value?: string) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0);
}

function classForStatus(status?: string) {
  if (status === "succeeded" || status === "healthy" || status === "beneficiary_available") {
    return "status-ok";
  }

  if (status === "skipped" || status === "reminder_due" || status === "timelock_pending") {
    return "status-warn";
  }

  if (status === "failed" || status === "denied" || status === "expired") {
    return "status-bad";
  }

  return "status-neutral";
}

function errorMessage(error: unknown) {
  if (error instanceof AgentApiError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Request failed";
}

function hasOkFlag(value: unknown): value is { ok: boolean } {
  return Boolean(value && typeof value === "object" && "ok" in value);
}

function durationToSeconds(form: FormData, prefix: "interval" | "grace" | "timelock", fallbackDays: number) {
  const days = Number(form.get(`${prefix}Days`) ?? fallbackDays);
  const hours = Number(form.get(`${prefix}Hours`) ?? 0);
  const safeDays = Number.isFinite(days) ? Math.max(0, days) : fallbackDays;
  const safeHours = Number.isFinite(hours) ? Math.max(0, hours) : 0;

  return Math.round((safeDays * 24 * 60 * 60) + (safeHours * 60 * 60));
}

export function RiskGuardDashboard() {
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

  const activeWalletAddress = mode === "simulation"
    ? demoWalletAddress
    : wallet?.address;
  const guardianReady = Boolean(readiness?.agentWallet.ready && readiness.monitoredWallet.ready);
  const riskScore = risk?.score ?? 0;
  const riskTone = riskScore >= 75 ? "bad" : riskScore >= 50 ? "warn" : "ok";

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

  return (
    <main className="rg-app-shell">
      <aside className="rg-sidebar" aria-label="Primary sections">
        <div className="sidebar-brand"><Shield size={18} /> RiskGuard</div>
        <nav>
          {navItems.map((item) => (
            <Button
              className={activeSection === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              type="button"
              variant="ghost"
            >
              {item.icon}
              {item.label}
            </Button>
          ))}
        </nav>
        <div className="sidebar-meta">
          <span>{publicChain?.name ?? "Public chain loading"}</span>
          <Badge>{mode === "simulation" ? "Simulation" : "Somnia Testnet"}</Badge>
        </div>
      </aside>

      <div className="rg-shell">
        <header className="rg-header">
          <div>
            <div className="rg-kicker"><Shield size={14} /> Somnia RiskGuard AgentCore</div>
            <h1>{navItems.find((item) => item.id === activeSection)?.label ?? "Overview"}</h1>
            <p>{sectionDescriptions[activeSection]}</p>
          </div>
          <div className="rg-header-actions">
            <div className="account-status" aria-label="Account state">
              <span>{accountStatus}</span>
              <strong>{wallet ? formatAddress(wallet.address) : "no browser wallet"}</strong>
            </div>
            <div className="mode-switch" aria-label="Reality mode">
              <Button
                className={mode === "simulation" ? "active" : ""}
                onClick={() => setMode("simulation")}
                type="button"
                variant="ghost"
              >
                Simulation
              </Button>
              <Button
                className={mode === "testnet" ? "active" : ""}
                onClick={() => setMode("testnet")}
                type="button"
                variant="ghost"
              >
                Testnet
              </Button>
            </div>
            <Button
              className="primary-button"
              onClick={wallet ? handleDisconnectWallet : handleConnectWallet}
              type="button"
              variant="primary"
            >
              {actionLoading === "wallet"
                ? <Loader2 className="spin" size={16} />
                : wallet ? <XCircle size={16} /> : <Wallet size={16} />}
              {wallet ? "Disconnect" : "Connect Wallet"}
            </Button>
          </div>
        </header>

        {notice ? <div className={`notice ${notice.tone}`}>{notice.message}</div> : null}

        {activeSection === "overview" ? (
          <section className="rg-overview">
            <GuardianStatus ready={guardianReady} readiness={readiness} wallet={wallet} mode={mode} />
            <RiskScore
              actionLoading={actionLoading}
              onAnalyzeRisk={handleAnalyzeRisk}
              score={riskScore}
              tone={riskTone}
              risk={risk}
            />
            <HeartbeatPanel heartbeat={heartbeat} />
            <RewardPanel rewards={rewards} />
          </section>
        ) : null}

        <section className="rg-grid">
          {activeSection === "risk" ? (
            <>
              <RiskScore
                actionLoading={actionLoading}
                onAnalyzeRisk={handleAnalyzeRisk}
                score={riskScore}
                tone={riskTone}
                risk={risk}
              />
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
            </>
          ) : null}

          {activeSection === "setup" ? (
            <section className="panel">
              <PanelHeading icon={<KeyRound size={17} />} title="Configuration" action="signed where required" />
              <GuardianSettings
                actionLoading={actionLoading}
                telegramSession={telegramSession}
                onRegisterWallet={handleRegisterWallet}
                onRewardsSubmit={handleRewardsSubmit}
                onTelegramConnect={handleTelegramConnect}
              />
            </section>
          ) : null}

          {activeSection === "inheritance" ? (
            <section className="inheritance-panel">
              <InheritanceSettings
                actionLoading={actionLoading}
                walletAddress={wallet?.address ?? activeWalletAddress}
                onHeartbeatSubmit={handleHeartbeatSubmit}
              />
            </section>
          ) : null}

          {activeSection === "demo" ? (
            <section className="panel demo-panel">
              <PanelHeading icon={<Sparkles size={17} />} title="Demo Scenario Control" action={mode} />
              <p className="muted">Deterministic simulation states are seeded through the agent API and then shown from the same read models as live status.</p>
              <div className="scenario-grid">
                {scenarios.map((scenario) => (
                  <Button
                    className="scenario-button"
                    disabled={mode !== "simulation" || actionLoading === scenario.id}
                    key={scenario.id}
                    onClick={() => void handleRunDemo(scenario.id)}
                    type="button"
                    variant="secondary"
                  >
                    <span>{scenario.label}</span>
                    <small>{actionLoading === scenario.id ? "Running..." : scenario.detail}</small>
                  </Button>
                ))}
              </div>
            </section>
          ) : null}

          {activeSection === "health" ? (
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
          ) : null}

          {activeSection === "heartbeat" ? <HeartbeatPanel heartbeat={heartbeat} /> : null}
          {activeSection === "rewards" ? <RewardPanel rewards={rewards} /> : null}

          {activeSection === "receipts" ? (
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
          ) : null}
        </section>

        <section className="mobile-bottom-nav" aria-label="Mobile sections">
          {navItems.filter((item) => item.primaryMobile).map((item) => (
            <Button
              className={activeSection === item.id ? "active" : ""}
              key={item.id}
              onClick={() => {
                setActiveSection(item.id);
                setMobileMoreOpen(false);
              }}
              type="button"
              variant="ghost"
            >
              {item.icon}
              <span>{item.label}</span>
            </Button>
          ))}
          <Button
            className={navItems.some((item) => !item.primaryMobile && item.id === activeSection) ? "active" : ""}
            onClick={() => setMobileMoreOpen((open) => !open)}
            type="button"
            variant="ghost"
          >
            <Menu size={17} />
            <span>More</span>
          </Button>
        </section>

        {mobileMoreOpen ? (
          <section className="mobile-more-sheet" aria-label="More sections">
            {navItems.filter((item) => !item.primaryMobile).map((item) => (
              <Button
                className={activeSection === item.id ? "active" : ""}
                key={item.id}
                onClick={() => {
                  setActiveSection(item.id);
                  setMobileMoreOpen(false);
                }}
                type="button"
                variant="secondary"
              >
                {item.icon}
                {item.label}
              </Button>
            ))}
          </section>
        ) : null}

        <Button className="floating-refresh" onClick={() => void loadData()} type="button" variant="secondary">
          <RefreshCw size={16} /> Refresh
        </Button>
      </div>
    </main>
  );
}

function GuardianStatus({
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

function RiskScore({
  actionLoading,
  onAnalyzeRisk,
  score,
  tone,
  risk
}: {
  actionLoading: string | null;
  onAnalyzeRisk: () => void;
  score: number;
  tone: "ok" | "warn" | "bad";
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

function HeartbeatPanel({ heartbeat }: { heartbeat: HeartbeatStatus | null }) {
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

function RewardPanel({ rewards }: { rewards: RewardStatus | null }) {
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

function PanelHeading({
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

function RoleChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="role-chip">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function HealthRow({
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

function readableMetadata(value: unknown): string {
  if (!value) {
    return "no details";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => readableMetadata(item)).join(", ");
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !key.toLowerCase().includes("signature"))
    .slice(0, 3)
    .map(([key, item]) => `${key}: ${typeof item === "object" ? readableMetadata(item) : String(item)}`);

  return entries.join(" | ") || "no details";
}

function isSimulationEvent(event: AuditEvent): boolean {
  return event.metadata.mode === "simulation";
}
