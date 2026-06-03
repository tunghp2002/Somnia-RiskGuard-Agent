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
  type AuditEvent,
  type InheritancePlanStatus,
  type Mode,
  type PortfolioSnapshot,
  type PublicChainMetadata,
  type Readiness,
  type RiskSnapshot,
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
  sendNativeTransferFromEoa,
  sendNativeTransferFromSmartAccount,
} from "@/lib/native-transfer";
import {
  configureRiskGuardPolicyWithThirdweb,
  connectRiskGuardBootstrapSmartAccount,
  connectRiskGuardSmartAccount,
  connectUserPaidThirdwebSmartAccount,
} from "@/lib/riskguard-module";
import {
  connectBrowserWallet,
  disconnectBrowserWallet,
  restoreBrowserWallet,
  signWalletMessage,
  subscribeBrowserWalletChanges,
  type BrowserWalletState,
} from "@/lib/wallet";

import {
  durationToSeconds,
  errorMessage,
  formatAddress,
  isSimulationEvent,
  readableMetadata,
} from "../utils";

import type {
  AccountStatus,
  DashboardSection,
  GuardRuleId,
  Notice,
  NativeTransferEstimate,
  NativeTransferInput,
  RiskGuardConfig,
  RiskGuardRule,
} from "../types";
import type {
  AccountOption,
  BlockscoutAccountScope,
} from "@/lib/blockscout-api";

const telegramConnectTimeoutMs = 60_000;
const riskGuardConfigStorageKey = "riskguard-policy-config";

const defaultRiskGuardConfig: RiskGuardConfig = {
  enabled: false,
  selectedRules: ["large-transfer", "unlimited-approve", "new-contract"],
  largeTransferMode: "amount",
  largeTransferThreshold: "",
};

function loadStoredRiskGuardConfig(): RiskGuardConfig {
  if (typeof window === "undefined") {
    return defaultRiskGuardConfig;
  }

  try {
    const stored = window.localStorage.getItem(riskGuardConfigStorageKey);

    if (!stored) {
      return defaultRiskGuardConfig;
    }

    const parsed = JSON.parse(stored) as Partial<RiskGuardConfig>;
    const validRules: GuardRuleId[] = [
      "large-transfer",
      "unlimited-approve",
      "new-contract",
    ];
    const selectedRules = (
      parsed.selectedRules ?? defaultRiskGuardConfig.selectedRules
    ).filter((rule): rule is GuardRuleId =>
      validRules.includes(rule as GuardRuleId),
    );
    const legacyPercentSelected = (parsed.selectedRules ?? []).includes(
      "balance-percent" as GuardRuleId,
    );
    const largeTransferMode =
      parsed.largeTransferMode ??
      (legacyPercentSelected
        ? "percent"
        : defaultRiskGuardConfig.largeTransferMode);

    return {
      enabled: Boolean(parsed.enabled),
      selectedRules:
        legacyPercentSelected && !selectedRules.includes("large-transfer")
          ? [...selectedRules, "large-transfer"]
          : selectedRules,
      largeTransferMode,
      largeTransferThreshold:
        parsed.largeTransferThreshold ??
        (largeTransferMode === "percent"
          ? (parsed as { nativePercentThreshold?: string })
              .nativePercentThreshold
          : (parsed as { nativeAmountThreshold?: string })
              .nativeAmountThreshold) ??
        defaultRiskGuardConfig.largeTransferThreshold,
    };
  } catch {
    return defaultRiskGuardConfig;
  }
}

function telegramUnlinkMessage(walletAddress: string) {
  return [
    "RiskGuard Telegram unlink request",
    `Wallet: ${walletAddress}`,
    "Action: unlink Telegram alerts",
  ].join("\n");
}

function transactionUrl(
  publicChain: PublicChainMetadata | null,
  txHash: string,
) {
  return publicChain?.blockExplorerUrl
    ? `${publicChain.blockExplorerUrl.replace(/\/$/, "")}/tx/${txHash}`
    : undefined;
}

function openTransaction(
  publicChain: PublicChainMetadata | null,
  txHash: string,
) {
  const url = transactionUrl(publicChain, txHash);
  if (url && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function transactionNoticeAction(
  publicChain: PublicChainMetadata | null,
  txHash: string,
): Notice["action"] | undefined {
  const url = transactionUrl(publicChain, txHash);
  return url
    ? {
        label: formatAddress(txHash),
        url,
      }
    : undefined;
}

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
    null,
  );
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [risk, setRisk] = useState<RiskSnapshot | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [inheritancePlan, setInheritancePlan] =
    useState<InheritancePlanStatus | null>(null);
  const [selectedSmartAccountAddress, setSelectedSmartAccountAddress] =
    useState<string>();
  const [selectedAssetAccountScope, setSelectedAssetAccountScope] =
    useState<BlockscoutAccountScope>("all");
  const [riskGuardConfig, setRiskGuardConfig] = useState<RiskGuardConfig>(
    defaultRiskGuardConfig,
  );
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [telegramSession, setTelegramSession] =
    useState<TelegramConnectSession | null>(null);
  const [userProfile, setUserProfile] = useState<UserRecord | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const autoSmartAccountAttemptRef = useRef<string | null>(null);

  const activeWalletAddress = wallet?.address;
  const activeInheritanceSmartAccount =
    selectedSmartAccountAddress ??
    thirdwebSmartAccount?.address ??
    inheritancePlan?.smartAccount;
  const guardianReady = Boolean(
    readiness?.sessionKey.ready && readiness.monitoredWallet.ready,
  );
  const riskGuardModuleReady = riskGuardConfig.enabled;
  const riskGuardRules: RiskGuardRule[] = useMemo(
    () => [
      {
        id: "large-transfer",
        label: "Large SOMI transfer",
        status:
          riskGuardModuleReady &&
          riskGuardConfig.selectedRules.includes("large-transfer")
            ? "armed"
            : "needs-module",
        detail:
          riskGuardConfig.largeTransferMode === "percent"
            ? `Agent validates transfers over ${riskGuardConfig.largeTransferThreshold || "0"}% of account SOMI.`
            : `Agent validates native transfers.`,
      }
    ],
    [riskGuardConfig, riskGuardModuleReady],
  );
  const accountOptions: AccountOption[] = useMemo(() => {
    const options: AccountOption[] = [{ id: "all", label: "All accounts" }];

    if (activeWalletAddress) {
      options.push({ id: "eoa", label: "EOA", address: activeWalletAddress });
    }

    if (activeInheritanceSmartAccount) {
      options.push({
        id: "smart",
        label: "Smart account",
        address: activeInheritanceSmartAccount,
      });
    }

    return options.filter((option, index, list) => {
      const address = option.address?.toLowerCase();

      return (
        !address ||
        list.findIndex((item) => item.address?.toLowerCase() === address) ===
          index
      );
    });
  }, [activeInheritanceSmartAccount, activeWalletAddress]);

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

  const receipts = useMemo(() => {
    const fromAudit = events.map((event) => ({
      id: event.auditEventId,
      title: event.eventType.replaceAll(".", " "),
      status: event.status,
      detail: readableMetadata(event.metadata),
      createdAt: event.createdAt,
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
        riskResult,
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
        walletAddress ? agentApi.getRisk(walletAddress) : Promise.resolve(null),
        agentApi.getHealth(),
        activeInheritanceSmartAccount
          ? agentApi.getInheritancePlan(activeInheritanceSmartAccount)
          : Promise.resolve(null),
        agentApi.getAuditEvents(20),
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
        const nextEvents = eventsResult.value.events.filter(
          (event) => !isSimulationEvent(event),
        );
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
      if (telegramBindingResult.status === "fulfilled") {
        const telegramBinding = telegramBindingResult.value;
        if (
          walletAddress &&
          telegramBinding?.connected &&
          telegramBinding.binding
        ) {
          const binding = telegramBinding.binding;
          setTelegramSession((current) =>
            current?.status === "waiting"
              ? current
              : {
                  walletAddress,
                  code: "",
                  expiresAt: "",
                  status: "connected",
                  connected: true,
                  botDeepLink: "",
                  binding: {
                    chatId: binding.chatId,
                    ...(binding.telegramUserId
                      ? { telegramUserId: binding.telegramUserId }
                      : {}),
                    ...(binding.telegramUsername
                      ? { telegramUsername: binding.telegramUsername }
                      : {}),
                    ...(binding.telegramDisplayName
                      ? { telegramDisplayName: binding.telegramDisplayName }
                      : {}),
                    ...(binding.smartAccountAddress
                      ? { smartAccountAddress: binding.smartAccountAddress }
                      : {}),
                  },
                },
          );
        } else {
          setTelegramSession((current) =>
            current?.status === "waiting" ? current : null,
          );
        }
      } else {
        failedReads.push("telegram binding");
      }

      if (failedReads.length > 0) {
        setNotice({
          tone: "warn",
          message: `Some agent API reads are unavailable: ${failedReads.join(", ")}.`,
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
  }, [activeInheritanceSmartAccount, activeWalletAddress, wallet]);

  useEffect(() => {
    setRiskGuardConfig(loadStoredRiskGuardConfig());
  }, []);

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

  useEffect(() => {
    if (!telegramSession || telegramSession.status !== "waiting") {
      return;
    }

    let stopped = false;
    const sessionCode = telegramSession.code;

    const interval = setInterval(() => {
      void agentApi
        .getTelegramConnectStatus(telegramSession.walletAddress)
        .then((session) => {
          if (stopped || session.code !== sessionCode) {
            return;
          }

          setTelegramSession(session);
          if (session.status === "connected") {
            setNotice({ tone: "ok", message: "Telegram is connected." });
            void loadData();
          } else if (session.status === "expired") {
            setNotice({
              tone: "warn",
              message: "Telegram Connect code expired. Start a new connection.",
            });
            setTelegramSession(null);
          } else if (session.status === "failed") {
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
  }, [
    loadData,
    telegramSession?.code,
    telegramSession?.status,
    telegramSession?.walletAddress,
  ]);

  async function handleConnectWallet() {
    setActionLoading("wallet");
    try {
      const nextWallet = await connectBrowserWallet();
      setWallet(nextWallet);
      setAccountStatus("connected");
      setUserProfile(await agentApi.getUserProfile(nextWallet.address));
      setNotice({ tone: "ok", message: "Wallet connected." });
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

    const registryAddress = publicChain?.contracts.inheritanceRegistry;
    if (!registryAddress) {
      setNotice({
        tone: "warn",
        message:
          "Inheritance Registry is not deployed/configured for this chain yet.",
      });
      return;
    }

    const form = new FormData(event.currentTarget);
    const smartAccountAddress = String(
      form.get("smartAccountAddress") ?? "",
    ).trim();
    const includeNativeAsset = form.get("includeNativeAsset") === "true";
    const erc20Assets = form
      .getAll("erc20Assets")
      .map((value) => String(value))
      .map((value) => value.trim())
      .filter(Boolean);
    const protectedAssets = [
      ...(includeNativeAsset
        ? ["0x0000000000000000000000000000000000000000"]
        : []),
      ...erc20Assets,
    ];
    const beneficiaryAddresses = form
      .getAll("beneficiaryAddress")
      .map((value) => String(value).trim());
    const sharePercents = form
      .getAll("sharePercent")
      .map((value) => Number(value || 0));
    const beneficiaries = beneficiaryAddresses
      .map((address, index) => ({
        address,
        sharePercent: sharePercents[index] ?? 0,
      }))
      .filter((beneficiary) => beneficiary.address);
    const shareTotal = beneficiaries.reduce(
      (total, beneficiary) => total + beneficiary.sharePercent,
      0,
    );
    const intervalSeconds = Number(
      form.get("intervalSeconds") ?? durationToSeconds(form, "interval", 30),
    );
    const graceSeconds = Number(
      form.get("graceSeconds") ?? durationToSeconds(form, "grace", 0),
    );
    const timelockSeconds = Number(
      form.get("timelockSeconds") ?? durationToSeconds(form, "timelock", 0),
    );

    if (beneficiaries.length === 0) {
      setNotice({
        tone: "warn",
        message: "Add at least one recipient wallet address.",
      });
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(smartAccountAddress)) {
      setNotice({
        tone: "warn",
        message: "Select a valid smart account address.",
      });
      return;
    }

    if (protectedAssets.length === 0) {
      setNotice({
        tone: "warn",
        message: "Select native STT or add at least one ERC-20 token.",
      });
      return;
    }

    if (Math.abs(shareTotal - 100) > 0.001) {
      setNotice({
        tone: "warn",
        message: "Recipient shares must add up to exactly 100%.",
      });
      return;
    }

    if (intervalSeconds < 86_400) {
      setNotice({
        tone: "warn",
        message: "Heartbeat renewal window must be at least 1 day.",
      });
      return;
    }

    setActionLoading("inheritance-plan");
    try {
      const planInput = {
        smartAccountAddress,
        beneficiaries,
        protectedAssets,
        heartbeatIntervalSeconds: intervalSeconds,
        gracePeriodSeconds: graceSeconds,
        timelockPeriodSeconds: timelockSeconds,
      };
      const txHash =
        thirdwebSmartAccount?.address.toLowerCase() ===
        smartAccountAddress.toLowerCase()
          ? await saveInheritancePlanWithThirdweb(
              registryAddress,
              planInput,
              thirdwebSmartAccount,
              inheritancePlan,
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
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleTelegramConnect() {
    const walletAddress = wallet?.address ?? activeWalletAddress;
    if (!walletAddress) {
      setNotice({
        tone: "warn",
        message: "Connect a wallet before starting Telegram Connect.",
      });
      return;
    }

    if (telegramSession?.status === "waiting") {
      window.open(telegramSession.botDeepLink, "_blank", "noopener,noreferrer");
      return;
    }

    setActionLoading("telegram");
    try {
      if (wallet && !userProfile) {
        setUserProfile(
          await agentApi.updateUserProfile({
            walletAddress: wallet.address,
            displayName: formatAddress(wallet.address),
          }),
        );
      }
      const session = await agentApi.startTelegramConnect({
        walletAddress,
        ...(activeInheritanceSmartAccount
          ? { smartAccountAddress: activeInheritanceSmartAccount }
          : {}),
      });
      setTelegramSession(session);
      window.open(session.botDeepLink, "_blank", "noopener,noreferrer");
      setNotice({
        tone: "ok",
        message: "Telegram bot opened. Press Start in Telegram to connect.",
      });
      await loadData();
    } catch (error) {
      setNotice({ tone: "bad", message: errorMessage(error) });
    } finally {
      setActionLoading(null);
    }
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

  async function handleConfigureRiskPolicy(nextConfig: RiskGuardConfig) {
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
      setRiskGuardConfig(nextConfig);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          riskGuardConfigStorageKey,
          JSON.stringify(nextConfig),
        );
      }
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
      await loadData();
      return true;
    } catch (error) {
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
      const riskGuardTransferOptions = publicChain?.contracts.riskGuardValidatorModule
        ? {
            riskGuardValidatorAddress: publicChain.contracts.riskGuardValidatorModule,
            walletAddress: connectedWallet.address,
          }
        : {};
      const txHash = input.source === "smart"
        ? await sendNativeTransferFromSmartAccount(
            input,
            smartAccount!,
            riskGuardTransferOptions,
          ).catch(async (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);

            if (!/aa36|paymaster|useroperation|bundler/i.test(message)) {
              throw error;
            }

            const userPaidAccount = await connectUserPaidThirdwebSmartAccount(smartAccount!.address);

            return sendNativeTransferFromSmartAccount(
              input,
              userPaidAccount,
              riskGuardTransferOptions,
            );
          })
        : await sendNativeTransferFromEoa(input);
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

    if (!wallet) {
      setNotice({
        tone: "warn",
        message: "Connect your wallet before editing your profile.",
      });
      return;
    }

    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "").trim();

    setActionLoading("profile");
    try {
      const profile = await agentApi.updateUserProfile({
        walletAddress: wallet.address,
        displayName: displayName || formatAddress(wallet.address),
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
      const txHash =
        thirdwebSmartAccount?.address.toLowerCase() ===
        inheritancePlan.smartAccount.toLowerCase()
          ? await cancelInheritancePlanWithThirdweb(
              registryAddress,
              thirdwebSmartAccount,
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
      accountOptions,
      selectedAssetAccountScope,
      riskGuardConfig,
      riskGuardModuleReady,
      riskGuardRules,
      telegramSession,
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
      handleTelegramUnlink,
      handleTransferEstimate,
      handleTransferSubmit,
      handleProfileSubmit,
      loadData,
      showNotice,
      setActiveSection,
      setSelectedAssetAccountScope,
      setMobileMoreOpen,
      setSelectedSmartAccountAddress,
    },
  };
}
