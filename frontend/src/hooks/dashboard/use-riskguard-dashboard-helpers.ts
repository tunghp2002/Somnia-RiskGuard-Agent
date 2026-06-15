import { SomniaAgentReviewRequestedError } from "@/lib/riskguard-smart-account";
import { agentApi, type UserRecord } from "@/lib/agent-api";
import {
  sendNativeTransferFromEoa,
  sendNativeTransferFromSmartAccount,
} from "@/lib/native-transfer";
import { connectUserPaidThirdwebSmartAccount } from "@/lib/riskguard-module";

import {
  durationToSeconds,
  errorMessage,
  formatAddress,
  readableMetadata,
} from "@/utils/dashboard";

import type {
  AuditEvent,
  PublicChainMetadata,
  TelegramBindingStatus,
  TelegramConnectSession,
} from "@/lib/agent-api";
import type {
  AgentReviewRequestModal,
  Notice,
  NativeTransferInput,
  RiskGuardConfig,
  RiskGuardRule,
} from "@/types/dashboard";
import type { AccountOption } from "@/lib/blockscout-api";
import {
  connectBrowserWallet,
  type BrowserWalletState,
} from "@/lib/wallet";
import type { AccountStatus } from "@/types/dashboard";

export const telegramConnectTimeoutMs = 60_000;

export function telegramUnlinkMessage(walletAddress: string) {
  return [
    "RiskGuard Telegram unlink request",
    `Wallet: ${walletAddress}`,
    "Action: unlink Telegram alerts",
  ].join("\n");
}

export function transactionUrl(
  publicChain: PublicChainMetadata | null,
  txHash: string,
) {
  return publicChain?.blockExplorerUrl
    ? `${publicChain.blockExplorerUrl.replace(/\/$/, "")}/tx/${txHash}`
    : undefined;
}

export function openTransaction(
  publicChain: PublicChainMetadata | null,
  txHash: string,
) {
  const url = transactionUrl(publicChain, txHash);
  if (url && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function transactionNoticeAction(
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

export function buildAgentReviewModal(
  error: SomniaAgentReviewRequestedError,
  publicChain: PublicChainMetadata | null,
  telegramSession: TelegramConnectSession | null,
): AgentReviewRequestModal {
  const requestTxUrl = transactionUrl(publicChain, error.requestTxHash);
  const telegramUrl = telegramReviewUrl(telegramSession);

  return {
    requestTxHash: error.requestTxHash,
    ...(requestTxUrl ? { requestTxUrl } : {}),
    ...(telegramUrl ? { telegramUrl } : {}),
  };
}

export function connectedTelegramSession(
  walletAddress: string,
  telegramBinding: TelegramBindingStatus,
): TelegramConnectSession | null {
  const binding = telegramBinding.binding;

  if (!telegramBinding.connected || !binding) {
    return null;
  }

  return {
    walletAddress,
    code: "",
    expiresAt: "",
    status: "connected",
    connected: true,
    botDeepLink: telegramBinding.botUrl ?? "",
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
  };
}

export function preserveWaitingTelegramSession(
  current: TelegramConnectSession | null,
  connected: TelegramConnectSession | null,
) {
  return current?.status === "waiting" ? current : connected;
}

export function buildRiskGuardRules(
  riskGuardConfig: RiskGuardConfig,
  riskGuardModuleReady: boolean,
): RiskGuardRule[] {
  return [
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
          : "Agent validates native transfers.",
    },
  ];
}

export function buildAccountOptions(
  activeInheritanceSmartAccount: string | undefined,
  activeWalletAddress: string | undefined,
): AccountOption[] {
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
}

export function buildReceipts(events: AuditEvent[]) {
  return events.map((event) => ({
    id: event.auditEventId,
    title: event.eventType.replaceAll(".", " "),
    status: event.status,
    detail: readableMetadata(event.metadata),
    createdAt: event.createdAt,
  })).slice(0, 8);
}

export function readInheritancePlanForm(form: FormData) {
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

  if (beneficiaries.length === 0) {
    return { ok: false as const, message: "Add at least one recipient wallet address." };
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(smartAccountAddress)) {
    return { ok: false as const, message: "Select a valid smart account address." };
  }

  if (protectedAssets.length === 0) {
    return { ok: false as const, message: "Select native STT or add at least one ERC-20 token." };
  }

  if (Math.abs(shareTotal - 100) > 0.001) {
    return { ok: false as const, message: "Recipient shares must add up to exactly 100%." };
  }

  return {
    ok: true as const,
    smartAccountAddress,
    planInput: {
      smartAccountAddress,
      beneficiaries,
      protectedAssets,
      heartbeatIntervalSeconds: durationToSeconds(form, "interval", 1),
      gracePeriodSeconds: durationToSeconds(form, "grace", 0),
      timelockPeriodSeconds: durationToSeconds(form, "timelock", 0),
    },
  };
}

export async function connectWalletFromDashboard({
  setAccountStatus,
  setActionLoading,
  setNotice,
  setUserProfile,
  setWallet,
}: {
  setAccountStatus: (value: AccountStatus) => void;
  setActionLoading: (value: string | null) => void;
  setNotice: (value: Notice) => void;
  setUserProfile: (value: UserRecord | null) => void;
  setWallet: (value: BrowserWalletState) => void;
}) {
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

export async function saveProfileFromDashboard({
  form,
  setActionLoading,
  setNotice,
  setUserProfile,
  wallet,
}: {
  form: FormData;
  setActionLoading: (value: string | null) => void;
  setNotice: (value: Notice) => void;
  setUserProfile: (value: UserRecord | null) => void;
  wallet: BrowserWalletState | null;
}) {
  if (!wallet) {
    setNotice({
      tone: "warn",
      message: "Connect your wallet before editing your profile.",
    });
    return;
  }

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

export async function submitNativeTransferWithFallback({
  connectedWalletAddress,
  input,
  publicChain,
  smartAccount,
}: {
  connectedWalletAddress: string;
  input: NativeTransferInput;
  publicChain: PublicChainMetadata | null;
  smartAccount: Parameters<typeof sendNativeTransferFromSmartAccount>[1] | undefined;
}) {
  const riskGuardTransferOptions = publicChain?.contracts.riskGuardValidatorModule
    ? {
        riskGuardValidatorAddress: publicChain.contracts.riskGuardValidatorModule,
        symbol: publicChain.nativeCurrency.symbol,
        walletAddress: connectedWalletAddress,
      }
    : { symbol: publicChain?.nativeCurrency.symbol ?? "native token" };

  if (input.source !== "smart") {
    return sendNativeTransferFromEoa(input, publicChain?.nativeCurrency.symbol ?? "native token");
  }

  return sendNativeTransferFromSmartAccount(
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
  });
}

export async function runTelegramConnectFlow({
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
}: {
  activeInheritanceSmartAccount: string | undefined;
  activeWalletAddress: string | undefined;
  loadData: () => Promise<void>;
  setActionLoading: (value: string | null) => void;
  setNotice: (value: Notice) => void;
  setTelegramSession: (value: TelegramConnectSession) => void;
  setUserProfile: (value: UserRecord | null) => void;
  telegramSession: TelegramConnectSession | null;
  userProfile: UserRecord | null;
  wallet: BrowserWalletState | null;
}) {
  const walletAddress = wallet?.address ?? activeWalletAddress;
  if (!walletAddress) {
    setNotice({
      tone: "warn",
      message: "Connect a wallet before starting Telegram Connect.",
    });
    return;
  }

  const botTab =
    typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
  const openBot = (url: string) => {
    if (botTab && !botTab.closed) {
      botTab.location.href = url;
    } else if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  if (telegramSession?.status === "waiting") {
    openBot(telegramSession.botDeepLink);
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
    openBot(session.botDeepLink);
    setNotice({
      tone: "ok",
      message: "Telegram bot opened. Press Start in Telegram to connect.",
    });
    await loadData();
  } catch (error) {
    if (botTab && !botTab.closed) {
      botTab.close();
    }
    setNotice({ tone: "bad", message: errorMessage(error) });
  } finally {
    setActionLoading(null);
  }
}

function telegramReviewUrl(session: TelegramConnectSession | null) {
  if (session?.botDeepLink) {
    return session.botDeepLink;
  }

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  return botUsername ? `https://t.me/${botUsername.replace(/^@/, "")}` : undefined;
}
