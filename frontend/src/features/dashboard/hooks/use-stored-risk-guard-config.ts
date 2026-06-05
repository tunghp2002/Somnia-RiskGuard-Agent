import { useSyncExternalStore } from "react";

import type { GuardRuleId, RiskGuardConfig } from "../types";

const storageKey = "riskguard-policy-config";
const changeEventName = "riskguard-policy-config-change";

export const defaultRiskGuardConfig: RiskGuardConfig = {
  enabled: false,
  selectedRules: ["large-transfer", "unlimited-approve", "new-contract"],
  largeTransferMode: "amount",
  largeTransferThreshold: "",
};

function parseStoredConfig(raw: string | null): RiskGuardConfig {
  if (!raw) {
    return defaultRiskGuardConfig;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RiskGuardConfig>;
    const validRules: GuardRuleId[] = [
      "large-transfer",
      "unlimited-approve",
      "new-contract",
    ];
    const selectedRules = (
      parsed.selectedRules ?? defaultRiskGuardConfig.selectedRules
    ).filter((rule): rule is GuardRuleId => validRules.includes(rule as GuardRuleId));
    const legacyPercentSelected = (parsed.selectedRules ?? []).includes(
      "balance-percent" as GuardRuleId,
    );
    const largeTransferMode =
      parsed.largeTransferMode ??
      (legacyPercentSelected ? "percent" : defaultRiskGuardConfig.largeTransferMode);

    return {
      enabled: Boolean(parsed.enabled),
      selectedRules:
        legacyPercentSelected && !selectedRules.includes("large-transfer")
          ? [...selectedRules, "large-transfer"]
          : selectedRules,
      largeTransferMode,
      largeTransferThreshold:
        parsed.largeTransferThreshold ??
        (largeTransferMode === "percent"
          ? (parsed as { nativePercentThreshold?: string }).nativePercentThreshold
          : (parsed as { nativeAmountThreshold?: string }).nativeAmountThreshold) ??
        defaultRiskGuardConfig.largeTransferThreshold,
    };
  } catch {
    return defaultRiskGuardConfig;
  }
}

// Cache the parsed snapshot so useSyncExternalStore receives a stable reference
// while the underlying raw string is unchanged (a fresh object every read would
// loop the store).
let cachedRaw: string | null = null;
let cachedConfig: RiskGuardConfig = defaultRiskGuardConfig;

function getSnapshot(): RiskGuardConfig {
  if (typeof window === "undefined") {
    return defaultRiskGuardConfig;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedConfig = parseStoredConfig(raw);
  }

  return cachedConfig;
}

function getServerSnapshot(): RiskGuardConfig {
  return defaultRiskGuardConfig;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(changeEventName, onChange);

  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(changeEventName, onChange);
  };
}

/** Persist the RiskGuard policy config and notify same-tab subscribers. */
export function persistRiskGuardConfig(next: RiskGuardConfig) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(next));
  window.dispatchEvent(new Event(changeEventName));
}

/**
 * Read the RiskGuard policy config from localStorage as an external store.
 *
 * Using `useSyncExternalStore` keeps the server/initial render on the default
 * config (no hydration mismatch) and avoids the mount-time `setState` in an
 * effect that the React lint flags.
 */
export function useStoredRiskGuardConfig(): [RiskGuardConfig, (next: RiskGuardConfig) => void] {
  const config = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [config, persistRiskGuardConfig];
}
