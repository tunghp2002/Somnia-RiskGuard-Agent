import { Info } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { clampNumber } from "@/utils/settings";

import type { DurationDraft } from "@/types/settings";
import type { ReactNode } from "react";

export function Field({
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
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

export function DurationField({
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

  function updateDays(value: string) {
    const min = namePrefix === "interval" ? 1 : 0;
    onChange({ days: clampNumber(value, min, 3650), hours: "0" });
  }

  function normalizeDays() {
    const min = namePrefix === "interval" ? 1 : 0;
    const value = duration.days === "" ? String(min) : duration.days;
    onChange({ days: clampNumber(value, min, 3650) || String(min), hours: "0" });
  }

  return (
    <div className="duration-card">
      <label htmlFor={daysId}>
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
            onBlur={normalizeDays}
            onChange={(event) => updateDays(event.target.value)}
            type="text"
            value={duration.days}
          />
          <span>days</span>
        </div>
        <input name={hoursId} type="hidden" value="0" />
      </div>
    </div>
  );
}

export function InfoHint({ help }: { help: string }) {
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
