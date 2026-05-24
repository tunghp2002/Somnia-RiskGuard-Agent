import type { FormEvent } from "react";
import { Activity, Bot, Clock3, Cpu, Link2, Loader2, RadioTower, Send, Shield, UserRound, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  PortfolioSnapshot,
  PublicChainMetadata,
  Readiness,
  TelegramConnectSession,
  UserRecord
} from "@/lib/agent-api";
import type { BrowserWalletState } from "@/lib/wallet";
import { classForStatus, formatAddress, formatDate, formatUsd, hasOkFlag, readableMetadata } from "../utils";
import { HealthRow, PanelHeading } from "./status-panels";

function formatTelegramIdentity(session: TelegramConnectSession | null) {
  const binding = session?.binding;

  if (!binding) {
    return "";
  }

  return binding.telegramUsername
    ? `@${binding.telegramUsername}`
    : binding.telegramDisplayName ?? binding.telegramUserId ?? binding.chatId;
}

export function ProfilePanel({
  actionLoading,
  onConnectTelegram,
  onConnectWallet,
  onDisconnectWallet,
  onProfileSubmit,
  telegramSession,
  userProfile,
  wallet
}: {
  actionLoading: string | null;
  onConnectTelegram: () => void;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  onProfileSubmit: (event: FormEvent<HTMLFormElement>) => void;
  telegramSession: TelegramConnectSession | null;
  userProfile: UserRecord | null;
  wallet: BrowserWalletState | null;
}) {
  if (!wallet) {
    return (
      <section className="profile-screen">
        <section className="profile-card">
          <div>
            <h2>Profile</h2>
            <p className="muted">You need to connect a wallet before editing your profile.</p>
          </div>
          <Button className="primary-button" onClick={onConnectWallet} type="button" variant="primary">
            <Wallet size={16} />
            Connect wallet
          </Button>
        </section>
      </section>
    );
  }

  const telegramConnecting = telegramSession?.status === "waiting";

  return (
    <section className="profile-screen">
      <section className="profile-card">
        <div>
          <h2>Profile</h2>
          <p className="muted">Manage the identity and wallet this dashboard uses for RiskGuard actions.</p>
        </div>
        <form className="profile-form" key={userProfile?.updatedAt ?? wallet.address} onSubmit={onProfileSubmit}>
          <label>
            Display name
            <Input
              name="displayName"
              placeholder="Your display name"
              defaultValue={userProfile?.displayName ?? ""}
              maxLength={64}
              required
            />
          </label>
          <label>
            Connected wallet
            <Input readOnly value={formatAddress(wallet.address)} />
          </label>
          <Button className="secondary-button" disabled={actionLoading === "profile"} type="submit" variant="secondary">
            <UserRound size={16} />
            {actionLoading === "profile" ? "Saving" : "Save profile"}
          </Button>
        </form>
      </section>

      <section className="profile-card profile-action-card">
        <div>
          <h2>Connect Telegram</h2>
          <p className="muted">
            {telegramSession?.connected
              ? `Connected as ${formatTelegramIdentity(telegramSession)}.`
              : telegramConnecting
                ? "Connecting Telegram. Finish the Start step in the bot window."
                : "Connect Telegram to receive RiskGuard alerts for this wallet."}
          </p>
          {telegramSession?.connected ? (
            <div className="profile-telegram-status">
              <span>Connected</span>
              <strong>{formatTelegramIdentity(telegramSession)}</strong>
            </div>
          ) : null}
        </div>
        <Button
          className="secondary-button"
          disabled={actionLoading === "telegram" || telegramConnecting}
          onClick={onConnectTelegram}
          type="button"
          variant="secondary"
        >
          {actionLoading === "telegram" || telegramConnecting ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
          {actionLoading === "telegram"
            ? "Opening"
            : telegramConnecting ? "Connecting Telegram" : "Connect Telegram"}
        </Button>
      </section>

      <section className="profile-card profile-action-card">
        <div>
          <h2>Wallet Session</h2>
          <p className="muted">Disconnect this browser wallet from the dashboard.</p>
        </div>
        <Button className="secondary-button" disabled={actionLoading === "wallet"} onClick={onDisconnectWallet} type="button" variant="secondary">
          Disconnect
        </Button>
      </section>
    </section>
  );
}

export function PortfolioWatch({
  loading,
  portfolio
}: {
  loading: boolean;
  portfolio: PortfolioSnapshot | null;
}) {
  return (
    <section className="panel portfolio-panel">
      <PanelHeading icon={<Activity size={17} />} title="Portfolio Watch" action={loading ? "refreshing" : portfolio?.source ?? "no data"} />
      <div className="portfolio-total">{formatUsd(portfolio?.totalValueUsd)}</div>
      <div className="asset-list">
        {(portfolio?.assets ?? []).slice(0, 4).map((asset) => (
          <div className="asset-row" key={asset.symbol}>
            <span>{asset.symbol}</span>
            <span>{asset.balance}</span>
            <strong>{formatUsd(asset.valueUsd)}</strong>
          </div>
        ))}
        {!portfolio ? <p className="muted">No portfolio snapshot yet. Connect a wallet or start the agent monitor.</p> : null}
      </div>
      <div className="signal-list">
        {(portfolio?.riskSignals ?? []).map((signal) => (
          <span className={`signal ${signal.severity}`} key={`${signal.signalType}-${signal.description}`}>
            {signal.severity}: {signal.description}
          </span>
        ))}
      </div>
    </section>
  );
}

export function OperatorHealth({
  health,
  publicChain,
  readiness
}: {
  health: Record<string, unknown> | null;
  publicChain: PublicChainMetadata | null;
  readiness: Readiness | null;
}) {
  return (
    <section className="panel">
      <PanelHeading icon={<Cpu size={17} />} title="Operator Health" action="secret-safe" />
      <div className="health-list">
        <HealthRow icon={<RadioTower size={15} />} label="Agent API" value={health ? health.ok === false ? "degraded" : "reachable" : "unavailable"} tone={health ? health.ok === false ? "bad" : "ok" : "warn"} />
        <HealthRow icon={<Bot size={15} />} label="Telegram" value={readableMetadata(health?.telegram)} tone={health?.telegram ? "ok" : "warn"} />
        <HealthRow icon={<Send size={15} />} label="Somnia adapter" value={readableMetadata(health?.somnia)} tone={hasOkFlag(health?.somnia) && health.somnia.ok ? "ok" : "warn"} />
        <HealthRow icon={<Shield size={15} />} label="Signer" value={readiness?.agentWallet.ready ? formatAddress(readiness.agentWallet.walletAddress) : "missing"} tone={readiness?.agentWallet.ready ? "ok" : "bad"} />
        <HealthRow icon={<Link2 size={15} />} label="Chain" value={publicChain ? `${publicChain.name} (${publicChain.chainId})` : "unknown"} tone="neutral" />
      </div>
    </section>
  );
}

export function SafetyReceipts({
  receipts
}: {
  receipts: Array<{
    id: string;
    title: string;
    status: string;
    detail: string;
    createdAt: string;
  }>;
}) {
  return (
    <section className="panel timeline-panel">
      <PanelHeading icon={<Clock3 size={17} />} title="Safety Receipts" action={`${receipts.length} recent`} />
      <div className="timeline">
        {receipts.map((receipt) => (
          <article className="receipt" key={receipt.id}>
            <span className={`receipt-dot ${classForStatus(receipt.status)}`} />
            <div>
              <div className="receipt-title">
                <strong>{receipt.title}</strong>
                <span className={classForStatus(receipt.status)}>{receipt.status}</span>
              </div>
              <p>{receipt.detail}</p>
              <time>{formatDate(receipt.createdAt)}</time>
            </div>
          </article>
        ))}
        {receipts.length === 0 ? <p className="muted">No receipts yet. Run a demo scenario or save settings.</p> : null}
      </div>
    </section>
  );
}
