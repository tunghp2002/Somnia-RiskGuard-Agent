import { Coins, Copy, ExternalLink, ImageIcon, Loader2, RefreshCw, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  fetchAccountAssets,
  somniaLogoUrl,
  type AccountAssetSnapshot,
  type AccountOption,
  type BlockscoutAccountScope,
  type NftAssetBalance,
} from "@/lib/blockscout-api";

import { formatAddress } from "../utils";
import { PanelHeading } from "./status-panels";

import type { PublicChainMetadata } from "@/lib/agent-api";

type AssetTab = "tokens" | "nfts";
const assetCacheTtlMs = 30_000;
const assetSnapshotCache = new Map<string, { snapshot: AccountAssetSnapshot; fetchedAt: number }>();

function uniqueAccounts(accounts: AccountOption[]) {
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

function scopeAccounts(accounts: AccountOption[], scope: BlockscoutAccountScope) {
  if (scope === "all") {
    return uniqueAccounts(accounts.filter((account) => account.address));
  }

  return accounts.filter((account) => account.id === scope && account.address);
}

function compactAmount(value: string) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: numeric >= 1 ? 4 : 6,
  }).format(numeric);
}

function copyText(value: string) {
  if (typeof navigator !== "undefined") {
    void navigator.clipboard?.writeText(value);
  }
}

export function AccountAssetsPanel({
  accountOptions,
  publicChain,
  selectedScope,
  onSelectedScopeChange,
}: {
  accountOptions: AccountOption[];
  publicChain: PublicChainMetadata | null;
  selectedScope: BlockscoutAccountScope;
  onSelectedScopeChange: (scope: BlockscoutAccountScope) => void;
}) {
  const [activeTab, setActiveTab] = useState<AssetTab>("tokens");
  const [assets, setAssets] = useState<AccountAssetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedNft, setSelectedNft] = useState<NftAssetBalance | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

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
      setAssets(null);
      return;
    }

    const cacheKey = `${publicChain.chainId}:${selectedAccountsKey}`;
    const cached = assetSnapshotCache.get(cacheKey);
    const cacheFresh = cached ? Date.now() - cached.fetchedAt < assetCacheTtlMs : false;

    if (cached) {
      setAssets(cached.snapshot);
      setError(null);
    }

    if (cacheFresh && refreshNonce === 0) {
      return;
    }

    let stopped = false;
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

    return () => {
      stopped = true;
    };
  }, [publicChain, refreshNonce, selectedAccounts, selectedAccountsKey]);

  const nativeTotal = (assets?.native ?? []).reduce((total, item) => total + Number(item.balance || 0), 0);

  return (
    <section className="panel assets-overview-panel">
      <PanelHeading
        icon={<WalletCards size={17} />}
        title="Accounts & Assets"
        action={loading ? "Blockscout" : selectedScope}
      />

      <div className="asset-toolbar">
        <div className="asset-content-tabs">
          <button className={activeTab === "tokens" ? "active" : ""} onClick={() => setActiveTab("tokens")} type="button">
            <Coins size={15} />
            Tokens
          </button>
          <button className={activeTab === "nfts" ? "active" : ""} onClick={() => setActiveTab("nfts")} type="button">
            <ImageIcon size={15} />
            NFT
          </button>
        </div>
        <label className="asset-account-selector">
          Account
          <select
            onChange={(event) => onSelectedScopeChange(event.target.value as BlockscoutAccountScope)}
            value={selectedScope}
          >
            {accountOptions.map((option) => (
              <option disabled={option.id !== "all" && !option.address} key={option.id} value={option.id}>
                {option.address ? `${option.label} ${formatAddress(option.address)}` : option.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          aria-label="Refresh assets"
          disabled={loading}
          onClick={() => setRefreshNonce((current) => current + 1)}
          title="Refresh assets"
          type="button"
          variant="secondary"
        >
          {loading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
        </Button>
      </div>

      {error ? <p className="asset-error">{error}</p> : null}

      <div className="asset-scroll-list">
        {activeTab === "tokens" ? (
          <>
            <div className="asset-table-head">
              <span>Asset</span>
              <span>Balance</span>
              <span>Account</span>
            </div>
            {(assets?.native ?? []).map((native) => (
              <article className="asset-token-row native-row" key={`${native.address}-native`}>
                <span className="asset-avatar"><img alt="" src={somniaLogoUrl} /></span>
                <div>
                  <strong>{native.symbol}</strong>
                  <small>Somnia native token</small>
                </div>
                <span>{compactAmount(native.balance)}</span>
                <small>{native.accountLabel}</small>
              </article>
            ))}
            {(assets?.tokens ?? []).map((token) => (
              <article className="asset-token-row" key={`${token.address}-${token.tokenAddress}-${token.accountLabel}`}>
                <span className="asset-avatar">
                  {token.iconUrl ? <img alt="" src={token.iconUrl} /> : <Coins size={22} />}
                </span>
                <div>
                  <strong title={token.name}>{token.symbol}</strong>
                  <small title={token.tokenAddress}>{token.name}</small>
                </div>
                <span>{compactAmount(token.balance)}</span>
                <small>{token.accountLabel}</small>
              </article>
            ))}
            {!loading && (assets?.tokens.length ?? 0) === 0 && (assets?.native.length ?? 0) === 0 ? (
              <p className="muted">No ERC-20 tokens found for this account scope.</p>
            ) : null}
          </>
        ) : (
          <>
            <div className="asset-table-head nft-head">
              <span>NFT</span>
              <span>Action</span>
            </div>
            {(assets?.nfts ?? []).map((nft) => (
              <article className="asset-nft-row" key={`${nft.address}-${nft.collectionAddress}-${nft.id}`}>
                <span className="asset-avatar nft-avatar">
                  {nft.imageUrl ? <img alt="" src={nft.imageUrl} /> : <ImageIcon size={24} />}
                </span>
                <div>
                  <strong title={nft.name}>{nft.name}</strong>
                </div>
                <Button className="asset-detail-button" onClick={() => setSelectedNft(nft)} type="button" variant="secondary">
                  Detail
                </Button>
              </article>
            ))}
            {!loading && (assets?.nfts.length ?? 0) === 0 ? (
              <p className="muted">No NFTs found for this account scope.</p>
            ) : null}
          </>
        )}
      </div>

      {selectedNft ? (
        <div className="profile-modal-overlay asset-modal-overlay" role="presentation">
          <div aria-modal="true" className="profile-modal asset-detail-modal" role="dialog">
            <div className="asset-detail-hero">
              {selectedNft.imageUrl ? <img alt="" src={selectedNft.imageUrl} /> : <ImageIcon size={34} />}
              <div>
                <h3>{selectedNft.name}</h3>
                <p>{selectedNft.collectionName}</p>
              </div>
            </div>
            <div className="asset-detail-list">
              <DetailRow label="Token ID" value={selectedNft.id} />
              <DetailRow label="Collection" value={selectedNft.collectionAddress} />
              <DetailRow label="Owner" value={selectedNft.address} />
              <DetailRow label="Account" value={selectedNft.accountLabel} />
            </div>
            <div className="profile-modal-actions">
              {publicChain?.blockExplorerUrl && selectedNft.collectionAddress ? (
                <Button
                  onClick={() =>
                    window.open(
                      `${publicChain.blockExplorerUrl.replace(/\/$/, "")}/token/${selectedNft.collectionAddress}/instance/${selectedNft.id}`,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                  type="button"
                  variant="secondary"
                >
                  <ExternalLink size={15} />
                  Explorer
                </Button>
              ) : null}
              <Button onClick={() => setSelectedNft(null)} type="button" variant="primary">
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="asset-detail-row">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
      <Button aria-label={`Copy ${label}`} onClick={() => copyText(value)} title={`Copy ${label}`} type="button" variant="ghost">
        <Copy size={15} />
      </Button>
    </div>
  );
}
