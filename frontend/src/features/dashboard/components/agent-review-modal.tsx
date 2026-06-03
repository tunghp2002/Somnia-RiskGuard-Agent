import { ExternalLink, Send, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { formatAddress } from "../utils";

import type { AgentReviewRequestModal } from "../types";

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
    <div className="profile-modal-overlay" role="presentation">
      <div aria-modal="true" className="profile-modal agent-review-modal" role="dialog">
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
        <div className="profile-modal-actions">
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
        </div>
      </div>
    </div>
  );
}
