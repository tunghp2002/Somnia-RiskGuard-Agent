import { useState, type CSSProperties, type FormEvent } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useActiveAccount, useConnectedWallets, useConnect } from "thirdweb/react";
import { EIP1193, smartWallet } from "thirdweb/wallets";
import type { Wallet } from "thirdweb/wallets";
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

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { InheritancePlanStatus } from "@/lib/agent-api";
import type { Notice } from "@/features/dashboard/types";
import {
    thirdwebAccountAbstraction,
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
    minAgentBudgetSTT,
} from "./inheritance-settings.utils";
import { useInheritanceSettingsForm } from "./use-inheritance-settings-form";

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
    onInheritanceSubmit: (event: FormEvent<HTMLFormElement>) => void;
    onNotice?: (notice: Notice) => void;
    onSmartAccountChange: (address: string | undefined) => void;
    registryAddress?: string | undefined;
    selectedSmartAccountAddress?: string | undefined;
    walletAddress?: string | undefined;
}) {
    const thirdwebSmartAccount = useActiveAccount();
    const { connect: connectThirdwebWallet, isConnecting: creatingSmartAccount } = useConnect();
    const [copiedSmartAccount, setCopiedSmartAccount] = useState(false);
    const thirdwebSmartAccountAddress = thirdwebSmartAccount?.address;
    const thirdwebConnectedSmartAccountAddresses = useConnectedWallets()
        .map((wallet) => wallet.getAccount()?.address)
        .filter((address): address is string => Boolean(address));
    const {
        addBeneficiary,
        addDisabled,
        addToken,
        agentBudgetSTT,
        allocationError,
        allocationSegments,
        assetError,
        beneficiaries,
        budgetError,
        canRemove,
        discoveringSmartAccounts,
        findSmartAccounts,
        graceDuration,
        hasCreatorWallet,
        includeNativeAsset,
        intervalDuration,
        removeBeneficiary,
        setAgentBudgetSTT,
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
        useConnectedThirdwebSmartAccount
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
    const canSaveInheritancePlan = Boolean(registryAddress) && !planActionBusy;

    async function handleCreateSmartAccount() {
        if (!thirdwebClient) {
            const message = "Smart account creation is not configured yet.";
            onNotice?.({ tone: "bad", message });
            return;
        }
        const client = thirdwebClient;

        if (!walletAddress) {
            const message = "Connect your wallet before creating a smart account.";
            onNotice?.({ tone: "warn", message });
            return;
        }

        const provider = typeof window === "undefined" ? undefined : window.ethereum;
        if (!provider) {
            const message = "No connected wallet provider was found.";
            onNotice?.({ tone: "bad", message });
            return;
        }

        setSmartAccountDiscoveryError("");
        setSmartAccountDropdownOpen(false);
        try {
            const connectedWallet = await connectThirdwebWallet(async (): Promise<Wallet> => {
                const personalWallet = EIP1193.fromProvider({
                    provider: provider as Parameters<typeof EIP1193.fromProvider>[0]["provider"],
                    walletId: "app.subwallet"
                });
                const personalAccount = await personalWallet.connect({
                    chain: thirdwebAccountAbstraction.chain,
                    client
                });
                const accountWallet = smartWallet(thirdwebAccountAbstraction);

                await accountWallet.connect({
                    client,
                    personalAccount
                });

                return accountWallet as unknown as Wallet;
            });
            if (!connectedWallet) {
                const message = "Smart account connection was cancelled.";
                onNotice?.({ tone: "warn", message });
                return;
            }
            const smartAccount = connectedWallet.getAccount()?.address ?? thirdwebSmartAccountAddress;

            if (!smartAccount) {
                const message = "Smart account was not returned by the wallet.";
                onNotice?.({ tone: "bad", message });
                return;
            }

            useConnectedThirdwebSmartAccount(smartAccount);
            setSmartAccountDropdownOpen(false);
            onNotice?.({ tone: "ok", message: "Smart account connected." });
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : "Smart account creation failed.";
            onNotice?.({ tone: "bad", message });
        }
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
        <form className="inheritance-screen" onSubmit={onInheritanceSubmit}>
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
                                    disabled={actionLoading === "inheritance-cancel"}
                                    onClick={onInheritanceCancel}
                                    type="button"
                                    variant="secondary"
                                >
                                    {actionLoading === "inheritance-cancel" ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                                    Cancel will
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
                                            <span>{smartAccountAddress ? formatAddressPreview(smartAccountAddress) : "Select smart account"}</span>
                                            {discoveringSmartAccounts ? <Loader2 className="spin" size={16} /> : <ChevronDown size={16} />}
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

                        <section className="inheritance-card agent-budget-card">
                            <div className="inheritance-section-head">
                                <div>
                                    <Activity size={19} />
                                    <h3>Agent Budget</h3>
                                    <InfoHint help="This STT funds Somnia agent requests for heartbeat checks and automated distribution." />
                                </div>
                            </div>
                            <div className="input-with-unit budget-input-row">
                                <Input
                                    inputMode="decimal"
                                    min={minAgentBudgetSTT}
                                    name="agentBudgetSTT"
                                    onChange={(event) => setAgentBudgetSTT(clampNumber(event.target.value, 0, 1000, true, 5))}
                                    required
                                    step="0.01"
                                    type="text"
                                    value={agentBudgetSTT}
                                />
                                <span>STT</span>
                            </div>
                            {submitAttempted && budgetError ? <p className="field-error">{budgetError}</p> : null}
                        </section>
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
                            {actionLoading === "inheritance-plan" ? <Loader2 className="spin" size={16} /> : <WalletCards size={16} />}
                            {actionLoading === "inheritance-plan"
                                ? "Saving plan"
                                : hasActivePlan ? "Update inheritance plan" : "Create inheritance plan"}
                        </Button>
                    </section>
                </aside>
            </section>

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
