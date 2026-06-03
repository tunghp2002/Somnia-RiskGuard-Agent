import {
    Activity,
    CalendarClock,
    Check,
    ChevronDown,
    Coins,
    Copy,
    Fingerprint,
    Lock,
    LockKeyhole,
    Loader2,
    Plus,
    Radar,
    Trash2,
    Unlock,
    UserPlus,
    Users,
    WalletCards
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import { useActiveAccount, useConnectedWallets, useConnect } from "thirdweb/react";
import { EIP1193, smartWallet, type Wallet } from "thirdweb/wallets";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { agentApi, type InheritancePlanStatus, type SessionKeyActionPermission } from "@/lib/agent-api";
import {
    createThirdwebAccountAbstraction,
    riskGuardAccountSalt,
    somniaThirdwebChain,
    thirdwebClient
} from "@/lib/thirdweb-client";

import { DurationField, Field, InfoHint } from "./inheritance-settings-controls";
import {
    clampNumber,
    formatAddressPreview,
    formatDurationPreview,
    formatPlanDate,
    formatProtectedAssets,
    formatRecipientLabel,
    getBeneficiaryAddressError,
    getBeneficiaryShareError,
    getRecipientColor,
} from "./inheritance-settings.utils";
import { useInheritanceSettingsForm } from "./use-inheritance-settings-form";

import type { Notice } from "@/features/dashboard/types";
const smartAccountCacheKey = "riskguard.smartAccounts.v2";

function readCachedSmartAccount(ownerAddress?: string) {
    if (typeof window === "undefined" || !ownerAddress) {
        return undefined;
    }

    try {
        const cache = JSON.parse(window.localStorage.getItem(smartAccountCacheKey) ?? "{}") as Record<string, string>;
        return cache[ownerAddress.toLowerCase()];
    } catch {
        return undefined;
    }
}

function cacheSmartAccount(ownerAddress: string | undefined, smartAccountAddress: string) {
    if (typeof window === "undefined" || !ownerAddress) {
        return;
    }

    try {
        const cache = JSON.parse(window.localStorage.getItem(smartAccountCacheKey) ?? "{}") as Record<string, string>;
        cache[ownerAddress.toLowerCase()] = smartAccountAddress;
        window.localStorage.setItem(smartAccountCacheKey, JSON.stringify(cache));
    } catch {
        // Local storage is only a UI hydration hint; Thirdweb remains the source of truth.
    }
}

export function InheritanceSettings({
    actionLoading,
    inheritancePlan,
    onInheritanceCancel,
    onInheritanceSubmit,
    onNotice,
    onSmartAccountChange,
    registryAddress,
    selectedSmartAccountAddress,
    walletAddress
}: {
    actionLoading: string | null;
    inheritancePlan?: InheritancePlanStatus | null | undefined;
    onInheritanceCancel: () => void;
    onInheritanceSubmit: (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
    onNotice?: (notice: Notice) => void;
    onSmartAccountChange: (address: string | undefined) => void;
    registryAddress?: string | undefined;
    selectedSmartAccountAddress?: string | undefined;
    walletAddress?: string | undefined;
}) {
    const thirdwebSmartAccount = useActiveAccount();
    const { connect: connectThirdwebWallet, isConnecting: creatingSmartAccount } = useConnect();
    const [copiedSmartAccount, setCopiedSmartAccount] = useState(false);
    const [connectingForCancel, setConnectingForCancel] = useState(false);
    const [connectingForSubmit, setConnectingForSubmit] = useState(false);
    const [autoConnectingSmartAccount, setAutoConnectingSmartAccount] = useState(false);
    const [checkInAuthorization, setCheckInAuthorization] = useState<SessionKeyActionPermission | null>(null);
    const checkInAuthorizationResolverRef = useRef<((approved: boolean) => void) | null>(null);
    const autoConnectAttemptRef = useRef<string | null>(null);
    const connectSmartAccountRef = useRef<((options?: { grantCheckIn?: boolean; silent?: boolean }) => Promise<string | undefined>) | null>(null);
    const pendingSubmitFormRef = useRef<HTMLFormElement | null>(null);
    const thirdwebSmartAccountAddress = thirdwebSmartAccount?.address;
    const thirdwebConnectedSmartAccountAddresses = useConnectedWallets()
        .map((wallet) => wallet.getAccount()?.address)
        .filter((address): address is string => Boolean(address));
    const {
        addBeneficiary,
        addDisabled,
        addToken,
        allocationError,
        allocationSegments,
        assetError,
        beneficiaries,
        canRemove,
        discoveringSmartAccounts,
        findSmartAccounts,
        graceDuration,
        hasCreatorWallet,
        includeNativeAsset,
        intervalDuration,
        removeBeneficiary,
        setGraceDuration,
        setIncludeNativeAsset,
        setIntervalDuration,
        setSmartAccountDropdownOpen,
        setSubmitAttempted,
        setSmartAccountDiscoveryError,
        setTimelockDuration,
        setTokenDialogOpen,
        setTokenDraft,
        setTokenSubmitted,
        setTokens,
        shareTotal,
        smartAccountAddress,
        smartAccountCandidates,
        smartAccountDiscoveryError,
        smartAccountDropdownOpen,
        smartAccountError,
        submitAttempted,
        submitBlockReason,
        timelockDuration,
        toggleBeneficiaryLock,
        toggleSmartAccountDropdown,
        tokenAddressError,
        tokenAddressRef,
        tokenDecimalsError,
        tokenDecimalsRef,
        tokenDialogOpen,
        tokenDraft,
        tokenSubmitted,
        tokenSymbolError,
        tokenSymbolRef,
        tokens,
        updateBeneficiary,
        updateBeneficiaryShare,
        updateSmartAccountSelection,
        registerConnectedThirdwebSmartAccount
    } = useInheritanceSettingsForm({
        inheritancePlan,
        onSmartAccountChange,
        selectedSmartAccountAddress,
        thirdwebConnectedSmartAccountAddresses,
        thirdwebSmartAccountAddress,
        walletAddress
    });
    const hasActivePlan = Boolean(inheritancePlan?.active);
    const planActionBusy = actionLoading === "inheritance-plan" || actionLoading === "inheritance-cancel";
    const canSaveInheritancePlan = Boolean(registryAddress) && !planActionBusy && !connectingForSubmit;

    useEffect(() => {
        const cachedSmartAccount = readCachedSmartAccount(walletAddress);
        if (cachedSmartAccount) {
            registerConnectedThirdwebSmartAccount(cachedSmartAccount);
        }
    }, [registerConnectedThirdwebSmartAccount, walletAddress]);

    useEffect(() => {
        if (!walletAddress || !thirdwebSmartAccountAddress) {
            return;
        }

        cacheSmartAccount(walletAddress, thirdwebSmartAccountAddress);
    }, [thirdwebSmartAccountAddress, walletAddress]);

    function requestCheckInAuthorization(permission: SessionKeyActionPermission) {
        setCheckInAuthorization(permission);

        return new Promise<boolean>((resolve) => {
            checkInAuthorizationResolverRef.current = resolve;
        });
    }

    async function connectSmartAccount(options: { grantCheckIn?: boolean; silent?: boolean } = {}) {
        if (!thirdwebClient) {
            const message = "Smart account creation is not configured yet.";
            if (!options.silent) {
                onNotice?.({ tone: "bad", message });
            }
            return undefined;
        }
        const client = thirdwebClient;

        if (!walletAddress) {
            const message = "Connect your wallet before creating a smart account.";
            if (!options.silent) {
                onNotice?.({ tone: "warn", message });
            }
            return undefined;
        }

        const provider = typeof window === "undefined" ? undefined : window.ethereum;
        if (!provider) {
            const message = "No connected wallet provider was found.";
            if (!options.silent) {
                onNotice?.({ tone: "bad", message });
            }
            return undefined;
        }

        setSmartAccountDiscoveryError("");
        setSmartAccountDropdownOpen(false);
        try {
            const shouldGrantCheckIn = options.grantCheckIn ?? true;
            const checkInPermission = shouldGrantCheckIn
                ? await agentApi.ensureSessionKeyAction({
                    walletAddress,
                    action: "checkin"
                })
                : undefined;

            if (checkInPermission && !(await requestCheckInAuthorization(checkInPermission))) {
                onNotice?.({
                    tone: "warn",
                    message: "Session-key authorization was cancelled. The smart account was not connected for Telegram check-in."
                });
                return undefined;
            }

            const connectedWallet = await connectThirdwebWallet(async (): Promise<Wallet> => {
                const personalWallet = EIP1193.fromProvider({
                    provider: provider as Parameters<typeof EIP1193.fromProvider>[0]["provider"],
                    walletId: "app.subwallet"
                });
                const personalAccount = await personalWallet.connect({
                    chain: somniaThirdwebChain,
                    client
                });
                const accountWallet = smartWallet(checkInPermission
                    ? createThirdwebAccountAbstraction({
                        overrides: { accountSalt: riskGuardAccountSalt },
                        sessionKey: {
                            address: checkInPermission.sessionKeyAddress,
                            permissions: {
                                approvedTargets: checkInPermission.approvedTargets,
                                nativeTokenLimitPerTransaction: checkInPermission.nativeTokenLimitPerTransaction,
                                permissionStartTimestamp: new Date(checkInPermission.permissionStartTimestamp),
                                permissionEndTimestamp: new Date(checkInPermission.permissionEndTimestamp)
                            }
                        }
                    })
                    : createThirdwebAccountAbstraction({
                        overrides: { accountSalt: riskGuardAccountSalt }
                    }));

                await accountWallet.connect({
                    client,
                    personalAccount
                });

                return accountWallet as unknown as Wallet;
            });
            if (!connectedWallet) {
                const message = "Smart account connection was cancelled.";
                if (!options.silent) {
                    onNotice?.({ tone: "warn", message });
                }
                return undefined;
            }
            const smartAccount = connectedWallet.getAccount()?.address ?? thirdwebSmartAccountAddress;

            if (!smartAccount) {
                const message = "Smart account was not returned by the wallet.";
                if (!options.silent) {
                    onNotice?.({ tone: "bad", message });
                }
                return undefined;
            }

            cacheSmartAccount(walletAddress, smartAccount);
            if (shouldGrantCheckIn) {
                await agentApi.ensureSessionKeyAction({
                    walletAddress,
                    smartAccountAddress: smartAccount,
                    action: "checkin"
                });
            }
            registerConnectedThirdwebSmartAccount(smartAccount);
            setSmartAccountDropdownOpen(false);
            if (!options.silent) {
                onNotice?.({ tone: "ok", message: "Smart account connected." });
            }
            return smartAccount;
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : "Smart account creation failed.";
            if (!options.silent) {
                onNotice?.({ tone: "bad", message });
            }
            return undefined;
        }
    }

    useEffect(() => {
        connectSmartAccountRef.current = connectSmartAccount;
    });

    useEffect(() => {
        if (!walletAddress || thirdwebSmartAccountAddress) {
            return;
        }

        const cachedSmartAccount = readCachedSmartAccount(walletAddress);
        if (!cachedSmartAccount) {
            return;
        }
        const cachedSmartAccountAddress = cachedSmartAccount;

        const normalizedWallet = walletAddress.toLowerCase();
        if (autoConnectAttemptRef.current === normalizedWallet) {
            return;
        }

        autoConnectAttemptRef.current = normalizedWallet;
        let cancelled = false;

        async function reconnectCachedSmartAccount() {
            const provider = typeof window === "undefined" ? undefined : window.ethereum;
            if (!provider) {
                return;
            }

            const accounts = await provider.request<string[]>({
                method: "eth_accounts"
            });
            if (!accounts.some((address) => address.toLowerCase() === normalizedWallet)) {
                return;
            }

            setAutoConnectingSmartAccount(true);
            let timeoutId: number | undefined;
            try {
                const connectedSmartAccount = await Promise.race([
                    connectSmartAccountRef.current?.({
                        grantCheckIn: false,
                        silent: true
                    }) ?? Promise.resolve(undefined),
                    new Promise<undefined>((resolve) => {
                        timeoutId = window.setTimeout(() => resolve(undefined), 6_000);
                    })
                ]);

                if (
                    !cancelled &&
                    connectedSmartAccount &&
                    connectedSmartAccount.toLowerCase() !== cachedSmartAccountAddress.toLowerCase()
                ) {
                    cacheSmartAccount(walletAddress, connectedSmartAccount);
                }
            } finally {
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                }
                if (!cancelled) {
                    setAutoConnectingSmartAccount(false);
                }
            }
        }

        void reconnectCachedSmartAccount().catch(() => {
            if (!cancelled) {
                setAutoConnectingSmartAccount(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [thirdwebSmartAccountAddress, walletAddress]);

    function resolveCheckInAuthorization(approved: boolean) {
        checkInAuthorizationResolverRef.current?.(approved);
        checkInAuthorizationResolverRef.current = null;
        setCheckInAuthorization(null);
    }

    async function handleCreateSmartAccount() {
        await connectSmartAccount();
    }

    async function handleCancelPlan() {
        if (
            inheritancePlan?.active &&
            thirdwebSmartAccountAddress?.toLowerCase() !== inheritancePlan.smartAccount.toLowerCase()
        ) {
            setConnectingForCancel(true);
            try {
                const connectedSmartAccount = await connectSmartAccount({
                    grantCheckIn: false,
                    silent: true
                });

                if (connectedSmartAccount?.toLowerCase() === inheritancePlan.smartAccount.toLowerCase()) {
                    onInheritanceCancel();
                    return;
                }

                onNotice?.({
                    tone: "warn",
                    message: "Connect the smart account shown in the active plan before cancelling it."
                });
            } finally {
                setConnectingForCancel(false);
            }
            return;
        }

        onInheritanceCancel();
    }

    async function handlePlanSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
        const targetSmartAccount = smartAccountAddress || inheritancePlan?.smartAccount;

        if (
            targetSmartAccount &&
            thirdwebSmartAccountAddress?.toLowerCase() !== targetSmartAccount.toLowerCase()
        ) {
            event.preventDefault();
            pendingSubmitFormRef.current = event.currentTarget;
            setConnectingForSubmit(true);
            try {
                const connectedSmartAccount = await connectSmartAccount({
                    grantCheckIn: true,
                    silent: true
                });

                if (connectedSmartAccount?.toLowerCase() === targetSmartAccount.toLowerCase()) {
                    pendingSubmitFormRef.current.requestSubmit();
                    return;
                }

                onNotice?.({
                    tone: "warn",
                    message: "Connect the selected smart account before saving this inheritance plan."
                });
            } finally {
                setConnectingForSubmit(false);
            }
            return;
        }

        onInheritanceSubmit(event);
    }

    async function handleCopySmartAccount() {
        if (!smartAccountAddress) {
            return;
        }

        try {
            await navigator.clipboard.writeText(smartAccountAddress);
            setCopiedSmartAccount(true);
            onNotice?.({ tone: "ok", message: "Smart account address copied." });
            window.setTimeout(() => setCopiedSmartAccount(false), 1400);
        } catch {
            onNotice?.({ tone: "bad", message: "Could not copy smart account address." });
        }
    }

    return (
        <form className="inheritance-screen" onSubmit={(event) => void handlePlanSubmit(event)}>
            <section className="inheritance-layout">
                <div className="inheritance-main">
                    <section className="account-budget-row">
                        {hasActivePlan ? (
                            <section className="inheritance-card current-plan-card">
                                <div className="inheritance-section-head">
                                    <div>
                                        <Radar size={19} />
                                        <h3>Current Smart Account Will</h3>
                                    </div>
                                    <strong className="contract-pill">Active</strong>
                                </div>
                                <div className="current-plan-grid">
                                    <span><small>Smart account</small><strong>{formatAddressPreview(inheritancePlan?.smartAccount)}</strong></span>
                                    <span><small>Registry</small><strong>{formatAddressPreview(inheritancePlan?.registryAddress)}</strong></span>
                                    <span><small>Protected assets</small><strong>{formatProtectedAssets(inheritancePlan)}</strong></span>
                                    <span><small>Next heartbeat deadline</small><strong>{formatPlanDate(inheritancePlan?.nextDeadlineAt)}</strong></span>
                                    <span><small>Executable after</small><strong>{formatPlanDate(inheritancePlan?.timelockEndsAt)}</strong></span>
                                </div>
                                <Button
                                    className="cancel-plan-button"
                                    disabled={actionLoading === "inheritance-cancel" || connectingForCancel}
                                    onClick={() => void handleCancelPlan()}
                                    type="button"
                                    variant="secondary"
                                >
                                    {actionLoading === "inheritance-cancel" || connectingForCancel ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                                    {connectingForCancel ? "Connecting account" : "Cancel"}
                                </Button>
                            </section>
                        ) : (
                            <section className="inheritance-card smart-account-card">
                                <div className="inheritance-section-head">
                                    <div>
                                        <WalletCards size={19} />
                                        <h3>Smart Account</h3>
                                        <InfoHint help="Choose the smart account that will hold and manage the inheritance plan." />
                                    </div>
                                </div>
                                <input name="smartAccountAddress" type="hidden" value={smartAccountAddress} />
                                <div className="smart-account-selector">
                                    <div className="smart-account-trigger-row">
                                        <button
                                            aria-expanded={smartAccountDropdownOpen}
                                            className="smart-account-select-trigger"
                                            onClick={toggleSmartAccountDropdown}
                                            type="button"
                                        >
                                            <span>
                                                {smartAccountAddress
                                                    ? formatAddressPreview(smartAccountAddress)
                                                    : autoConnectingSmartAccount ? "Connecting smart account" : "Select smart account"}
                                            </span>
                                            {discoveringSmartAccounts || (autoConnectingSmartAccount && !smartAccountAddress) ? <Loader2 className="spin" size={16} /> : <ChevronDown size={16} />}
                                        </button>
                                        {smartAccountAddress ? (
                                            <Button
                                                aria-label="Copy smart account address"
                                                className="smart-account-copy-button"
                                                onClick={() => void handleCopySmartAccount()}
                                                type="button"
                                                variant="secondary"
                                            >
                                                {copiedSmartAccount ? <Check size={15} /> : <Copy size={15} />}
                                            </Button>
                                        ) : null}
                                    </div>
                                    {smartAccountDropdownOpen ? (
                                        <div className="smart-account-select-content">
                                            {discoveringSmartAccounts ? (
                                                <div aria-label="Loading smart accounts" className="smart-account-select-loading">
                                                    <Loader2 className="spin" size={16} />
                                                </div>
                                            ) : smartAccountDiscoveryError ? (
                                                <div className="smart-account-select-empty">
                                                    {smartAccountDiscoveryError}
                                                </div>
                                            ) : smartAccountCandidates.length === 0 ? (
                                                <div className="smart-account-select-empty">
                                                    <span>
                                                        No smart account connected.{" "}
                                                        <button
                                                            className="smart-account-create-button"
                                                            disabled={creatingSmartAccount}
                                                            onClick={() => void handleCreateSmartAccount()}
                                                            type="button"
                                                        >
                                                            {creatingSmartAccount ? "creating" : "Create a smart account"}
                                                        </button>{" "}
                                                        or{" "}
                                                        <button
                                                            onClick={() => void findSmartAccounts()}
                                                            type="button"
                                                        >
                                                            reload
                                                        </button>{" "}
                                                        the wallet list.
                                                    </span>
                                                </div>
                                            ) : smartAccountCandidates.map((candidate) => (
                                                <button
                                                    className="smart-account-select-item"
                                                    key={candidate.address}
                                                    onClick={() => {
                                                        updateSmartAccountSelection(candidate.address);
                                                        setSmartAccountDropdownOpen(false);
                                                    }}
                                                    type="button"
                                                >
                                                    <WalletCards size={15} />
                                                    <span>{formatAddressPreview(candidate.address)}</span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                                {submitAttempted && smartAccountError ? <p className="field-error">{smartAccountError}</p> : null}
                            </section>
                        )}

                    </section>

                    <section className="timing-stack">
                        <DurationField
                            duration={intervalDuration}
                            help="How often you must renew the heartbeat before the switch starts moving toward inheritance. (Minimum 1 day)"
                            label="Heartbeat interval"
                            namePrefix="interval"
                            onChange={setIntervalDuration}
                        />
                        <DurationField
                            duration={graceDuration}
                            help="Extra time after a missed heartbeat before the account is considered expired. Testnet can be 0."
                            label="Grace period"
                            namePrefix="grace"
                            onChange={setGraceDuration}
                        />
                        <DurationField
                            duration={timelockDuration}
                            help="Final waiting period after grace ends. Testnet can be 0; production should use a safer delay."
                            label="Beneficiary timelock"
                            namePrefix="timelock"
                            onChange={setTimelockDuration}
                        />
                    </section>

                    <section className="inheritance-card assets-card">
                        <div className="inheritance-section-head">
                            <div>
                                <Coins size={19} />
                                <h3>Protected Assets</h3>
                                <InfoHint help="These are the native and ERC-20 balances the smart account should distribute after expiry." />
                            </div>
                            <Button onClick={() => setTokenDialogOpen(true)} type="button" variant="secondary">
                                <Plus size={16} />
                                Import token
                            </Button>
                        </div>
                        <label className="native-asset-toggle">
                            <input
                                checked={includeNativeAsset}
                                name="includeNativeAsset"
                                onChange={(event) => setIncludeNativeAsset(event.target.checked)}
                                type="checkbox"
                                value="true"
                            />
                            Native STT
                        </label>
                        <div className="token-list">
                            {tokens.map((token) => (
                                <div className="token-row" key={token.address.toLowerCase()}>
                                    <Coins size={15} />
                                    <strong>{token.symbol}</strong>
                                    <small>{formatAddressPreview(token.address)} · {token.decimals} decimals</small>
                                    <input name="erc20Assets" type="hidden" value={token.address} />
                                    <Button
                                        aria-label={`Remove ${token.symbol}`}
                                        className="token-remove"
                                        onClick={() => setTokens((current) => current.filter((item) => item.address.toLowerCase() !== token.address.toLowerCase()))}
                                        type="button"
                                        variant="ghost"
                                    >
                                        <Trash2 size={15} />
                                    </Button>
                                </div>
                            ))}
                        </div>
                        {submitAttempted && assetError ? <p className="field-error">{assetError}</p> : null}
                    </section>

                    <section className="inheritance-card recipients-card">
                        <div className="inheritance-section-head">
                            <div>
                                <Users size={19} />
                                <h3>Recipient Accounts</h3>
                                <InfoHint help="Wallet addresses listed here receive the configured shares after heartbeat, grace, and timelock periods finish." />
                            </div>
                            <Button
                                aria-label="Add recipient account"
                                className="add-account-button"
                                disabled={addDisabled}
                                onClick={addBeneficiary}
                                type="button"
                                variant="secondary"
                            >
                                <Plus size={16} />
                                Add account
                            </Button>
                        </div>

                        <div className="beneficiary-list">
                            {beneficiaries.map((beneficiary, index) => {
                                const addressError = getBeneficiaryAddressError(beneficiary.address, index, smartAccountAddress, beneficiaries, beneficiary.id);
                                const shareError = getBeneficiaryShareError(beneficiary.sharePercent, index);

                                return (
                                    <div className={beneficiary.locked ? "beneficiary-row beneficiary-row-locked" : "beneficiary-row"} key={beneficiary.id}>
                                        <div
                                            className="beneficiary-index"
                                            style={{
                                                "--recipient-color": getRecipientColor(index)
                                            } as CSSProperties}
                                        >
                                            <UserPlus size={17} />
                                            <span>{index + 1}</span>
                                        </div>
                                        <Field
                                            error={submitAttempted ? addressError || undefined : undefined}
                                            id={`beneficiary-address-${beneficiary.id}`}
                                            label="Recipient wallet address"
                                        >
                                            <Input
                                                aria-invalid={Boolean(submitAttempted && addressError)}
                                                id={`beneficiary-address-${beneficiary.id}`}
                                                name="beneficiaryAddress"
                                                onChange={(event) => updateBeneficiary(beneficiary.id, { address: event.target.value })}
                                                required
                                                value={beneficiary.address}
                                            />
                                        </Field>
                                        <Field
                                            error={submitAttempted ? shareError || undefined : undefined}
                                            help="Percent of protected balances this recipient receives. Editing one unlocked recipient automatically rebalances the others."
                                            id={`beneficiary-share-${beneficiary.id}`}
                                            label="Inheritance share"
                                        >
                                            <div className="input-with-unit">
                                                <Input
                                                    aria-invalid={Boolean(submitAttempted && shareError)}
                                                    disabled={beneficiary.locked}
                                                    id={`beneficiary-share-${beneficiary.id}`}
                                                    inputMode="decimal"
                                                    name="sharePercent"
                                                    onBlur={() => updateBeneficiaryShare(beneficiary.id, String(beneficiary.sharePercent))}
                                                    onChange={(event) => updateBeneficiaryShare(beneficiary.id, event.target.value)}
                                                    required
                                                    type="text"
                                                    value={beneficiary.sharePercent}
                                                />
                                                <span>%</span>
                                            </div>
                                        </Field>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    aria-label={beneficiary.locked ? "Unlock recipient share" : "Lock recipient share"}
                                                    aria-pressed={beneficiary.locked}
                                                    className={beneficiary.locked ? "lock-button lock-button-active" : "lock-button"}
                                                    onClick={() => toggleBeneficiaryLock(beneficiary.id)}
                                                    type="button"
                                                    variant="ghost"
                                                >
                                                    {beneficiary.locked ? <Lock size={16} /> : <Unlock size={16} />}
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent className="riskguard-tooltip" sideOffset={8}>
                                                {beneficiary.locked
                                                    ? "Unlock this share before editing or auto-balancing it."
                                                    : "Lock this percentage so other recipients rebalance around it."}
                                            </TooltipContent>
                                        </Tooltip>
                                        <Button
                                            aria-label="Remove recipient account"
                                            className="icon-button"
                                            disabled={!canRemove}
                                            onClick={() => removeBeneficiary(beneficiary.id)}
                                            type="button"
                                            variant="ghost"
                                        >
                                            <Trash2 size={16} />
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                        {submitAttempted && allocationError ? <p className="field-error">{allocationError}</p> : null}
                    </section>
                </div>

                <aside className="contract-preview-panel">
                    <div className="preview-glow" aria-hidden="true" />
                    <section className="preview-vault">
                        <div className="preview-topline">
                            <span><Radar size={15} /> Smart Account Will</span>
                            <strong className={hasActivePlan ? "status-ok" : hasCreatorWallet ? "status-warn" : "status-bad"}>
                                {hasActivePlan ? "Active" : hasCreatorWallet ? "New plan" : "No wallet"}
                            </strong>
                        </div>

                        <div className="vault-orbit">
                            <svg aria-hidden="true" className="vault-allocation-ring" viewBox="0 0 120 120">
                                <circle className="vault-ring-track" cx="60" cy="60" r="52" pathLength="100" />
                                {allocationSegments.map((segment) => (
                                    <circle
                                        className="vault-ring-segment"
                                        cx="60"
                                        cy="60"
                                        key={segment.id}
                                        pathLength="100"
                                        r="52"
                                        style={{
                                            "--segment-color": segment.color,
                                            "--segment-offset": `${-segment.offset}`,
                                            "--segment-rest": segment.rest,
                                            "--segment-share": segment.share
                                        } as CSSProperties}
                                    />
                                ))}
                            </svg>
                            <div>
                                <LockKeyhole size={30} />
                                <strong>{shareTotal}%</strong>
                                <span>allocated</span>
                            </div>
                        </div>

                        <div className="recipient-allocation-legend" aria-label="Recipient allocation legend">
                            {beneficiaries.map((beneficiary, index) => (
                                <span
                                    key={beneficiary.id}
                                    style={{ "--recipient-color": getRecipientColor(index) } as CSSProperties}
                                >
                                    <i aria-hidden="true" />
                                    <strong>{formatRecipientLabel(beneficiary, index)}</strong>
                                    <small>{beneficiary.sharePercent}%</small>
                                </span>
                            ))}
                        </div>

                        <div className="preview-stat-grid">
                            <span><Users size={16} /><strong>{beneficiaries.length}</strong><small>Recipients</small></span>
                            <span><CalendarClock size={16} /><strong>{formatDurationPreview(intervalDuration)}</strong><small>Renewal</small></span>
                            <span><Activity size={16} /><strong>{formatDurationPreview(graceDuration)}</strong><small>Grace</small></span>
                            <span><Fingerprint size={16} /><strong>{formatDurationPreview(timelockDuration)}</strong><small>Timelock</small></span>
                        </div>

                        {submitAttempted && submitBlockReason ? (
                            <p className="preview-note status-bad">{submitBlockReason}</p>
                        ) : null}

                        {!registryAddress ? (
                            <p className="preview-note status-warn">Deploy and configure the Inheritance Registry before saving on testnet.</p>
                        ) : null}

                        <p className="preview-note">
                            Funds stay usable by the smart account. After expiry, automation executes native/ERC-20 transfers through the authorized account module.
                        </p>

                        <Button
                            className="primary-button inheritance-save"
                            disabled={!canSaveInheritancePlan}
                            onClick={() => setSubmitAttempted(true)}
                            type="submit"
                            variant="primary"
                        >
                            {actionLoading === "inheritance-plan" || connectingForSubmit ? <Loader2 className="spin" size={16} /> : <WalletCards size={16} />}
                            {connectingForSubmit
                                ? "Connecting account"
                                : actionLoading === "inheritance-plan"
                                    ? "Saving plan"
                                    : hasActivePlan ? "Update inheritance plan" : "Create inheritance plan"}
                        </Button>
                    </section>
                </aside>
            </section>

            {checkInAuthorization ? (
                <div className="profile-modal-overlay" role="presentation">
                    <div aria-modal="true" className="profile-modal" role="dialog">
                        <h3>Authorize Telegram check-in</h3>
                        <p>
                            RiskGuard needs your signature so the agent can send heartbeat check-ins from Telegram when you use /checkin.
                        </p>
                        <p>
                            This does not transfer funds and does not give the agent permission to send, swap, or manage your assets.
                        </p>
                        <div className="profile-modal-actions">
                            <Button onClick={() => resolveCheckInAuthorization(false)} type="button" variant="secondary">
                                Cancel
                            </Button>
                            <Button
                                className="confirm-button"
                                onClick={() => resolveCheckInAuthorization(true)}
                                type="button"
                                variant="primary"
                            >
                                Continue to wallet
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            <DialogPrimitive.Root open={tokenDialogOpen} onOpenChange={(open) => {
                setTokenDialogOpen(open);
                if (!open) {
                    setTokenSubmitted(false);
                }
            }}>
                <DialogPrimitive.Portal>
                    <DialogPrimitive.Overlay className="token-dialog-overlay" />
                    <DialogPrimitive.Content className="token-dialog-content">
                        <DialogPrimitive.Title>Import token</DialogPrimitive.Title>
                        <p className="token-dialog-description">
                            Add an ERC-20 asset that the smart account should distribute with this plan.
                        </p>
                        <Field
                            error={tokenSubmitted ? tokenAddressError || undefined : undefined}
                            id="token-contract-address"
                            label="Token contract address"
                        >
                            <Input
                                id="token-contract-address"
                                onChange={(event) => setTokenDraft((current) => ({ ...current, address: event.target.value }))}
                                ref={tokenAddressRef}
                                value={tokenDraft.address}
                            />
                        </Field>
                        <Field
                            error={tokenSubmitted ? tokenSymbolError || undefined : undefined}
                            id="token-symbol"
                            label="Token symbol"
                        >
                            <Input
                                id="token-symbol"
                                maxLength={11}
                                onChange={(event) => setTokenDraft((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))}
                                ref={tokenSymbolRef}
                                value={tokenDraft.symbol}
                            />
                        </Field>
                        <Field
                            error={tokenSubmitted ? tokenDecimalsError || undefined : undefined}
                            id="token-decimals"
                            label="Token decimal"
                        >
                            <Input
                                id="token-decimals"
                                inputMode="numeric"
                                onChange={(event) => setTokenDraft((current) => ({ ...current, decimals: clampNumber(event.target.value, 0, 255) }))}
                                ref={tokenDecimalsRef}
                                value={tokenDraft.decimals}
                            />
                        </Field>
                        <div className="token-dialog-actions">
                            <Button onClick={() => setTokenDialogOpen(false)} type="button" variant="secondary">Cancel</Button>
                            <Button onClick={addToken} type="button" variant="primary">Add token</Button>
                        </div>
                    </DialogPrimitive.Content>
                </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
        </form>
    );
}
