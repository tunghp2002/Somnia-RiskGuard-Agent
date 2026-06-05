import { useEffect, useMemo, useState } from "react";

import {
  fetchAccountAssets,
  type AccountAssetSnapshot,
  type AccountOption,
  type BlockscoutAccountScope,
} from "@/lib/blockscout-api";

import { scopeAccounts } from "./account-assets-utils";

import type { PublicChainMetadata } from "@/lib/agent-api";

const assetCacheTtlMs = 30_000;
const assetSnapshotCache = new Map<string, { snapshot: AccountAssetSnapshot; fetchedAt: number }>();

export function useAccountAssets({
  accountOptions,
  publicChain,
  refreshNonce,
  selectedScope,
}: {
  accountOptions: AccountOption[];
  publicChain: PublicChainMetadata | null;
  refreshNonce: number;
  selectedScope: BlockscoutAccountScope;
}) {
  const [assets, setAssets] = useState<AccountAssetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedAccounts = useMemo(
    () => scopeAccounts(accountOptions, selectedScope),
    [accountOptions, selectedScope],
  );
  const selectedAccountsKey = useMemo(
    () => selectedAccounts
      .map((account) => `${account.label}:${account.address?.toLowerCase() ?? ""}`)
      .join("|"),
    [selectedAccounts],
  );

  useEffect(() => {
    if (!publicChain || selectedAccounts.length === 0) {
      // Clear asynchronously so the reset doesn't run synchronously inside the
      // effect commit (avoids the cascading-render lint).
      const resetId = window.setTimeout(() => setAssets(null), 0);
      return () => window.clearTimeout(resetId);
    }

    const cacheKey = `${publicChain.chainId}:${selectedAccountsKey}`;
    const cached = assetSnapshotCache.get(cacheKey);
    const cacheFresh = cached ? Date.now() - cached.fetchedAt < assetCacheTtlMs : false;

    let stopped = false;

    // Seed from cache and start the refresh on a macrotask so none of the
    // setState calls run synchronously inside the effect commit.
    const startId = window.setTimeout(() => {
      if (cached) {
        setAssets(cached.snapshot);
        setError(null);
      }

      if (cacheFresh && refreshNonce === 0) {
        return;
      }

      setLoading(true);
      if (!cached) {
        setError(null);
      }

      void fetchAccountAssets({
        accounts: selectedAccounts.map((account) => ({
          label: account.label,
          address: account.address ?? "",
        })),
        blockExplorerUrl: publicChain.blockExplorerUrl,
        nativeDecimals: publicChain.nativeCurrency.decimals,
        nativeSymbol: publicChain.nativeCurrency.symbol,
      })
        .then((snapshot) => {
          if (!stopped) {
            assetSnapshotCache.set(cacheKey, { snapshot, fetchedAt: Date.now() });
            setAssets(snapshot);
            setError(null);
          }
        })
        .catch((fetchError) => {
          if (!stopped) {
            if (!cached) {
              setAssets(null);
            }
            setError(fetchError instanceof Error ? fetchError.message : "Blockscout refresh failed");
          }
        })
        .finally(() => {
          if (!stopped) {
            setLoading(false);
          }
        });
    }, 0);

    return () => {
      stopped = true;
      window.clearTimeout(startId);
    };
  }, [publicChain, refreshNonce, selectedAccounts, selectedAccountsKey]);

  return { assets, error, loading };
}
