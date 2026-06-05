import { Coins, ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  somniaLogoUrl,
  type AccountAssetSnapshot,
  type NftAssetBalance,
} from "@/lib/blockscout-api";

import { compactAmount } from "./account-assets-utils";
import { AssetImage } from "./common";

export function TokenAssetList({
  assets,
  loading,
}: {
  assets: AccountAssetSnapshot | null;
  loading: boolean;
}) {
  return (
    <>
      <div className="asset-table-head">
        <span>Asset</span>
        <span>Balance</span>
        <span>Account</span>
      </div>
      {(assets?.native ?? []).map((native) => (
        <article className="asset-token-row native-row" key={`${native.address}-native`}>
          <span className="asset-avatar"><AssetImage src={somniaLogoUrl} /></span>
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
            {token.iconUrl ? <AssetImage src={token.iconUrl} /> : <Coins size={22} />}
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
  );
}

export function NftAssetList({
  assets,
  loading,
  onSelectNft,
}: {
  assets: AccountAssetSnapshot | null;
  loading: boolean;
  onSelectNft: (nft: NftAssetBalance) => void;
}) {
  return (
    <>
      <div className="asset-table-head nft-head">
        <span>NFT</span>
        <span>Action</span>
      </div>
      {(assets?.nfts ?? []).map((nft) => (
        <article className="asset-nft-row" key={`${nft.address}-${nft.collectionAddress}-${nft.id}`}>
          <span className="asset-avatar nft-avatar">
            {nft.imageUrl ? <AssetImage src={nft.imageUrl} /> : <ImageIcon size={24} />}
          </span>
          <div>
            <strong title={nft.name}>{nft.name}</strong>
          </div>
          <Button className="asset-detail-button" onClick={() => onSelectNft(nft)} type="button" variant="secondary">
            Detail
          </Button>
        </article>
      ))}
      {!loading && (assets?.nfts.length ?? 0) === 0 ? (
        <p className="muted">No NFTs found for this account scope.</p>
      ) : null}
    </>
  );
}
