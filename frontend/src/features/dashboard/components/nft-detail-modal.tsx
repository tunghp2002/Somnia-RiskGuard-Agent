import { Copy, ExternalLink, ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Modal, ModalActions } from "@/components/ui/modal";

import { copyText } from "./account-assets-utils";
import { AssetImage } from "./common";

import type { NftAssetBalance } from "@/lib/blockscout-api";

export function NftDetailModal({
  blockExplorerUrl,
  nft,
  onClose,
}: {
  blockExplorerUrl: string | undefined;
  nft: NftAssetBalance;
  onClose: () => void;
}) {
  return (
    <Modal className="asset-detail-modal" overlayClassName="asset-modal-overlay">
      <div className="asset-detail-hero">
        {nft.imageUrl ? <AssetImage src={nft.imageUrl} /> : <ImageIcon size={34} />}
        <div>
          <h3>{nft.name}</h3>
          <p>{nft.collectionName}</p>
        </div>
      </div>
      <div className="asset-detail-list">
        <DetailRow label="Token ID" value={nft.id} />
        <DetailRow label="Collection" value={nft.collectionAddress} />
        <DetailRow label="Owner" value={nft.address} />
        <DetailRow label="Account" value={nft.accountLabel} />
      </div>
      <ModalActions>
        {blockExplorerUrl && nft.collectionAddress ? (
          <Button
            onClick={() =>
              window.open(
                `${blockExplorerUrl.replace(/\/$/, "")}/token/${nft.collectionAddress}/instance/${nft.id}`,
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
        <Button onClick={onClose} type="button" variant="primary">
          Close
        </Button>
      </ModalActions>
    </Modal>
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
