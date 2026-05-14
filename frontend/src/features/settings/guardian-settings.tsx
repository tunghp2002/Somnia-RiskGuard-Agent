import type { FormEvent } from "react";
import { Loader2, Shield } from "lucide-react";

export function GuardianSettings({
  actionLoading,
  onRegisterWallet,
  onTelegramSubmit,
  onHeartbeatSubmit,
  onRewardsSubmit
}: {
  actionLoading: string | null;
  onRegisterWallet: () => void;
  onTelegramSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onHeartbeatSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRewardsSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="form-stack">
      <button className="secondary-button" onClick={onRegisterWallet} type="button">
        {actionLoading === "register" ? <Loader2 className="spin" size={15} /> : <Shield size={15} />}
        Register monitored wallet
      </button>

      <form onSubmit={onTelegramSubmit}>
        <label htmlFor="chatId">Telegram Chat ID</label>
        <div className="inline-form">
          <input id="chatId" name="chatId" placeholder="987654321" />
          <button type="submit">{actionLoading === "telegram" ? "Saving" : "Link"}</button>
        </div>
      </form>

      <form onSubmit={onHeartbeatSubmit}>
        <label htmlFor="beneficiaryAddress">Beneficiary wallet</label>
        <input id="beneficiaryAddress" name="beneficiaryAddress" placeholder="0x..." />
        <div className="three-col">
          <input aria-label="Heartbeat interval seconds" name="intervalSeconds" type="number" min="1" defaultValue="86400" />
          <input aria-label="Grace seconds" name="graceSeconds" type="number" min="1" defaultValue="3600" />
          <input aria-label="Timelock seconds" name="timelockSeconds" type="number" min="1" defaultValue="86400" />
        </div>
        <button type="submit">{actionLoading === "heartbeat" ? "Saving" : "Save Heartbeat"}</button>
      </form>

      <form onSubmit={onRewardsSubmit}>
        <label className="check-row">
          <input name="autoClaimEnabled" type="checkbox" defaultChecked />
          Auto-claim inside policy bounds
        </label>
        <div className="two-col">
          <input aria-label="Minimum reward value USD" name="minRewardValueUsd" type="number" min="0" step="0.01" defaultValue="1" />
          <input aria-label="Maximum gas USD" name="maxClaimGasUsd" type="number" min="0" step="0.01" defaultValue="2" />
        </div>
        <button type="submit">{actionLoading === "rewards" ? "Saving" : "Save Reward Policy"}</button>
      </form>
    </div>
  );
}
