import { useMemo, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Fingerprint,
  Info,
  Lock,
  LockKeyhole,
  Loader2,
  Plus,
  Radar,
  Send,
  Shield,
  TimerReset,
  Trash2,
  Unlock,
  UserPlus,
  Users,
  WalletCards
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TelegramConnectSession } from "@/lib/agent-api";

export function GuardianSettings({
  actionLoading,
  telegramSession,
  onRegisterWallet,
  onTelegramConnect,
  onRewardsSubmit
}: {
  actionLoading: string | null;
  telegramSession: TelegramConnectSession | null;
  onRegisterWallet: () => void;
  onTelegramConnect: () => void;
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

type BeneficiaryDraft = {
  id: number;
  address: string;
  sharePercent: number;
  locked: boolean;
};

const initialBeneficiaries: BeneficiaryDraft[] = [
  { id: 1, address: "", sharePercent: 100, locked: false }
];

type DurationDraft = {
  days: string;
  hours: string;
};

const walletAddressPattern = /^0x[a-fA-F0-9]{40}$/;

function clampNumber(value: string, min: number, max: number, allowDecimal = false) {
  const cleaned = value.replace(allowDecimal ? /[^\d.]/g : /\D/g, "");
  const normalized = allowDecimal
    ? cleaned.replace(/^(\d*\.?\d*).*$/, "$1")
    : cleaned;

  if (normalized === "") {
    return "";
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    return String(min);
  }

  return String(Math.min(max, Math.max(min, numeric)));
}

function roundShare(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getShareInputValue(value: string) {
  return Number(clampNumber(value, 0, 100, true) || 0);
}

function normalizeBeneficiaryShares(beneficiaries: BeneficiaryDraft[]) {
  const lockedTotal = beneficiaries
    .filter((beneficiary) => beneficiary.locked)
    .reduce((total, beneficiary) => total + beneficiary.sharePercent, 0);
  const availableShare = Math.max(0, roundShare(100 - lockedTotal));
  const unlocked = beneficiaries.filter((beneficiary) => !beneficiary.locked);

  if (unlocked.length === 0) {
    return beneficiaries;
  }

  const currentUnlockedTotal = unlocked.reduce((total, beneficiary) => total + beneficiary.sharePercent, 0);
  let remainingShare = availableShare;
  const distributed = new Map<number, number>();

  unlocked.forEach((beneficiary, index) => {
    const isLast = index === unlocked.length - 1;
    const nextShare = isLast
      ? remainingShare
      : roundShare(currentUnlockedTotal > 0
        ? (beneficiary.sharePercent / currentUnlockedTotal) * availableShare
        : availableShare / unlocked.length);

    const boundedShare = Math.min(remainingShare, Math.max(0, nextShare));
    distributed.set(beneficiary.id, roundShare(boundedShare));
    remainingShare = roundShare(remainingShare - boundedShare);
  });

  return beneficiaries.map((beneficiary) => beneficiary.locked
    ? beneficiary
    : { ...beneficiary, sharePercent: distributed.get(beneficiary.id) ?? 0 });
}

function rebalanceBeneficiaryShare(
  beneficiaries: BeneficiaryDraft[],
  changedId: number,
  requestedShare: number
) {
  const changedBeneficiary = beneficiaries.find((beneficiary) => beneficiary.id === changedId);

  if (!changedBeneficiary || changedBeneficiary.locked) {
    return beneficiaries;
  }

  const lockedTotal = beneficiaries
    .filter((beneficiary) => beneficiary.locked)
    .reduce((total, beneficiary) => total + beneficiary.sharePercent, 0);
  const availableShare = Math.max(0, roundShare(100 - lockedTotal));
  const changedShare = Math.min(availableShare, Math.max(0, roundShare(requestedShare)));
  const adjustable = beneficiaries.filter((beneficiary) => !beneficiary.locked && beneficiary.id !== changedId);

  if (adjustable.length === 0) {
    return beneficiaries.map((beneficiary) => beneficiary.id === changedId
      ? { ...beneficiary, sharePercent: availableShare }
      : beneficiary);
  }

  const remainingForAdjustable = roundShare(availableShare - changedShare);
  const currentAdjustableTotal = adjustable.reduce((total, beneficiary) => total + beneficiary.sharePercent, 0);
  let remainingShare = remainingForAdjustable;
  const distributed = new Map<number, number>();

  adjustable.forEach((beneficiary, index) => {
    const isLast = index === adjustable.length - 1;
    const nextShare = isLast
      ? remainingShare
      : roundShare(currentAdjustableTotal > 0
        ? (beneficiary.sharePercent / currentAdjustableTotal) * remainingForAdjustable
        : remainingForAdjustable / adjustable.length);
    const boundedShare = Math.min(remainingShare, Math.max(0, nextShare));

    distributed.set(beneficiary.id, roundShare(boundedShare));
    remainingShare = roundShare(remainingShare - boundedShare);
  });

  return beneficiaries.map((beneficiary) => {
    if (beneficiary.id === changedId) {
      return { ...beneficiary, sharePercent: changedShare };
    }

    if (!beneficiary.locked) {
      return { ...beneficiary, sharePercent: distributed.get(beneficiary.id) ?? 0 };
    }

    return beneficiary;
  });
}

export function InheritanceSettings({
  actionLoading,
  walletAddress,
  onHeartbeatSubmit
}: {
  actionLoading: string | null;
  walletAddress?: string | undefined;
  onHeartbeatSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryDraft[]>(initialBeneficiaries);
  const [intervalDuration, setIntervalDuration] = useState<DurationDraft>({ days: "30", hours: "0" });
  const [graceDuration, setGraceDuration] = useState<DurationDraft>({ days: "7", hours: "0" });
  const [timelockDuration, setTimelockDuration] = useState<DurationDraft>({ days: "2", hours: "0" });

  const shareTotal = useMemo(
    () => roundShare(beneficiaries.reduce((total, beneficiary) => total + Number(beneficiary.sharePercent || 0), 0)),
    [beneficiaries]
  );
  const lockedShareTotal = useMemo(
    () => beneficiaries
      .filter((beneficiary) => beneficiary.locked)
      .reduce((total, beneficiary) => total + Number(beneficiary.sharePercent || 0), 0),
    [beneficiaries]
  );
  const canRemove = beneficiaries.length > 1;
  const addDisabled = beneficiaries.length >= 20 || (beneficiaries.every((beneficiary) => beneficiary.locked) && lockedShareTotal >= 100);
  const allocationError = Math.abs(shareTotal - 100) > 0.001
    ? "Recipient shares must total 100%."
    : "";
  const isAllocationReady = !allocationError;
  const firstAddressError = beneficiaries
    .map((beneficiary, index) => getBeneficiaryAddressError(beneficiary.address, index))
    .find(Boolean) ?? "";
  const canSaveInheritancePlan = isAllocationReady && !firstAddressError && actionLoading !== "heartbeat";
  const submitBlockReason = firstAddressError || allocationError;

  function updateBeneficiary(id: number, patch: Partial<BeneficiaryDraft>) {
    setBeneficiaries((current) =>
      current.map((beneficiary) => beneficiary.id === id ? { ...beneficiary, ...patch } : beneficiary)
    );
  }

  function updateBeneficiaryShare(id: number, value: string) {
    setBeneficiaries((current) => rebalanceBeneficiaryShare(current, id, getShareInputValue(value)));
  }

  function addBeneficiary() {
    setBeneficiaries((current) => {
      const currentLockedTotal = current
        .filter((beneficiary) => beneficiary.locked)
        .reduce((total, beneficiary) => total + beneficiary.sharePercent, 0);

      if (current.length >= 20 || (current.every((beneficiary) => beneficiary.locked) && currentLockedTotal >= 100)) {
        return current;
      }

      const nextId = Math.max(...current.map((beneficiary) => beneficiary.id)) + 1;
      return [...current, { id: nextId, address: "", sharePercent: 0, locked: false }];
    });
  }

  function removeBeneficiary(id: number) {
    setBeneficiaries((current) => {
      if (current.length === 1) {
        return current;
      }

      return normalizeBeneficiaryShares(current.filter((beneficiary) => beneficiary.id !== id));
    });
  }

  function toggleBeneficiaryLock(id: number) {
    setBeneficiaries((current) =>
      current.map((beneficiary) => beneficiary.id === id
        ? { ...beneficiary, locked: !beneficiary.locked }
        : beneficiary)
    );
  }

  return (
    <form className="inheritance-screen" onSubmit={onHeartbeatSubmit}>
      <section className="inheritance-layout">
        <div className="inheritance-main">
          <DurationField
            duration={intervalDuration}
            help="How often you must renew the heartbeat before the switch starts moving toward inheritance."
            label="Heartbeat renewal window (Minimum 1 day)"
            namePrefix="interval"
            onChange={setIntervalDuration}
          />

          <section className="timing-stack">
            <DurationField
              duration={graceDuration}
              help="Extra time after a missed heartbeat before the contract is considered expired."
              label="Grace period"
              namePrefix="grace"
              onChange={setGraceDuration}
            />
            <DurationField
              duration={timelockDuration}
              help="Final waiting period after grace ends. Recipients can mark safe execution only after this finishes."
              label="Beneficiary timelock"
              namePrefix="timelock"
              onChange={setTimelockDuration}
            />
          </section>

          <section className="inheritance-card recipients-card">
            <div className="inheritance-section-head">
              <div>
                <Users size={19} />
                <h3>Recipient Accounts</h3>
                <InfoHint help="Wallet addresses listed here can claim after the heartbeat, grace, and timelock periods finish." />
              </div>
              <Button
                aria-label="Add recipient account"
                className="add-account-button"
                disabled={addDisabled}
                onClick={addBeneficiary}
                type="button"
                variant="secondary"
              >
                <Plus size={16} />
                Add account
              </Button>
            </div>

            <div className="beneficiary-list">
              {beneficiaries.map((beneficiary, index) => (
                <div className={beneficiary.locked ? "beneficiary-row beneficiary-row-locked" : "beneficiary-row"} key={beneficiary.id}>
                  <div className="beneficiary-index">
                    <UserPlus size={17} />
                    <span>{index + 1}</span>
                  </div>
                  <Field
                    error={getBeneficiaryAddressError(beneficiary.address, index) || undefined}
                    id={`beneficiary-address-${beneficiary.id}`}
                    label="Recipient wallet address"
                  >
                    <Input
                      aria-invalid={Boolean(getBeneficiaryAddressError(beneficiary.address, index))}
                      id={`beneficiary-address-${beneficiary.id}`}
                      name="beneficiaryAddress"
                      onChange={(event) => updateBeneficiary(beneficiary.id, { address: event.target.value })}
                      placeholder="0x..."
                      required
                      value={beneficiary.address}
                    />
                  </Field>
                  <Field
                    help="Percent of protected balances this recipient receives. Editing one unlocked recipient automatically rebalances the other unlocked recipients."
                    id={`beneficiary-share-${beneficiary.id}`}
                    label="Inheritance share"
                  >
                    <div className="input-with-unit">
                      <Input
                        aria-invalid={false}
                        disabled={beneficiary.locked}
                        id={`beneficiary-share-${beneficiary.id}`}
                        inputMode="decimal"
                        name="sharePercent"
                        onBlur={() => updateBeneficiaryShare(beneficiary.id, String(beneficiary.sharePercent))}
                        onChange={(event) => updateBeneficiaryShare(beneficiary.id, event.target.value)}
                        required
                        type="text"
                        value={beneficiary.sharePercent}
                      />
                      <span>%</span>
                    </div>
                  </Field>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={beneficiary.locked ? "Unlock recipient share" : "Lock recipient share"}
                        aria-pressed={beneficiary.locked}
                        className={beneficiary.locked ? "lock-button lock-button-active" : "lock-button"}
                        onClick={() => toggleBeneficiaryLock(beneficiary.id)}
                        type="button"
                        variant="ghost"
                      >
                        {beneficiary.locked ? <Lock size={16} /> : <Unlock size={16} />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="riskguard-tooltip" sideOffset={8}>
                      {beneficiary.locked
                        ? "Unlock this share before editing or auto-balancing it."
                        : "Lock this percentage so other recipients rebalance around it."}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    aria-label="Remove recipient account"
                    className="icon-button"
                    disabled={!canRemove}
                    onClick={() => removeBeneficiary(beneficiary.id)}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="contract-preview-panel">
          <div className="preview-glow" aria-hidden="true" />
          <section className="preview-vault">
            <div className="preview-topline">
              <span><Radar size={15} /> Contract Preview</span>
              <strong className={isAllocationReady ? "status-ok" : "status-warn"}>
                {isAllocationReady ? "Balanced" : "Needs allocation"}
              </strong>
            </div>

            <div className="vault-orbit" style={{ "--allocation": `${Math.min(shareTotal, 100)}%` } as CSSProperties}>
              <div>
                <LockKeyhole size={30} />
                <strong>{shareTotal}%</strong>
                <span>allocated</span>
              </div>
            </div>

            <div className="preview-stat-grid">
              <span><Users size={16} /><strong>{beneficiaries.length}</strong><small>Recipients</small></span>
              <span><CalendarClock size={16} /><strong>{intervalDuration.days || 1}d</strong><small>Renewal</small></span>
              <span><Activity size={16} /><strong>{graceDuration.days || 1}d</strong><small>Grace</small></span>
              <span><Fingerprint size={16} /><strong>{timelockDuration.days || 1}d</strong><small>Timelock</small></span>
            </div>

            {submitBlockReason ? (
              <p className="preview-note status-warn">{submitBlockReason}</p>
            ) : null}

            <Button className="primary-button inheritance-save" disabled={!canSaveInheritancePlan} type="submit" variant="primary">
              {actionLoading === "heartbeat" ? <Loader2 className="spin" size={16} /> : <WalletCards size={16} />}
              {actionLoading === "heartbeat" ? "Saving plan" : canSaveInheritancePlan ? "Save inheritance plan" : "Complete valid recipients"}
            </Button>
          </section>
        </aside>
      </section>
    </form>
  );
}

function Field({
  children,
  error,
  help,
  id,
  label
}: {
  children: ReactNode;
  error?: string | undefined;
  help?: string | undefined;
  id: string;
  label: string;
}) {
  return (
    <div className="field-block">
      <label htmlFor={id}>
        {label}
        {help ? <InfoHint help={help} /> : null}
      </label>
      {children}
    </div>
  );
}

function getBeneficiaryAddressError(address: string, index: number) {
  const label = `Recipient ${index + 1}`;
  const trimmedAddress = address.trim();

  if (!trimmedAddress) {
    return `${label} address is required.`;
  }

  if (!walletAddressPattern.test(trimmedAddress)) {
    return `${label} needs a valid 0x wallet address.`;
  }

  return "";
}

function DurationField({
  duration,
  help,
  label,
  namePrefix,
  onChange
}: {
  duration: DurationDraft;
  help: string;
  label: string;
  namePrefix: "interval" | "grace" | "timelock";
  onChange: (duration: DurationDraft) => void;
}) {
  const daysId = `${namePrefix}Days`;
  const hoursId = `${namePrefix}Hours`;

  function updatePart(part: keyof DurationDraft, value: string) {
    const max = part === "days" ? 3650 : 23;
    const min = part === "days" ? 1 : 0;
    onChange({ ...duration, [part]: clampNumber(value, min, max) });
  }

  function normalizePart(part: keyof DurationDraft) {
    const min = part === "days" ? 1 : 0;
    const max = part === "days" ? 3650 : 23;
    const value = duration[part] === "" ? String(min) : duration[part];
    onChange({ ...duration, [part]: clampNumber(value, min, max) || String(min) });
  }

  return (
    <div className="duration-card">
      <label>
        {label}
        <InfoHint help={help} />
      </label>
      <div className="duration-inputs">
        <div className="input-with-unit compact-unit">
          <Input
            aria-label={`${label} days`}
            id={daysId}
            inputMode="numeric"
            name={daysId}
            onBlur={() => normalizePart("days")}
            onChange={(event) => updatePart("days", event.target.value)}
            type="text"
            value={duration.days}
          />
          <span>days</span>
        </div>
        <div className="input-with-unit compact-unit">
          <Input
            aria-label={`${label} hours`}
            id={hoursId}
            inputMode="numeric"
            name={hoursId}
            onBlur={() => normalizePart("hours")}
            onChange={(event) => updatePart("hours", event.target.value)}
            type="text"
            value={duration.hours}
          />
          <span>hours</span>
        </div>
      </div>
    </div>
  );
}

function InfoHint({ help }: { help: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="info-hint" type="button" aria-label={help}>
          <Info size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="riskguard-tooltip" sideOffset={8}>
        {help}
      </TooltipContent>
    </Tooltip>
  );
}
