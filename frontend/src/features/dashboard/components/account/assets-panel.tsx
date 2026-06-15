import { Coins, ImageIcon, Loader2, RefreshCw, WalletCards } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  type AccountOption,
  type BlockscoutAccountScope,
  type NftAssetBalance,
} from "@/lib/blockscout-api";

import { useAccountAssets } from "@/hooks/dashboard";
import { formatAddress } from "@/utils/dashboard";
import { NftDetailModal } from "../nft-detail-modal";
import { NftAssetList, TokenAssetList } from "./asset-lists";
import { PanelHeading } from "../common";

import type { AssetTab } from "@/utils/dashboard";
import type { PublicChainMetadata } from "@/lib/agent-api";

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
  const [selectedNft, setSelectedNft] = useState<NftAssetBalance | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { assets, error, loading } = useAccountAssets({
    accountOptions,
    publicChain,
    refreshNonce,
    selectedScope,
  });

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
          <TokenAssetList assets={assets} loading={loading} />
        ) : (
          <NftAssetList assets={assets} loading={loading} onSelectNft={setSelectedNft} />
        )}
      </div>

      {selectedNft ? (
        <NftDetailModal
          blockExplorerUrl={publicChain?.blockExplorerUrl}
          nft={selectedNft}
          onClose={() => setSelectedNft(null)}
        />
      ) : null}
    </section>
  );
}
