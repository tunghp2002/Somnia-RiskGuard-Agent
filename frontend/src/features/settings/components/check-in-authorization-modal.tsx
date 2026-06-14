import { Button } from "@/components/ui/button";
import { Modal, ModalActions } from "@/components/ui/modal";

export function CheckInAuthorizationModal({
  onResolve,
}: {
  onResolve: (approved: boolean) => void;
}) {
  return (
    <Modal>
      <h3>Authorize Telegram check-in</h3>
      <p>
        RiskGuard needs your signature so the agent can send heartbeat check-ins from Telegram when you use /checkin.
      </p>
      <p>
        This does not transfer funds and does not give the agent permission to send, swap, or manage your assets.
      </p>
      <ModalActions>
        <Button onClick={() => onResolve(false)} type="button" variant="secondary">
          Cancel
        </Button>
        <Button
          className="confirm-button"
          onClick={() => onResolve(true)}
          type="button"
          variant="primary"
        >
          Continue to wallet
        </Button>
      </ModalActions>
    </Modal>
  );
}
