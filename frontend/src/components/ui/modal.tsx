import { cn } from "@/lib/utils";

import type { FormEvent, ReactNode } from "react";

/**
 * Shared modal shell used across the dashboard and settings features.
 *
 * It renders the standard `.profile-modal-overlay` + `.profile-modal` markup so
 * every dialog shares the same styling instead of copy-pasting the wrapper.
 * Pass `onSubmit` to render the container as a `<form>` (e.g. the RiskGuard
 * setup dialog); otherwise it renders as a `<div>`.
 */
export function Modal({
  children,
  className,
  onSubmit,
  overlayClassName,
  role = "dialog",
}: {
  children: ReactNode;
  className?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  overlayClassName?: string;
  role?: "dialog" | "alertdialog";
}) {
  const containerClassName = cn("profile-modal", className);

  return (
    <div className={cn("profile-modal-overlay", overlayClassName)} role="presentation">
      {onSubmit ? (
        <form aria-modal="true" className={containerClassName} onSubmit={onSubmit} role={role}>
          {children}
        </form>
      ) : (
        <div aria-modal="true" className={containerClassName} role={role}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Footer row for modal call-to-action buttons (`.profile-modal-actions`). */
export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="profile-modal-actions">{children}</div>;
}
