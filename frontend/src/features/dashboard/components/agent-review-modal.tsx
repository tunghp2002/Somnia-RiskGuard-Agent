import { ExternalLink, Send, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Modal, ModalActions } from "@/components/ui/modal";

import { formatAddress } from "@/utils/dashboard";

import type { AgentReviewRequestModal } from "@/types/dashboard";

export function AgentReviewRequestModal({
  review,
  onClose
}: {
  review: AgentReviewRequestModal | null;
  onClose: () => void;
}) {
  if (!review) {
    return null;
  }

  return (
    <Modal className="agent-review-modal">
      <button
        aria-label="Close"
        className="agent-review-close"
        onClick={onClose}
        type="button"
      >
        <X size={16} />
      </button>
      <div className="agent-review-icon">
        <ShieldCheck size={28} />
      </div>
      <h3>Somnia Agent is reviewing</h3>
      <p>
        RiskGuard requested an on-chain Somnia Agent review. Open Telegram to approve
        or decline after the agent posts its analysis.
      </p>
      <div className="agent-review-detail">
        <small>Request transaction</small>
        {review.requestTxUrl ? (
          <a href={review.requestTxUrl} rel="noreferrer" target="_blank">
            {formatAddress(review.requestTxHash)}
            <ExternalLink size={14} />
          </a>
        ) : (
          <strong>{formatAddress(review.requestTxHash)}</strong>
        )}
      </div>
      <ModalActions>
        <Button onClick={onClose} type="button" variant="secondary">
          Close
        </Button>
        {review.telegramUrl ? (
          <Button
            className="confirm-button"
            onClick={() => window.open(review.telegramUrl, "_blank", "noopener,noreferrer")}
            type="button"
            variant="primary"
          >
            <Send size={16} />
            Open Telegram
          </Button>
        ) : null}
      </ModalActions>
    </Modal>
  );
}
