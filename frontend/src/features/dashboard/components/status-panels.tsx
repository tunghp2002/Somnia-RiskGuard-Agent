import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { formatAddress } from "../utils";

import type { GuardRuleId, RiskGuardConfig, RiskGuardRule } from "../types";
import type { Mode, Readiness } from "@/lib/agent-api";
import type { BrowserWalletState } from "@/lib/wallet";
import type { ReactNode } from "react";

export function GuardianStatus({
  ready,
  readiness,
  wallet,
  mode
}: {
  ready: boolean;
  readiness: Readiness | null;
  wallet: BrowserWalletState | null;
  mode: Mode;
}) {
  return (
    <section className="panel guardian-panel">
      <PanelHeading icon={<Shield size={18} />} title="Guardian Status" action={mode} />
      <div className={`guardian-state ${ready ? "ready" : "blocked"}`}>
        {ready ? <CheckCircle2 size={24} /> : <AlertTriangle size={24} />}
        <div>
          <strong>{ready ? "Ready" : "Needs setup"}</strong>
          <span>{ready ? "Monitoring can explain and gate actions." : "Connect a wallet and finish your profile setup."}</span>
        </div>
      </div>
      <div className="role-chips">
        <RoleChip label="Browser" value={formatAddress(wallet?.address)} />
        <RoleChip label="Monitored" value={formatAddress(readiness?.monitoredWallet.walletAddress)} />
        <RoleChip label="Session keys" value={readiness?.sessionKey.ready ? "configured" : "missing"} />
      </div>
    </section>
  );
}

export function RiskPolicyGuard({
  actionLoading,
  config,
  moduleReady,
  onConfigure,
  rules
}: {
  actionLoading: string | null;
  config: RiskGuardConfig;
  moduleReady: boolean;
  onConfigure: (config: RiskGuardConfig) => void;
  rules: RiskGuardRule[];
}) {
  const [draftConfig, setDraftConfig] = useState<RiskGuardConfig>(config);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const largeTransferEnabled = draftConfig.selectedRules.includes("large-transfer");

  function toggleRule(ruleId: GuardRuleId) {
    setValidationError(null);
    setDraftConfig((current) => ({
      ...current,
      selectedRules: current.selectedRules.includes(ruleId)
        ? current.selectedRules.filter((selectedRule) => selectedRule !== ruleId)
        : [...current.selectedRules, ruleId],
    }));
  }

  function validateDraftConfig() {
    if (!largeTransferEnabled) {
      return null;
    }

    if (!/^\d+(\.\d+)?$/.test(draftConfig.largeTransferThreshold.trim())) {
      return "Large transfer threshold must be a positive number.";
    }

    const threshold = Number(draftConfig.largeTransferThreshold);

    if (!Number.isFinite(threshold) || threshold <= 0) {
      return "Large transfer threshold must be greater than 0.";
    }

    if (draftConfig.largeTransferMode === "percent" && threshold > 100) {
      return "Balance percent must be between 0 and 100.";
    }

    return null;
  }

  function sanitizeThreshold(value: string, mode = draftConfig.largeTransferMode) {
    const sanitized = value
      .replace(/[^\d.]/g, "")
      .replace(/(\..*)\./g, "$1");

    if (!sanitized) {
      return "";
    }

    const numeric = Number(sanitized);

    if (!Number.isFinite(numeric)) {
      return "";
    }

    if (mode === "percent" && numeric > 100) {
      return "100";
    }

    return sanitized;
  }

  return (
    <section className="panel risk-panel">
      <PanelHeading icon={<ShieldAlert size={18} />} title="Risk Policy Guard" action={moduleReady ? "module armed" : "module pending"} />
      <div className={`guard-status-visual ${moduleReady ? "armed" : "broken"}`}>
        {moduleReady ? <ShieldCheck size={54} /> : <ShieldX size={54} />}
      </div>
      {moduleReady ? (
        <>
          <p>Smart account policy checks are active before risky UserOps execute.</p>
          <div className="next-steps">
            {rules
              .filter((rule) => rule.status === "armed")
              .map((rule) => (
                <span className={`policy-rule ${rule.status}`} key={rule.id}>
                  <strong>{rule.label}</strong>
                  <small>{rule.detail}</small>
                </span>
              ))}
          </div>
        </>
      ) : (
        <p className="guard-empty-state">Custom Validation Module has not been set up yet.</p>
      )}
      <Button
        className="guard-configure-button"
        disabled={actionLoading === "risk-policy"}
        onClick={() => {
          setDraftConfig(config);
          setValidationError(null);
          setModalOpen(true);
        }}
        type="button"
        variant="secondary"
      >
        {actionLoading === "risk-policy" ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}
        Configure guard
      </Button>

      {modalOpen ? (
        <div className="profile-modal-overlay" role="presentation">
          <form
            aria-modal="true"
            className="profile-modal risk-policy-modal"
            onSubmit={(event) => {
              event.preventDefault();
              const error = validateDraftConfig();

              if (error) {
                setValidationError(error);
                return;
              }

              onConfigure({ ...draftConfig, enabled: true });
              setModalOpen(false);
            }}
            role="dialog"
          >
            <h3>Setup RiskGuard Module</h3>
            <p>Choose which risky UserOps require agent validation before execution.</p>
            <div className="risk-policy-checks">
              {rules.map((rule) => (
                <label className="risk-policy-check" key={rule.id}>
                  <input
                    checked={draftConfig.selectedRules.includes(rule.id)}
                    onChange={() => toggleRule(rule.id)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{rule.label}</strong>
                    <small>{rule.detail}</small>
                  </span>
                </label>
              ))}
            </div>
            {largeTransferEnabled ? (
              <div className="risk-policy-threshold-grid">
                <label>
                  Validate by
                  <select
                    onChange={(event) => {
                      setValidationError(null);
                      setDraftConfig((current) => ({
                        ...current,
                        largeTransferMode: event.target.value as RiskGuardConfig["largeTransferMode"],
                        largeTransferThreshold: sanitizeThreshold(current.largeTransferThreshold, event.target.value as RiskGuardConfig["largeTransferMode"]),
                      }));
                    }}
                    value={draftConfig.largeTransferMode}
                  >
                    <option value="amount">SOMI amount</option>
                    <option value="percent">Balance %</option>
                  </select>
                </label>
                <label>
                  Threshold
                  <Input
                    inputMode="decimal"
                    max={draftConfig.largeTransferMode === "percent" ? 100 : undefined}
                    min="0"
                    onKeyDown={(event) => {
                      if (["-", "+", "e", "E"].includes(event.key)) {
                        event.preventDefault();
                      }
                    }}
                    onChange={(event) => {
                      setValidationError(null);
                      setDraftConfig((current) => ({
                        ...current,
                        largeTransferThreshold: sanitizeThreshold(event.target.value, current.largeTransferMode),
                      }));
                    }}
                    placeholder={draftConfig.largeTransferMode === "percent" ? "Enter percent" : "Enter SOMI"}
                    type="number"
                    value={draftConfig.largeTransferThreshold}
                  />
                </label>
              </div>
            ) : null}
            {validationError ? <p className="field-error">{validationError}</p> : null}
            <div className="profile-modal-actions">
              <Button onClick={() => setModalOpen(false)} type="button" variant="secondary">
                Cancel
              </Button>
              <Button className="confirm-button" type="submit" variant="primary">
                Confirm
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

export function PanelHeading({
  icon,
  title,
  action
}: {
  icon: ReactNode;
  title: string;
  action?: string;
}) {
  return (
    <div className="panel-heading">
      <div>{icon}<h2>{title}</h2></div>
    </div>
  );
}

export function HealthRow({
  icon,
  label,
  value,
  tone
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className="health-row">
      <span>{icon}{label}</span>
      <strong className={`status-${tone}`}>{value}</strong>
    </div>
  );
}

function RoleChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="role-chip">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}
