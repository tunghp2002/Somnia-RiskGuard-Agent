import { useEffect, useMemo, useRef, useState } from "react";

import type { InheritancePlanStatus } from "@/lib/agent-api";
import type { SmartAccountCandidate } from "@/lib/inheritance-registry";

import type { BeneficiaryDraft, DurationDraft, TokenDraft } from "./inheritance-settings.types";
import {
  beneficiariesFromPlan,
  clampNumber,
  getBeneficiaryAddressError,
  getBeneficiaryShareError,
  getRecipientColor,
  getShareInputValue,
  getTokenAddressError,
  getTokenDecimalsError,
  getTokenSymbolError,
  initialBeneficiaries,
  minAgentBudgetSTT,
  normalizeBeneficiaryShares,
  rebalanceBeneficiaryShare,
  roundShare,
  secondsToDuration,
  tokensFromPlan,
  walletAddressPattern
} from "./inheritance-settings.utils";

export function useInheritanceSettingsForm({
  inheritancePlan,
  onSmartAccountChange,
  selectedSmartAccountAddress,
  thirdwebConnectedSmartAccountAddresses = [],
  thirdwebSmartAccountAddress,
  walletAddress
}: {
  inheritancePlan?: InheritancePlanStatus | null | undefined;
  onSmartAccountChange: (address: string | undefined) => void;
  selectedSmartAccountAddress?: string | undefined;
  thirdwebConnectedSmartAccountAddresses?: string[] | undefined;
  thirdwebSmartAccountAddress?: string | undefined;
  walletAddress?: string | undefined;
}) {
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryDraft[]>(initialBeneficiaries);
  const [intervalDuration, setIntervalDuration] = useState<DurationDraft>({ days: "30", hours: "0" });
  const [graceDuration, setGraceDuration] = useState<DurationDraft>({ days: "0", hours: "0" });
  const [timelockDuration, setTimelockDuration] = useState<DurationDraft>({ days: "0", hours: "0" });
  const [smartAccountAddress, setSmartAccountAddress] = useState(selectedSmartAccountAddress ?? "");
  const [smartAccountCandidates, setSmartAccountCandidates] = useState<SmartAccountCandidate[]>([]);
  const [smartAccountDropdownOpen, setSmartAccountDropdownOpen] = useState(false);
  const [smartAccountDiscoveryChecked, setSmartAccountDiscoveryChecked] = useState(false);
  const [smartAccountDiscoveryError, setSmartAccountDiscoveryError] = useState("");
  const [discoveringSmartAccounts, setDiscoveringSmartAccounts] = useState(false);
  const [includeNativeAsset, setIncludeNativeAsset] = useState(true);
  const [tokens, setTokens] = useState<TokenDraft[]>([]);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [tokenSubmitted, setTokenSubmitted] = useState(false);
  const [tokenDraft, setTokenDraft] = useState<TokenDraft>({ address: "", symbol: "", decimals: "" });
  const [agentBudgetSTT, setAgentBudgetSTT] = useState(String(minAgentBudgetSTT));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const tokenAddressRef = useRef<HTMLInputElement>(null);
  const tokenSymbolRef = useRef<HTMLInputElement>(null);
  const tokenDecimalsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSmartAccountAddress(selectedSmartAccountAddress ?? "");
  }, [selectedSmartAccountAddress]);

  useEffect(() => {
    setSmartAccountCandidates([]);
    setSmartAccountDiscoveryChecked(false);
    setSmartAccountDiscoveryError("");
    setSmartAccountDropdownOpen(false);
  }, [walletAddress]);

  useEffect(() => {
    useConnectedThirdwebSmartAccount(thirdwebSmartAccountAddress);
  }, [thirdwebSmartAccountAddress]);

  useEffect(() => {
    useConnectedThirdwebSmartAccounts(thirdwebConnectedSmartAccountAddresses);
  }, [thirdwebConnectedSmartAccountAddresses.join("|")]);

  useEffect(() => {
    if (!inheritancePlan?.active) {
      setBeneficiaries(initialBeneficiaries);
      setIntervalDuration({ days: "30", hours: "0" });
      setGraceDuration({ days: "0", hours: "0" });
      setTimelockDuration({ days: "0", hours: "0" });
      setIncludeNativeAsset(true);
      setTokens([]);
      return;
    }

    setBeneficiaries(beneficiariesFromPlan(inheritancePlan));
    setIntervalDuration(secondsToDuration(inheritancePlan.heartbeatIntervalSeconds));
    setGraceDuration(secondsToDuration(inheritancePlan.gracePeriodSeconds));
    setTimelockDuration(secondsToDuration(inheritancePlan.timelockPeriodSeconds));
    setIncludeNativeAsset(inheritancePlan.protectedAssets.some((asset) => asset.kind === "native"));
    setTokens(tokensFromPlan(inheritancePlan));
  }, [inheritancePlan]);

  const shareTotal = useMemo(
    () => roundShare(beneficiaries.reduce((total, beneficiary) => total + Number(beneficiary.sharePercent || 0), 0)),
    [beneficiaries]
  );

  const allocationSegments = useMemo(() => {
    let offset = 0;

    return beneficiaries.map((beneficiary, index) => {
      const share = Math.min(100, Math.max(0, roundShare(Number(beneficiary.sharePercent || 0))));
      const segment = {
        color: getRecipientColor(index),
        id: beneficiary.id,
        offset,
        rest: roundShare(100 - share),
        share
      };

      offset = roundShare(offset + share);
      return segment;
    });
  }, [beneficiaries]);

  const lockedShareTotal = useMemo(
    () => beneficiaries
      .filter((beneficiary) => beneficiary.locked)
      .reduce((total, beneficiary) => total + Number(beneficiary.sharePercent || 0), 0),
    [beneficiaries]
  );

  const tokenAddressError = getTokenAddressError(tokenDraft.address, tokens);
  const tokenSymbolError = getTokenSymbolError(tokenDraft.symbol);
  const tokenDecimalsError = getTokenDecimalsError(tokenDraft.decimals);
  const hasProtectedAsset = includeNativeAsset || tokens.length > 0;
  const canRemove = beneficiaries.length > 1;
  const addDisabled = beneficiaries.length >= 20 || (beneficiaries.every((beneficiary) => beneficiary.locked) && lockedShareTotal >= 100);
  const allocationError = Math.abs(shareTotal - 100) > 0.001
    ? "Recipient shares must total 100%."
    : "";
  const firstAddressError = beneficiaries
    .map((beneficiary, index) => getBeneficiaryAddressError(beneficiary.address, index, smartAccountAddress, beneficiaries, beneficiary.id))
    .find(Boolean) ?? "";
  const firstShareError = beneficiaries
    .map((beneficiary, index) => getBeneficiaryShareError(beneficiary.sharePercent, index))
    .find(Boolean) ?? "";
  const budgetError = Number(agentBudgetSTT || 0) < minAgentBudgetSTT
    ? `Agent budget must be at least ${minAgentBudgetSTT} STT.`
    : "";
  const smartAccountError = walletAddressPattern.test(smartAccountAddress)
    ? ""
    : "Select a smart account before saving.";
  const assetError = hasProtectedAsset ? "" : "Select native STT or import at least one ERC-20 token.";
  const submitBlockReason = smartAccountError || firstAddressError || firstShareError || allocationError || assetError || budgetError;
  const hasCreatorWallet = walletAddressPattern.test(walletAddress?.trim() ?? "");

  function updateSmartAccountSelection(address?: string) {
    const nextAddress = address ?? "";
    setSmartAccountAddress(nextAddress);
    onSmartAccountChange(nextAddress || undefined);
  }

  function useConnectedThirdwebSmartAccount(address?: string) {
    if (!address || !walletAddressPattern.test(address)) {
      return;
    }

    setSmartAccountCandidates((current) => {
      if (current.some((candidate) => candidate.address.toLowerCase() === address.toLowerCase())) {
        return current;
      }

      return [{ address, kind: "contract" }, ...current];
    });
    setSmartAccountDiscoveryChecked(true);
    updateSmartAccountSelection(address);
  }

  function useConnectedThirdwebSmartAccounts(addresses: string[]) {
    const validAddresses = addresses.filter((address) => walletAddressPattern.test(address));
    if (validAddresses.length === 0) {
      return;
    }

    setSmartAccountCandidates((current) => {
      const next = [...current];
      for (const address of validAddresses) {
        if (!next.some((candidate) => candidate.address.toLowerCase() === address.toLowerCase())) {
          next.push({ address, kind: "contract" });
        }
      }

      return next;
    });
    setSmartAccountDiscoveryChecked(true);

    if (!smartAccountAddress) {
      updateSmartAccountSelection(validAddresses[0]);
    }
  }

  async function findSmartAccounts() {
    setDiscoveringSmartAccounts(true);
    setSmartAccountDiscoveryError("");

    try {
      const candidates = thirdwebSmartAccountAddress && walletAddressPattern.test(thirdwebSmartAccountAddress)
        ? [{ address: thirdwebSmartAccountAddress, kind: "contract" as const }]
        : [];
      setSmartAccountCandidates(candidates);
      setSmartAccountDiscoveryChecked(true);

      const onlyCandidate = candidates[0];
      if (candidates.length === 1 && onlyCandidate) {
        updateSmartAccountSelection(onlyCandidate.address);
      }
    } catch (error) {
      setSmartAccountCandidates([]);
      setSmartAccountDiscoveryChecked(true);
      setSmartAccountDiscoveryError(error instanceof Error ? error.message : "Unable to load smart accounts.");
    } finally {
      setDiscoveringSmartAccounts(false);
    }
  }

  function toggleSmartAccountDropdown() {
    setSmartAccountDropdownOpen((isOpen) => !isOpen);

    if (!smartAccountDiscoveryChecked && !discoveringSmartAccounts) {
      void findSmartAccounts();
    }
  }

  function updateBeneficiary(id: number, patch: Partial<BeneficiaryDraft>) {
    setBeneficiaries((current) =>
      current.map((beneficiary) => beneficiary.id === id ? { ...beneficiary, ...patch } : beneficiary)
    );
  }

  function updateBeneficiaryShare(id: number, value: string) {
    setBeneficiaries((current) => rebalanceBeneficiaryShare(current, id, getShareInputValue(value)));
  }

  function addBeneficiary() {
    setBeneficiaries((current) => {
      const currentLockedTotal = current
        .filter((beneficiary) => beneficiary.locked)
        .reduce((total, beneficiary) => total + beneficiary.sharePercent, 0);

      if (current.length >= 20 || (current.every((beneficiary) => beneficiary.locked) && currentLockedTotal >= 100)) {
        return current;
      }

      const nextId = Math.max(...current.map((beneficiary) => beneficiary.id)) + 1;
      return [...current, { id: nextId, address: "", sharePercent: 0, locked: false }];
    });
  }

  function removeBeneficiary(id: number) {
    setBeneficiaries((current) => {
      if (current.length === 1) {
        return current;
      }

      return normalizeBeneficiaryShares(current.filter((beneficiary) => beneficiary.id !== id));
    });
  }

  function toggleBeneficiaryLock(id: number) {
    setBeneficiaries((current) =>
      current.map((beneficiary) => beneficiary.id === id
        ? { ...beneficiary, locked: !beneficiary.locked }
        : beneficiary)
    );
  }

  function addToken() {
    setTokenSubmitted(true);

    if (tokenAddressError) {
      tokenAddressRef.current?.focus();
      return;
    }

    if (tokenSymbolError) {
      tokenSymbolRef.current?.focus();
      return;
    }

    if (tokenDecimalsError) {
      tokenDecimalsRef.current?.focus();
      return;
    }

    setTokens((current) => [...current, {
      address: tokenDraft.address.trim(),
      symbol: tokenDraft.symbol.trim().toUpperCase(),
      decimals: tokenDraft.decimals.trim()
    }]);
    setTokenDraft({ address: "", symbol: "", decimals: "" });
    setTokenSubmitted(false);
    setTokenDialogOpen(false);
  }

  return {
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
    useConnectedThirdwebSmartAccount,
    useConnectedThirdwebSmartAccounts
  };
}
