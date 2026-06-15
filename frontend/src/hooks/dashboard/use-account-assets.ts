import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchAccountAssets,
  type AccountAssetSnapshot,
  type AccountOption,
  type BlockscoutAccountScope,
} from "@/lib/blockscout-api";
import {
  readCachedAccountAssets,
  writeCachedAccountAssets,
} from "@/lib/account-assets-cache";
import { subscribeSomniaBalanceStream } from "@/lib/somnia";

import { scopeAccounts } from "@/utils/dashboard";

import type { PublicChainMetadata } from "@/lib/agent-api";

const blockscoutSyncIntervalMs = 5 * 60_000;

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
  const assetsRef = useRef<AccountAssetSnapshot | null>(null);
  const blockscoutFetchedAtRef = useRef(0);

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
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    if (!publicChain || selectedAccounts.length === 0) {
      // Clear asynchronously so the reset doesn't run synchronously inside the
      // effect commit (avoids the cascading-render lint).
      const resetId = window.setTimeout(() => {
        setAssets(null);
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(resetId);
    }

    const cacheKey = `${publicChain.chainId}:${selectedAccountsKey}`;

    let stopped = false;

    // Seed from IndexedDB and start the refresh on a macrotask so none of the
    // setState calls run synchronously inside the effect commit.
    const startId = window.setTimeout(() => {
      void readCachedAccountAssets(cacheKey).then((cached) => {
        if (stopped) {
          return;
        }

        if (cached) {
          blockscoutFetchedAtRef.current = cached.fetchedAt;
          setAssets(cached.snapshot);
          setError(null);
        }

        const cacheFresh = cached
          ? Date.now() - cached.fetchedAt < blockscoutSyncIntervalMs
          : false;

        if (cacheFresh && refreshNonce === 0) {
          setLoading(false);
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
          blockscoutUrl: publicChain.blockscoutUrl ?? publicChain.blockExplorerUrl,
          nativeDecimals: publicChain.nativeCurrency.decimals,
          nativeRpcUrl: publicChain.rpcUrl,
          nativeSymbol: publicChain.nativeCurrency.symbol,
        })
          .then((snapshot) => {
            if (!stopped) {
              const fetchedAt = Date.now();
              blockscoutFetchedAtRef.current = fetchedAt;
              void writeCachedAccountAssets(cacheKey, {
                fetchedAt,
                snapshot,
                updatedAt: fetchedAt,
              });
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
      });
    }, 0);

    return () => {
      stopped = true;
      window.clearTimeout(startId);
    };
  }, [publicChain, refreshNonce, selectedAccounts, selectedAccountsKey]);

  useEffect(() => {
    if (!publicChain || selectedAccounts.length === 0) {
      return;
    }

    const streamAccounts = selectedAccounts
      .filter((account) => account.address)
      .map((account) => ({ label: account.label, address: account.address ?? "" }));

    if (streamAccounts.length === 0) {
      return;
    }

    const cacheKey = `${publicChain.chainId}:${selectedAccountsKey}`;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;

    void subscribeSomniaBalanceStream({
      accounts: streamAccounts,
      getSnapshot: () => assetsRef.current,
      onSnapshot: (snapshot) => {
        if (stopped) {
          return;
        }

        const fetchedAt = blockscoutFetchedAtRef.current || Date.now();

        setAssets(snapshot);
        void writeCachedAccountAssets(cacheKey, {
          fetchedAt,
          snapshot,
          updatedAt: Date.now(),
        });
      },
      publicChain,
    })
      .then((nextUnsubscribe) => {
        if (stopped) {
          nextUnsubscribe();
        } else {
          unsubscribe = nextUnsubscribe;
        }
      })
      .catch(() => undefined);

    return () => {
      stopped = true;

      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [publicChain, selectedAccounts, selectedAccountsKey]);

  useEffect(() => {
    if (!publicChain || selectedAccounts.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void readCachedAccountAssets(`${publicChain.chainId}:${selectedAccountsKey}`).then((cached) => {
        if (cached && Date.now() - cached.fetchedAt >= blockscoutSyncIntervalMs) {
          setLoading(true);
          void fetchAccountAssets({
            accounts: selectedAccounts.map((account) => ({
              label: account.label,
              address: account.address ?? "",
            })),
            blockscoutUrl: publicChain.blockscoutUrl ?? publicChain.blockExplorerUrl,
            nativeDecimals: publicChain.nativeCurrency.decimals,
            nativeRpcUrl: publicChain.rpcUrl,
            nativeSymbol: publicChain.nativeCurrency.symbol,
          })
            .then((snapshot) => {
              const fetchedAt = Date.now();
              blockscoutFetchedAtRef.current = fetchedAt;
              void writeCachedAccountAssets(`${publicChain.chainId}:${selectedAccountsKey}`, {
                fetchedAt,
                snapshot,
                updatedAt: fetchedAt,
              });
              setAssets(snapshot);
              setError(null);
            })
            .catch(() => undefined)
            .finally(() => setLoading(false));
        }
      });
    }, blockscoutSyncIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [publicChain, selectedAccounts, selectedAccountsKey]);

  return { assets, error, loading };
}
