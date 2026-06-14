const smartAccountCacheKey = "riskguard.smartAccounts.v2";

export function readCachedSmartAccount(ownerAddress?: string) {
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

export function cacheSmartAccount(ownerAddress: string | undefined, smartAccountAddress: string) {
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
