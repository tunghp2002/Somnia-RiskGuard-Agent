import type { InheritancePlanStatus } from "@/lib/agent-api";

import type { BeneficiaryDraft, DurationDraft, TokenDraft } from "./inheritance-settings.types";

export const initialBeneficiaries: BeneficiaryDraft[] = [
  { id: 1, address: "", sharePercent: 100, locked: false }
];

export const recipientColors = ["#a78bfa", "#22d3ee", "#34d399", "#f59e0b", "#fb7185", "#60a5fa", "#f472b6", "#c4b5fd"];
export const nativeAssetAddress = "0x0000000000000000000000000000000000000000";
export const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;

export function clampNumber(value: string, min: number, max: number, allowDecimal = false, maxDecimalPlaces = 5) {
  const cleaned = value.replace(allowDecimal ? /[^\d.]/g : /\D/g, "");
  const normalized = allowDecimal
    ? cleaned
      .replace(/(\..*)\./g, "$1")
      .replace(new RegExp(`^(\\d*\\.?\\d{0,${maxDecimalPlaces}}).*$`), "$1")
    : cleaned;

  if (normalized === "") {
    return "";
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    return String(min);
  }

  return String(Math.min(max, Math.max(min, numeric)));
}

export function roundShare(value: number) {
  return Math.round((value + Number.EPSILON) * 100_000) / 100_000;
}

export function getShareInputValue(value: string) {
  return Number(clampNumber(value, 0, 100, true, 5) || 0);
}

export function getRecipientColor(index: number) {
  return recipientColors[index % recipientColors.length];
}

export function formatDurationPreview(duration: DurationDraft) {
  const days = Number(duration.days || 0);
  return `${days}d`;
}

export function formatRecipientLabel(beneficiary: BeneficiaryDraft, index: number) {
  const address = beneficiary.address.trim();

  if (walletAddressPattern.test(address)) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  return `Recipient ${index + 1}`;
}

export function formatAddressPreview(address?: string) {
  const trimmedAddress = address?.trim() ?? "";

  if (!walletAddressPattern.test(trimmedAddress)) {
    return "Creator wallet";
  }

  return `${trimmedAddress.slice(0, 6)}...${trimmedAddress.slice(-4)}`;
}

export function formatPlanDate(value?: string) {
  if (!value) {
    return "not set";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function secondsToDuration(seconds?: number): DurationDraft {
  const safeSeconds = Math.max(0, Number(seconds ?? 0));
  const days = Math.floor(safeSeconds / 86_400);

  return { days: String(days), hours: "0" };
}

export function beneficiariesFromPlan(plan?: InheritancePlanStatus | null): BeneficiaryDraft[] {
  if (!plan?.active || plan.beneficiaries.length === 0) {
    return initialBeneficiaries;
  }

  return plan.beneficiaries.map((beneficiary, index) => ({
    id: index + 1,
    address: beneficiary.address,
    sharePercent: roundShare(beneficiary.shareBps / 100),
    locked: false
  }));
}

export function tokensFromPlan(plan?: InheritancePlanStatus | null): TokenDraft[] {
  return (plan?.protectedAssets ?? [])
    .filter((asset) => asset.kind === "erc20")
    .map((asset, index) => ({
      address: asset.token,
      symbol: `TOKEN${index + 1}`,
      decimals: "18"
    }));
}

export function formatProtectedAssets(plan?: InheritancePlanStatus | null) {
  const assets = plan?.protectedAssets ?? [];

  if (assets.length === 0) {
    return "Native STT";
  }

  return assets
    .map((asset) => asset.kind === "native" ? "Native STT" : formatAddressPreview(asset.token))
    .join(", ");
}

export function normalizeBeneficiaryShares(beneficiaries: BeneficiaryDraft[]) {
  const lockedTotal = beneficiaries
    .filter((beneficiary) => beneficiary.locked)
    .reduce((total, beneficiary) => total + beneficiary.sharePercent, 0);
  const availableShare = Math.max(0, roundShare(100 - lockedTotal));
  const unlocked = beneficiaries.filter((beneficiary) => !beneficiary.locked);

  if (unlocked.length === 0) {
    return beneficiaries;
  }

  const currentUnlockedTotal = unlocked.reduce((total, beneficiary) => total + beneficiary.sharePercent, 0);
  let remainingShare = availableShare;
  const distributed = new Map<number, number>();

  unlocked.forEach((beneficiary, index) => {
    const isLast = index === unlocked.length - 1;
    const nextShare = isLast
      ? remainingShare
      : roundShare(currentUnlockedTotal > 0
        ? (beneficiary.sharePercent / currentUnlockedTotal) * availableShare
        : availableShare / unlocked.length);

    const boundedShare = Math.min(remainingShare, Math.max(0, nextShare));
    distributed.set(beneficiary.id, roundShare(boundedShare));
    remainingShare = roundShare(remainingShare - boundedShare);
  });

  return beneficiaries.map((beneficiary) => beneficiary.locked
    ? beneficiary
    : { ...beneficiary, sharePercent: distributed.get(beneficiary.id) ?? 0 });
}

export function rebalanceBeneficiaryShare(
  beneficiaries: BeneficiaryDraft[],
  changedId: number,
  requestedShare: number
) {
  const changedBeneficiary = beneficiaries.find((beneficiary) => beneficiary.id === changedId);

  if (!changedBeneficiary || changedBeneficiary.locked) {
    return beneficiaries;
  }

  const lockedTotal = beneficiaries
    .filter((beneficiary) => beneficiary.locked)
    .reduce((total, beneficiary) => total + beneficiary.sharePercent, 0);
  const availableShare = Math.max(0, roundShare(100 - lockedTotal));
  const changedShare = Math.min(availableShare, Math.max(0, roundShare(requestedShare)));
  const adjustable = beneficiaries.filter((beneficiary) => !beneficiary.locked && beneficiary.id !== changedId);

  if (adjustable.length === 0) {
    return beneficiaries.map((beneficiary) => beneficiary.id === changedId
      ? { ...beneficiary, sharePercent: availableShare }
      : beneficiary);
  }

  const remainingForAdjustable = roundShare(availableShare - changedShare);
  const currentAdjustableTotal = adjustable.reduce((total, beneficiary) => total + beneficiary.sharePercent, 0);
  let remainingShare = remainingForAdjustable;
  const distributed = new Map<number, number>();

  adjustable.forEach((beneficiary, index) => {
    const isLast = index === adjustable.length - 1;
    const nextShare = isLast
      ? remainingShare
      : roundShare(currentAdjustableTotal > 0
        ? (beneficiary.sharePercent / currentAdjustableTotal) * remainingForAdjustable
        : remainingForAdjustable / adjustable.length);
    const boundedShare = Math.min(remainingShare, Math.max(0, nextShare));

    distributed.set(beneficiary.id, roundShare(boundedShare));
    remainingShare = roundShare(remainingShare - boundedShare);
  });

  return beneficiaries.map((beneficiary) => {
    if (beneficiary.id === changedId) {
      return { ...beneficiary, sharePercent: changedShare };
    }

    if (!beneficiary.locked) {
      return { ...beneficiary, sharePercent: distributed.get(beneficiary.id) ?? 0 };
    }

    return beneficiary;
  });
}

export function getBeneficiaryAddressError(
  address: string,
  index: number,
  smartAccountAddress?: string | undefined,
  beneficiaries: BeneficiaryDraft[] = [],
  currentId?: number
) {
  const label = `Recipient ${index + 1}`;
  const trimmedAddress = address.trim();
  const creatorAddress = smartAccountAddress?.trim() ?? "";

  if (!trimmedAddress) {
    return `${label} address is required.`;
  }

  if (!walletAddressPattern.test(trimmedAddress)) {
    return `${label} needs a valid 0x wallet address.`;
  }

  if (walletAddressPattern.test(creatorAddress) && trimmedAddress.toLowerCase() === creatorAddress.toLowerCase()) {
    return `${label} cannot be the smart account.`;
  }

  const duplicateRecipientLabels = getDuplicateRecipientLabels(trimmedAddress, beneficiaries, currentId);

  if (duplicateRecipientLabels.length > 0) {
    return `${label} address duplicates ${duplicateRecipientLabels.join(", ")}.`;
  }

  return "";
}

function getDuplicateRecipientLabels(address: string, beneficiaries: BeneficiaryDraft[], currentId?: number) {
  const normalizedAddress = address.toLowerCase();

  return beneficiaries
    .map((beneficiary, duplicateIndex) => ({
      id: beneficiary.id,
      isDuplicate: beneficiary.id !== currentId
        && walletAddressPattern.test(beneficiary.address.trim())
        && beneficiary.address.trim().toLowerCase() === normalizedAddress,
      label: `Recipient ${duplicateIndex + 1}`
    }))
    .filter((beneficiary) => beneficiary.isDuplicate)
    .map((beneficiary) => beneficiary.label);
}

export function getBeneficiaryShareError(sharePercent: number, index: number) {
  if (Number(sharePercent || 0) <= 0) {
    return `Recipient ${index + 1} share must be greater than 0%.`;
  }

  return "";
}

export function getTokenAddressError(address: string, tokens: TokenDraft[]) {
  const trimmedAddress = address.trim();

  if (!trimmedAddress) {
    return "Token contract address is required.";
  }

  if (!walletAddressPattern.test(trimmedAddress)) {
    return "Token contract address must be a valid 0x address.";
  }

  if (trimmedAddress.toLowerCase() === nativeAssetAddress.toLowerCase()) {
    return "Native STT is already available as a checkbox.";
  }

  if (tokens.some((token) => token.address.toLowerCase() === trimmedAddress.toLowerCase())) {
    return "Token is already imported.";
  }

  return "";
}

export function getTokenSymbolError(symbol: string) {
  const trimmedSymbol = symbol.trim();

  if (!trimmedSymbol) {
    return "Token symbol is required.";
  }

  if (trimmedSymbol.length > 11) {
    return "Symbol must be 11 characters or fewer.";
  }

  return "";
}

export function getTokenDecimalsError(decimals: string) {
  if (!decimals.trim()) {
    return "Token decimal required.";
  }

  const decimalValue = Number(decimals);
  if (!Number.isInteger(decimalValue) || decimalValue < 0 || decimalValue > 255) {
    return "Token decimal must be between 0 and 255.";
  }

  return "";
}
