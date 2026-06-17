"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { useActiveAccount } from "thirdweb/react";

import {
  agentApi,
  bundledPublicChain,
  type AuditEvent,
  type InheritancePlanStatus,
  type Mode,
  type PortfolioSnapshot,
  type PublicChainMetadata,
  type Readiness,
  type TelegramConnectSession,
  type UserRecord,
} from "@/lib/agent-api";
import {
  cancelInheritancePlan,
  cancelInheritancePlanWithThirdweb,
  saveInheritancePlan,
  saveInheritancePlanWithThirdweb,
} from "@/lib/inheritance-registry";
import {
  estimateNativeTransfer,
  getNativeTransferValidationError,
} from "@/lib/native-transfer";
import {
  configureRiskGuardPolicyWithThirdweb,
  configureTelegramCheckInValidator,
  connectRiskGuardBootstrapSmartAccount,
  connectRiskGuardSmartAccount,
  connectUserPaidThirdwebSmartAccount,
  disableTelegramCheckInValidator,
  readRiskGuardPolicyStatus,
  readTelegramCheckInValidatorStatus,
  type TelegramCheckInValidatorStatus,
} from "@/lib/riskguard-module";
import { SomniaAgentReviewRequestedError } from "@/lib/riskguard-smart-account";
import {
  connectBrowserWallet,
  disconnectBrowserWallet,
  restoreBrowserWallet,
  signWalletMessage,
  subscribeBrowserWalletChanges,
  type BrowserWalletState,
} from "@/lib/wallet";
import { errorMessage } from "@/utils/dashboard";

import {
  buildAccountOptions,
  buildAgentReviewModal,
  buildReceipts,
  buildRiskGuardRules,
  connectWalletFromDashboard,
  connectedTelegramSession,
  openTransaction,
  preserveWaitingTelegramSession,
  readInheritancePlanForm,
  runTelegramConnectFlow,
  saveProfileFromDashboard,
  submitNativeTransferWithFallback,
  telegramConnectTimeoutMs,
  telegramUnlinkMessage,
  transactionNoticeAction,
} from "./use-riskguard-dashboard-helpers";
import { useStoredRiskGuardConfig } from "./use-stored-risk-guard-config";

import type {
  AccountOption,
  BlockscoutAccountScope,
} from "@/lib/blockscout-api";
import type {
  AccountStatus,
  AgentReviewRequestModal,
  DashboardSection,
  Notice,
  NativeTransferEstimate,
  NativeTransferInput,
  RiskGuardConfig,
} from "@/types/dashboard";

export function useRiskGuardDashboard() {
  const thirdwebSmartAccount = useActiveAccount();
  const [activeSection, setActiveSection] =
    useState<DashboardSection>("overview");
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [accountStatus, setAccountStatus] =
    useState<AccountStatus>("restoring");
  const [wallet, setWallet] = useState<BrowserWalletState | null>(null);
  const mode: Mode = "testnet";
  const [publicChain, setPublicChain] = useState<PublicChainMetadata | null>(
    bundledPublicChain,
  );
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [inheritancePlan, setInheritancePlan] =
    useState<InheritancePlanStatus | null>(null);
  const [inheritancePlanLoading, setInheritancePlanLoading] = useState(false);
  const [selectedSmartAccountAddress, setSelectedSmartAccountAddress] =
    useState<string>();
  const [selectedAssetAccountScope, setSelectedAssetAccountScope] =
    useState<BlockscoutAccountScope>("all");
  const [riskGuardConfig, persistRiskGuardConfig] = useStoredRiskGuardConfig();
  const [riskGuardModuleReady, setRiskGuardModuleReady] = useState(false);
  const [telegramCheckInStatus, setTelegramCheckInStatus] =
    useState<TelegramCheckInValidatorStatus | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [telegramSession, setTelegramSession] =
    useState<TelegramConnectSession | null>(null);
  const [userProfile, setUserProfile] = useState<UserRecord | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [agentReviewModal, setAgentReviewModal] =
    useState<AgentReviewRequestModal | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const riskGuardStatusRequestRef = useRef(0);
  const telegramCheckInStatusRequestRef = useRef(0);
  const agentReviewPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSmartAccountAttemptRef = useRef<string | null>(null);

  const activeWalletAddress = wallet?.address;
  const activeInheritanceSmartAccount =
    selectedSmartAccountAddress ??
    thirdwebSmartAccount?.address ??
    inheritancePlan?.smartAccount;
  const guardianReady = Boolean(
    readiness?.sessionKey.ready && readiness.monitoredWallet.ready,
  );
  const riskGuardRules = useMemo(
    () => buildRiskGuardRules(riskGuardConfig, riskGuardModuleReady),
    [riskGuardConfig, riskGuardModuleReady],
  );
  const accountOptions: AccountOption[] = useMemo(
    () => buildAccountOptions(activeInheritanceSmartAccount, activeWalletAddress),
    [activeInheritanceSmartAccount, activeWalletAddress],
  );

  const getActiveRiskGuardSmartAccount = useCallback(async () => {
    if (
      thirdwebSmartAccount &&
      (!selectedSmartAccountAddress ||
        thirdwebSmartAccount.address.toLowerCase() === selectedSmartAccountAddress.toLowerCase())
    ) {
      return thirdwebSmartAccount;
    }

    const account = await connectRiskGuardSmartAccount();
    setSelectedSmartAccountAddress(account.address);
    return account;
  }, [selectedSmartAccountAddress, thirdwebSmartAccount]);

  const getSelectedRiskGuardSmartAccount = useCallback(async (smartAccountAddress: string) => {
    if (thirdwebSmartAccount?.address.toLowerCase() === smartAccountAddress.toLowerCase()) {
      return thirdwebSmartAccount;
    }

    try {
      const account = await connectUserPaidThirdwebSmartAccount(smartAccountAddress);
      setSelectedSmartAccountAddress(account.address);
      return account;
    } catch {
      return null;
    }
  }, [thirdwebSmartAccount]);

  const getSelectedInheritanceSetupAccount = useCallback(async (smartAccountAddress: string) => {
    try {
      const account = await connectUserPaidThirdwebSmartAccount(smartAccountAddress, "default");
      setSelectedSmartAccountAddress(account.address);
      return account;
    } catch {
      return getSelectedRiskGuardSmartAccount(smartAccountAddress);
    }
  }, [getSelectedRiskGuardSmartAccount]);

  const receipts = useMemo(() => buildReceipts(events), [events]);

  const refreshRiskGuardModuleStatus = useCallback(async (smartAccountAddressOverride?: string) => {
    const requestId = riskGuardStatusRequestRef.current + 1;
    riskGuardStatusRequestRef.current = requestId;
    const smartAccountAddress = smartAccountAddressOverride ?? activeInheritanceSmartAccount;
    const approvalStoreAddress = publicChain?.contracts.riskGuardApprovalStore;
    const guardModuleAddress =
      publicChain?.contracts.riskGuardValidatorModule ?? publicChain?.contracts.riskGuardHookModule;

    if (!smartAccountAddress || !approvalStoreAddress || !guardModuleAddress) {
      if (requestId === riskGuardStatusRequestRef.current) {
        setRiskGuardModuleReady(false);
      }
      return;
    }

    try {
      const status = await readRiskGuardPolicyStatus({
        approvalStoreAddress,
        guardModuleAddress,
        smartAccountAddress,
      });

      if (requestId === riskGuardStatusRequestRef.current) {
        setRiskGuardModuleReady(status.ready);
      }
    } catch {
      if (requestId === riskGuardStatusRequestRef.current) {
        setRiskGuardModuleReady(false);
      }
    }
  }, [
    activeInheritanceSmartAccount,
    publicChain?.contracts.riskGuardApprovalStore,
    publicChain?.contracts.riskGuardHookModule,
    publicChain?.contracts.riskGuardValidatorModule,
  ]);

  const refreshTelegramCheckInStatus = useCallback(async (smartAccountAddressOverride?: string) => {
    const requestId = telegramCheckInStatusRequestRef.current + 1;
    telegramCheckInStatusRequestRef.current = requestId;
    const smartAccountAddress = smartAccountAddressOverride ?? activeInheritanceSmartAccount;
    const validatorAddress = publicChain?.contracts.riskGuardCheckInValidatorModule;

    if (!smartAccountAddress || !validatorAddress) {
      if (requestId === telegramCheckInStatusRequestRef.current) {
        setTelegramCheckInStatus(null);
      }
      return;
    }

    try {
      const status = await readTelegramCheckInValidatorStatus({
        smartAccountAddress,
        validatorAddress,
      });

      if (requestId === telegramCheckInStatusRequestRef.current) {
        setTelegramCheckInStatus(status);
      }
    } catch {
      if (requestId === telegramCheckInStatusRequestRef.current) {
        setTelegramCheckInStatus(null);
      }
    }
  }, [
    activeInheritanceSmartAccount,
    publicChain?.contracts.riskGuardCheckInValidatorModule,
  ]);

  const clearWalletScopedState = useCallback(() => {
    setPortfolio(null);
    setInheritancePlan(null);
    setEvents([]);
    setTelegramSession(null);
    setUserProfile(null);
    setRiskGuardModuleReady(false);
    setTelegramCheckInStatus(null);
  }, []);

  const showNotice = useCallback((nextNotice: Notice) => {
    setNotice(nextNotice);
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
        healthResult,
        inheritancePlanResult,
        eventsResult,
        profileResult,
        telegramBindingResult,
      ] = await Promise.allSettled([
        agentApi.getPublicChain(),
        agentApi.getReadiness(),
        walletAddress
          ? agentApi.getPortfolio(walletAddress)
          : Promise.resolve(null),
        agentApi.getHealth(),
        activeInheritanceSmartAccount
          ? agentApi.getInheritancePlan(activeInheritanceSmartAccount)
          : Promise.resolve(null),
        agentApi.getAuditEventSummaries(8),
        wallet
          ? agentApi.getUserProfile(wallet.address)
          : Promise.resolve(null),
        walletAddress
          ? agentApi.getTelegramBinding(walletAddress)
          : Promise.resolve(null),
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
        const nextPortfolio =
          portfolioResult.value?.source === "demo"
            ? null
            : portfolioResult.value;
        setPortfolio(nextPortfolio);
      } else {
        failedReads.push("portfolio");
        setPortfolio(null);
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
        setEvents(eventsResult.value.events);
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
      if (telegramBindingResult.status === "fulfilled") {
        const telegramBinding = telegramBindingResult.value;
        const connected = walletAddress && telegramBinding
          ? connectedTelegramSession(walletAddress, telegramBinding)
          : null;

        setTelegramSession((current) =>
          preserveWaitingTelegramSession(current, connected),
        );
      } else {
        failedReads.push("telegram binding");
      }

      if (failedReads.length > 0) {
        console.warn(
          `Some agent API reads are unavailable: ${failedReads.join(", ")}.`,
        );
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
  }, [activeInheritanceSmartAccount, activeWalletAddress, wallet]);

  useEffect(() => {
    // Defer to a macrotask so the synchronous `setLoading(true)` inside
    // loadData() runs outside the effect commit (avoids cascading renders) and
    // coalesces the rapid dependency churn while the wallet/account resolve.
    const id = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(id);
  }, [loadData]);

  // Dedicated inheritance plan fetch: runs specifically when activeInheritanceSmartAccount
  // becomes available (after connectRiskGuardSmartAccount resolves), fixing the race
  // condition where loadData() fires before the smart account address is known.
  useEffect(() => {
    if (!activeInheritanceSmartAccount) {
      return;
    }

    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      setInheritancePlanLoading(true);

      agentApi
        .getInheritancePlan(activeInheritanceSmartAccount)
        .then((plan) => {
          if (!cancelled) {
            setInheritancePlan(plan);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) {
            setInheritancePlanLoading(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [activeInheritanceSmartAccount]);

  useEffect(() => {
    const id = window.setTimeout(() => void refreshRiskGuardModuleStatus(), 0);
    return () => window.clearTimeout(id);
  }, [refreshRiskGuardModuleStatus]);

  useEffect(() => {
    const id = window.setTimeout(() => void refreshTelegramCheckInStatus(), 0);
    return () => window.clearTimeout(id);
  }, [refreshTelegramCheckInStatus]);

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

  useEffect(() => {
    const walletAddress = wallet?.address;

    if (!walletAddress || selectedSmartAccountAddress) {
      return;
    }

    const normalizedWallet = walletAddress.toLowerCase();
    if (autoSmartAccountAttemptRef.current === normalizedWallet) {
      return;
    }

    autoSmartAccountAttemptRef.current = normalizedWallet;
    let stopped = false;

    connectRiskGuardSmartAccount()
      .then((account) => {
        if (stopped) {
          return;
        }

        setSelectedSmartAccountAddress(account.address);
      })
      .catch(() => {
        if (stopped) {
          return;
        }

        autoSmartAccountAttemptRef.current = null;
      });

    return () => {
      stopped = true;
    };
  }, [selectedSmartAccountAddress, wallet?.address]);

  useEffect(
    () =>
      subscribeBrowserWalletChanges(() => {
        loadRequestRef.current += 1;
        restoreBrowserWallet()
          .then((restored) => {
            setWallet(restored);
            setAccountStatus(restored ? "connected" : "expired");
            clearWalletScopedState();
          })
          .catch(() => {
            setWallet(null);
            setSelectedSmartAccountAddress(undefined);
            setAccountStatus("error");
            clearWalletScopedState();
          });
      }),
    [clearWalletScopedState],
  );

  const telegramStatus = telegramSession?.status;
  const telegramCode = telegramSession?.code;
  const telegramWalletAddress = telegramSession?.walletAddress;

  useEffect(() => {
    if (telegramStatus !== "waiting" || !telegramWalletAddress) {
      return;
    }

    let stopped = false;
    const sessionCode = telegramCode;

    const interval = setInterval(() => {
      void agentApi
        .getTelegramConnectStatus(telegramWalletAddress)
        .then((session) => {
          if (stopped || session.code !== sessionCode) {
            return;
          }

          setTelegramSession(session);
          if (session.status === "connected") {
            setNotice({ tone: "ok", message: "Telegram is connected." });
            void loadData();
            return;
          }

          if (session.status === "expired") {
            setNotice({
              tone: "warn",
              message: "Telegram Connect code expired. Start a new connection.",
            });
            setTelegramSession(null);
            return;
          }

          if (session.status === "failed") {
            setNotice({
              tone: "bad",
              message:
                "Telegram Connect could not finish. Save your profile, then start a new Telegram connection.",
            });
            setTelegramSession(null);
          }
        })
        .catch(() => undefined);
    }, 3_000);
    const timeout = setTimeout(() => {
      stopped = true;
      setTelegramSession(null);
      setNotice({
        tone: "bad",
        message:
          "Telegram did not connect in time. Check the bot username and try again.",
      });
    }, telegramConnectTimeoutMs);

    return () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [loadData, telegramCode, telegramStatus, telegramWalletAddress]);

  // Poll inheritance plan while agent review modal is open.
  // When the agent approves via Telegram, the tx executes on-chain and the plan
  // becomes active — we detect this and auto-dismiss the modal.
  const agentReviewModalOpen = Boolean(agentReviewModal);
  useEffect(() => {
    if (!agentReviewModalOpen || !activeInheritanceSmartAccount) {
      return;
    }

    const pollIntervalMs = 5_000;
    const maxPollMs = 120_000;
    let stopped = false;
    let elapsed = 0;

    const interval = setInterval(() => {
      elapsed += pollIntervalMs;
      if (elapsed > maxPollMs) {
        clearInterval(interval);
        return;
      }

      void agentApi
        .getInheritancePlan(activeInheritanceSmartAccount)
        .then((plan) => {
          if (stopped) {
            return;
          }

          if (plan?.active) {
            setInheritancePlan(plan);
            setAgentReviewModal(null);
            setNotice({
              tone: "ok",
              message: "Inheritance plan approved and activated on-chain.",
            });
            clearInterval(interval);
          }
        })
        .catch(() => undefined);
    }, pollIntervalMs);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [activeInheritanceSmartAccount, agentReviewModalOpen]);

  async function handleConnectWallet() {
    await connectWalletFromDashboard({
      setAccountStatus,
      setActionLoading,
      setNotice,
      setUserProfile,
      setWallet,
    });
  }

  async function handleDisconnectWallet() {
    setActionLoading("wallet");
    setAccountStatus("disconnecting");
    try {
      await disconnectBrowserWallet();
      setWallet(null);
      setSelectedSmartAccountAddress(undefined);
      loadRequestRef.current += 1;
      clearWalletScopedState();
      setAccountStatus("disconnected");
      setNotice({ tone: "ok", message: "Wallet disconnected." });
    } catch (error) {
      setAccountStatus("error");
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleInheritancePlanSubmit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    if (!wallet) {
      setNotice({
        tone: "warn",
        message: "Connect your wallet before configuring inheritance.",
      });
      return;
    }

    if (!telegramSession?.connected) {
      setNotice({
        tone: "warn",
        message:
          "Connect Telegram first — your inheritance plan needs it for heartbeat check-ins and alerts.",
      });
      return;
    }

    const registryAddress = publicChain?.contracts.inheritanceRegistry;
    if (!registryAddress) {
      setNotice({
        tone: "warn",
        message:
          "Inheritance Registry is not deployed/configured for this chain yet.",
      });
      return;
    }

    const parsedForm = readInheritancePlanForm(new FormData(event.currentTarget));
    if (!parsedForm.ok) {
      setNotice({
        tone: "warn",
        message: parsedForm.message,
      });
      return;
    }

    const { planInput, smartAccountAddress } = parsedForm;
    setActionLoading("inheritance-plan");
    try {
      const riskGuardOptions = {
        ...(publicChain?.contracts.riskGuardValidatorModule
          ? { riskGuardValidatorAddress: publicChain.contracts.riskGuardValidatorModule }
          : {}),
        walletAddress: wallet.address,
      };
      const selectedRiskGuardAccount = await getSelectedInheritanceSetupAccount(smartAccountAddress);
      const txHash =
        selectedRiskGuardAccount
          ? await saveInheritancePlanWithThirdweb(
              registryAddress,
              planInput,
              selectedRiskGuardAccount,
              inheritancePlan,
              riskGuardOptions,
            )
          : await saveInheritancePlan(
              registryAddress,
              planInput,
              inheritancePlan,
            );
      openTransaction(publicChain, txHash);
      await agentApi.ensureSessionKeyAction({
        walletAddress: wallet.address,
        smartAccountAddress,
        action: "checkin",
      });
      const txAction = transactionNoticeAction(publicChain, txHash);
      setNotice({
        tone: "ok",
        message: inheritancePlan?.active
          ? "Inheritance plan updated on-chain."
          : "Inheritance plan created on-chain.",
        ...(txAction ? { action: txAction } : {}),
      });
      await loadData();
    } catch (error) {
      if (error instanceof SomniaAgentReviewRequestedError) {
        // Register session key even though tx needs agent review, so that /checkin works after the plan is approved.
        await agentApi.ensureSessionKeyAction({
          walletAddress: wallet.address,
          smartAccountAddress,
          action: "checkin",
        }).catch(() => undefined);
        setAgentReviewModal(buildAgentReviewModal(error, publicChain, telegramSession));
        return;
      }

      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTelegramConnect() {
    await runTelegramConnectFlow({
      activeInheritanceSmartAccount,
      activeWalletAddress,
      loadData,
      setActionLoading,
      setNotice,
      setTelegramSession,
      setUserProfile,
      telegramSession,
      userProfile,
      wallet,
    });
  }

  async function handleTelegramUnlink() {
    const walletAddress = wallet?.address ?? activeWalletAddress;
    if (!walletAddress) {
      setNotice({
        tone: "warn",
        message: "Connect a wallet before unlinking Telegram.",
      });
      return;
    }

    setActionLoading("telegram-unlink");
    try {
      const message = telegramUnlinkMessage(walletAddress);
      const signature = await signWalletMessage(message);
      await agentApi.unlinkTelegram({ walletAddress, message, signature });
      setTelegramSession(null);
      setNotice({ tone: "ok", message: "Telegram alerts have been unlinked." });
      await loadData();
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTelegramCheckInEnable() {
    const validatorAddress = publicChain?.contracts.riskGuardCheckInValidatorModule;
    if (!validatorAddress) {
      setNotice({
        tone: "warn",
        message: "Telegram check-in validator is not configured for this chain yet.",
      });
      return;
    }

    if (!telegramSession?.connected) {
      setNotice({
        tone: "warn",
        message: "Connect Telegram before enabling Telegram check-in.",
      });
      return;
    }

    setActionLoading("telegram-checkin");
    try {
      const connectedWallet = wallet ?? await connectBrowserWallet();
      if (!wallet) {
        setWallet(connectedWallet);
        setAccountStatus("connected");
      }

      const smartAccount =
        activeInheritanceSmartAccount
          ? await getSelectedInheritanceSetupAccount(activeInheritanceSmartAccount)
          : await connectRiskGuardBootstrapSmartAccount();
      if (!smartAccount) {
        throw new Error("Could not connect the selected smart account.");
      }

      setSelectedSmartAccountAddress(smartAccount.address);
      const permission = await agentApi.ensureSessionKeyAction({
        walletAddress: connectedWallet.address,
        smartAccountAddress: smartAccount.address,
        action: "checkin",
      });
      const result = await configureTelegramCheckInValidator({
        account: smartAccount,
        checkInSignerAddress: permission.sessionKeyAddress,
        validatorAddress,
      });
      const txHash = result.txHash;
      if (txHash) {
        openTransaction(publicChain, txHash);
      }
      const txAction = txHash ? transactionNoticeAction(publicChain, txHash) : undefined;
      setNotice({
        tone: "ok",
        message: txHash
          ? "Telegram check-in enabled for this smart account."
          : "Telegram check-in was already enabled for this smart account.",
        ...(txAction ? { action: txAction } : {}),
      });
      await refreshTelegramCheckInStatus(smartAccount.address);
      await loadData();
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTelegramCheckInDisable() {
    const validatorAddress = publicChain?.contracts.riskGuardCheckInValidatorModule;
    const smartAccountAddress = activeInheritanceSmartAccount;
    if (!validatorAddress || !smartAccountAddress) {
      setNotice({
        tone: "warn",
        message: "Select a smart account before disabling Telegram check-in.",
      });
      return;
    }

    setActionLoading("telegram-checkin-disable");
    try {
      const smartAccount = await getSelectedInheritanceSetupAccount(smartAccountAddress);
      if (!smartAccount) {
        throw new Error("Could not connect the selected smart account.");
      }

      const result = await disableTelegramCheckInValidator({
        account: smartAccount,
        validatorAddress,
      });
      if (result.txHash) {
        openTransaction(publicChain, result.txHash);
      }
      const txAction = result.txHash ? transactionNoticeAction(publicChain, result.txHash) : undefined;
      setNotice({
        tone: "ok",
        message: result.txHash
          ? "Telegram check-in disabled for this smart account."
          : "Telegram check-in was already disabled for this smart account.",
        ...(txAction ? { action: txAction } : {}),
      });
      await refreshTelegramCheckInStatus(smartAccount.address);
      await loadData();
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleConfigureRiskPolicy(nextConfig: RiskGuardConfig) {
    if (nextConfig.enabled && !telegramSession?.connected) {
      setNotice({
        tone: "warn",
        message:
          "Connect Telegram first so RiskGuard can alert you about risky transactions, then enable the guard.",
      });
      return false;
    }

    const approvalStoreAddress = publicChain?.contracts.riskGuardApprovalStore;
    const guardModuleAddress =
      publicChain?.contracts.riskGuardValidatorModule ?? publicChain?.contracts.riskGuardHookModule;

    if (!approvalStoreAddress || !guardModuleAddress) {
      setNotice({
        tone: "warn",
        message: "RiskGuard validator contracts are not configured for this chain yet.",
      });
      return false;
    }

    setActionLoading(nextConfig.enabled ? "risk-policy" : "risk-policy-disable");
    try {
      const connectedWallet = wallet ?? await connectBrowserWallet();
      if (!wallet) {
        setWallet(connectedWallet);
        setAccountStatus("connected");
      }

      const riskGuardSmartAccount = await connectRiskGuardBootstrapSmartAccount();
      setSelectedSmartAccountAddress(riskGuardSmartAccount.address);
      const approvalSession = nextConfig.enabled
        ? await agentApi.ensureSessionKeyAction({
            walletAddress: connectedWallet.address,
            smartAccountAddress: riskGuardSmartAccount.address,
            action: "riskguard-approval",
          })
        : undefined;

      const result = await configureRiskGuardPolicyWithThirdweb({
        account: riskGuardSmartAccount,
        ...(approvalSession ? { agentAddress: approvalSession.sessionKeyAddress } : {}),
        approvalStoreAddress,
        config: nextConfig,
        guardModuleAddress,
      });

      const txHash = result.registerTxHash || result.configTxHash || result.installTxHash;
      if (txHash) {
        openTransaction(publicChain, txHash);
      }
      persistRiskGuardConfig(nextConfig);
      const txAction = txHash ? transactionNoticeAction(publicChain, txHash) : undefined;
      setNotice({
        tone: "ok",
        message: nextConfig.enabled
          ? "RiskGuard setup saved and approval route registered on-chain."
          : txHash
            ? "RiskGuard policy disabled on-chain."
            : "RiskGuard policy was already disabled on-chain; local setup state was cleared.",
        ...(txAction ? { action: txAction } : {}),
      });
      await refreshRiskGuardModuleStatus(riskGuardSmartAccount.address);
      await loadData();
      return true;
    } catch (error) {
      if (error instanceof SomniaAgentReviewRequestedError) {
        setAgentReviewModal(buildAgentReviewModal(error, publicChain, telegramSession));
        return false;
      }

      setNotice({ tone: "bad", message: errorMessage(error) });
      return false;
    } finally {
      setActionLoading(null);
    }
  }

  const handleTransferEstimate = useCallback(async (input: NativeTransferInput): Promise<NativeTransferEstimate> => {
    const connectedWallet = wallet ?? await connectBrowserWallet();
    if (!wallet) {
      setWallet(connectedWallet);
      setAccountStatus("connected");
    }

    const smartAccount =
      input.source === "smart"
        ? await getActiveRiskGuardSmartAccount()
        : undefined;

    if (smartAccount) {
      setSelectedSmartAccountAddress(smartAccount.address);
    }

    return estimateNativeTransfer(input, {
      eoaAddress: connectedWallet.address,
      smartAccount,
      smartAccountAddress: smartAccount?.address ?? activeInheritanceSmartAccount,
      symbol: publicChain?.nativeCurrency.symbol ?? "STT",
    });
  }, [activeInheritanceSmartAccount, getActiveRiskGuardSmartAccount, publicChain?.nativeCurrency.symbol, wallet]);

  async function handleTransferSubmit(input: NativeTransferInput) {
    const connectedWallet = wallet ?? await connectBrowserWallet();
    if (!wallet) {
      setWallet(connectedWallet);
      setAccountStatus("connected");
    }

    const smartAccount =
      input.source === "smart"
        ? await getActiveRiskGuardSmartAccount()
        : undefined;

    if (smartAccount) {
      setSelectedSmartAccountAddress(smartAccount.address);
    }

    const validationError = getNativeTransferValidationError(input, {
      eoaAddress: connectedWallet.address,
      smartAccountAddress: smartAccount?.address ?? activeInheritanceSmartAccount,
    });

    if (validationError) {
      setNotice({ tone: "warn", message: validationError });
      return false;
    }

    setActionLoading("transfer");
    try {
      const txHash = await submitNativeTransferWithFallback({
        connectedWalletAddress: connectedWallet.address,
        input,
        publicChain,
        smartAccount,
      });
      const txAction = transactionNoticeAction(publicChain, txHash);

      openTransaction(publicChain, txHash);
      setNotice({
        tone: "ok",
        message: input.source === "smart"
          ? "Smart account transfer submitted on-chain."
          : "EOA transfer submitted on-chain.",
        ...(txAction ? { action: txAction } : {}),
      });
      await loadData();
      return true;
    } catch (error) {
      if (error instanceof SomniaAgentReviewRequestedError) {
        setAgentReviewModal(buildAgentReviewModal(error, publicChain, telegramSession));
        return false;
      }

      setNotice({ tone: "bad", message: errorMessage(error) });
      return false;
    } finally {
      setActionLoading(null);
    }
  }

  async function handleProfileSubmit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ) {
    event.preventDefault();
    await saveProfileFromDashboard({
      form: new FormData(event.currentTarget),
      setActionLoading,
      setNotice,
      setUserProfile,
      wallet,
    });
  }

  async function handleInheritancePlanCancel() {
    if (!wallet) {
      setNotice({
        tone: "warn",
        message: "Connect your wallet before cancelling inheritance.",
      });
      return;
    }

    const registryAddress = publicChain?.contracts.inheritanceRegistry;
    if (!registryAddress) {
      setNotice({
        tone: "warn",
        message:
          "Inheritance Registry is not deployed/configured for this chain yet.",
      });
      return;
    }

    if (!inheritancePlan?.active) {
      setNotice({
        tone: "warn",
        message: "No active inheritance plan found for this account.",
      });
      return;
    }

    setActionLoading("inheritance-cancel");
    try {
      const riskGuardOptions = {
        ...(publicChain?.contracts.riskGuardValidatorModule
          ? { riskGuardValidatorAddress: publicChain.contracts.riskGuardValidatorModule }
          : {}),
        walletAddress: wallet.address,
      };
      const selectedRiskGuardAccount = await getSelectedRiskGuardSmartAccount(inheritancePlan.smartAccount);
      const txHash =
        selectedRiskGuardAccount
          ? await cancelInheritancePlanWithThirdweb(
              registryAddress,
              selectedRiskGuardAccount,
              riskGuardOptions,
            )
          : await cancelInheritancePlan(
              registryAddress,
              inheritancePlan.smartAccount,
            );
      openTransaction(publicChain, txHash);
      const txAction = transactionNoticeAction(publicChain, txHash);
      setNotice({
        tone: "ok",
        message: "Inheritance plan cancelled on-chain.",
        ...(txAction ? { action: txAction } : {}),
      });
      await loadData();
    } catch (error) {
      if (error instanceof SomniaAgentReviewRequestedError) {
        setAgentReviewModal(buildAgentReviewModal(error, publicChain, telegramSession));
        return;
      }

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
      inheritancePlanLoading,
      loading,
      mobileMoreOpen,
      mode,
      notice,
      agentReviewModal,
      portfolio,
      publicChain,
      readiness,
      receipts,
      accountOptions,
      selectedAssetAccountScope,
      riskGuardConfig,
      riskGuardModuleReady,
      riskGuardRules,
      telegramSession,
      telegramCheckInStatus,
      userProfile,
      wallet,
      activeWalletAddress,
      activeInheritanceSmartAccount,
      selectedSmartAccountAddress,
    },
    actions: {
      handleConfigureRiskPolicy,
      handleConnectWallet,
      handleDisconnectWallet,
      handleInheritancePlanCancel,
      handleInheritancePlanSubmit,
      handleTelegramConnect,
      handleTelegramCheckInDisable,
      handleTelegramCheckInEnable,
      handleTelegramUnlink,
      handleTransferEstimate,
      handleTransferSubmit,
      handleProfileSubmit,
      loadData,
      showNotice,
      setAgentReviewModal,
      setActiveSection,
      setSelectedAssetAccountScope,
      setMobileMoreOpen,
      setSelectedSmartAccountAddress,
    },
  };
}
