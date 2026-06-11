import { AgentApiError, type AuditEvent } from "@/lib/agent-api";

export function formatAddress(address?: string) {
  if (!address) {
    return "not set";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatDate(value?: string) {
  if (!value) {
    return "not available";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatUsd(value?: string) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function classForStatus(status?: string) {
  if (status === "succeeded" || status === "healthy" || status === "beneficiary_available") {
    return "status-ok";
  }

  if (status === "skipped" || status === "reminder_due" || status === "timelock_pending") {
    return "status-warn";
  }

  if (status === "failed" || status === "denied" || status === "expired") {
    return "status-bad";
  }

  return "status-neutral";
}

export function errorMessage(error: unknown) {
  if (error instanceof AgentApiError) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    if (error.message.includes("0xaf9aa1e0")) {
      return "Selected account is not deployed as a smart account yet. Try creating the smart account again, then save the plan.";
    }

    if (
      error.message.includes("execution reverted") &&
      (error.message.includes('"data":"0x"') || error.message.includes('data="0x"'))
    ) {
      return "Transaction was rejected by the destination contract without details. Check the recipient, amount, and account setup before trying again.";
    }

    return error.message;
  }

  return "Request failed";
}

export function hasOkFlag(value: unknown): value is { ok: boolean } {
  return Boolean(value && typeof value === "object" && "ok" in value);
}

export function durationToSeconds(form: FormData, prefix: "interval" | "grace" | "timelock", fallbackDays: number) {
  const days = Number(form.get(`${prefix}Days`) ?? fallbackDays);
  const hours = Number(form.get(`${prefix}Hours`) ?? 0);
  const safeDays = Number.isFinite(days) ? Math.max(0, days) : fallbackDays;
  const safeHours = Number.isFinite(hours) ? Math.max(0, hours) : 0;

  return Math.round((safeDays * 24 * 60 * 60) + (safeHours * 60 * 60));
}

export function readableMetadata(value: unknown): string {
  if (!value) {
    return "no details";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => readableMetadata(item)).join(", ");
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !key.toLowerCase().includes("signature"))
    .slice(0, 3)
    .map(([key, item]) => `${key}: ${typeof item === "object" ? readableMetadata(item) : String(item)}`);

  return entries.join(" | ") || "no details";
}

export function isSimulationEvent(event: AuditEvent): boolean {
  return event.metadata.mode === "simulation";
}
