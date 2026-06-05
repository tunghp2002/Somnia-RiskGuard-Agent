import type { AccountOption, BlockscoutAccountScope } from "@/lib/blockscout-api";

export type AssetTab = "tokens" | "nfts";

export function uniqueAccounts(accounts: AccountOption[]) {
  const seen = new Set<string>();

  return accounts.filter((account) => {
    const key = account.address?.toLowerCase() ?? account.id;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function scopeAccounts(accounts: AccountOption[], scope: BlockscoutAccountScope) {
  if (scope === "all") {
    return uniqueAccounts(accounts.filter((account) => account.address));
  }

  return accounts.filter((account) => account.id === scope && account.address);
}

export function compactAmount(value: string) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: numeric >= 1 ? 4 : 6,
  }).format(numeric);
}

export function copyText(value: string) {
  if (typeof navigator !== "undefined") {
    void navigator.clipboard?.writeText(value);
  }
}
