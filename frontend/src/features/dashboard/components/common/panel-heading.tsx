import type { ReactNode } from "react";

/**
 * Shared panel header: an icon + title.
 *
 * `action` is accepted for call-site compatibility but intentionally not
 * rendered (the right-side status pill was removed by design).
 */
export function PanelHeading({
  icon,
  title,
}: {
  icon: ReactNode;
  title: string;
  action?: string;
}) {
  return (
    <div className="panel-heading">
      <div>
        {icon}
        <h2>{title}</h2>
      </div>
    </div>
  );
}

/** Single key/value row used in the Operator Health panel. */
export function HealthRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className="health-row">
      <span>
        {icon}
        {label}
      </span>
      <strong className={`status-${tone}`}>{value}</strong>
    </div>
  );
}
