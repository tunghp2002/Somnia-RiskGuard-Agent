import type { FormEvent } from "react";
import { ExternalLink, Loader2, Send, Shield } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TelegramConnectSession } from "@/lib/agent-api";

export function GuardianSettings({
  actionLoading,
  telegramSession,
  onRegisterWallet,
  onTelegramConnect,
  onHeartbeatSubmit,
  onRewardsSubmit
}: {
  actionLoading: string | null;
  telegramSession: TelegramConnectSession | null;
  onRegisterWallet: () => void;
  onTelegramConnect: () => void;
  onHeartbeatSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRewardsSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="form-stack">
      <Button className="secondary-button" onClick={onRegisterWallet} type="button" variant="secondary">
        {actionLoading === "register" ? <Loader2 className="spin" size={15} /> : <Shield size={15} />}
        Register monitored wallet
      </Button>

      <section className="connect-panel" aria-label="Telegram connection">
        <div>
          <label>Telegram Connect</label>
          <p className="muted">Start a bot/code flow. Manual chat-id entry is reserved for internal fallback only.</p>
        </div>
        <Button onClick={onTelegramConnect} type="button" variant="secondary">
          {actionLoading === "telegram" ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
          Connect Telegram
        </Button>
        {telegramSession ? (
          <div className="connect-code">
            <span>One-time code</span>
            <strong>{telegramSession.code}</strong>
            <Badge>{telegramSession.status}</Badge>
            <small>Expires {new Date(telegramSession.expiresAt).toLocaleTimeString()}</small>
            <a href={telegramSession.botDeepLink} rel="noreferrer" target="_blank">
              Open bot link <ExternalLink size={13} />
            </a>
          </div>
        ) : null}
      </section>

      <form onSubmit={onHeartbeatSubmit}>
        <label htmlFor="beneficiaryAddress">Beneficiary wallet</label>
        <input id="beneficiaryAddress" name="beneficiaryAddress" placeholder="0x..." />
        <div className="three-col">
          <input aria-label="Heartbeat interval seconds" name="intervalSeconds" type="number" min="1" defaultValue="86400" />
          <input aria-label="Grace seconds" name="graceSeconds" type="number" min="1" defaultValue="3600" />
          <input aria-label="Timelock seconds" name="timelockSeconds" type="number" min="1" defaultValue="86400" />
        </div>
        <Button type="submit" variant="secondary">{actionLoading === "heartbeat" ? "Saving" : "Save Heartbeat"}</Button>
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
        <Button type="submit" variant="secondary">{actionLoading === "rewards" ? "Saving" : "Save Reward Policy"}</Button>
      </form>
    </div>
  );
}
