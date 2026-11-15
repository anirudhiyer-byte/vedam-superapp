"use client";

import type { ReactNode } from "react";
import { Button, Icon, type IconName } from "./primitives";

/**
 * Shared screen states (v2). Same look as the table's empty row and the
 * flow screen's error card, so loading / empty / error read the same everywhere.
 */

/** Pulsing block. Pass width/height classes, e.g. <Skeleton className="h-4 w-40" />. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-surface-warm ${className}`} />;
}

const panel = "grid place-items-center rounded-2xl border border-border bg-surface px-6 py-14 text-center";

export function EmptyState({ icon = "folder", title, body, action }: {
  icon?: IconName; title: string; body?: string; action?: { label: string; onClick: () => void; icon?: IconName };
}) {
  return (
    <div className={panel}>
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-surface-warm text-muted">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <h2 className="mt-3 font-display text-base font-bold text-heading">{title}</h2>
      {body && <p className="mt-1 max-w-sm font-body text-sm text-muted">{body}</p>}
      {action && (
        <div className="mt-5">
          <Button variant="solid" touch icon={action.icon} onClick={action.onClick}>{action.label}</Button>
        </div>
      )}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, onRetry }: {
  title?: string; message: string; onRetry: () => void;
}) {
  return (
    <div role="alert" className={panel}>
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#3d1414] text-[#f87171]">
        <Icon name="alert" className="h-6 w-6" />
      </span>
      <h2 className="mt-3 font-display text-base font-bold text-heading">{title}</h2>
      <p className="mt-1 max-w-sm font-body text-sm text-muted">{message}</p>
      <div className="mt-5"><Button touch icon="refresh" onClick={onRetry}>Try again</Button></div>
    </div>
  );
}

/** Small inline error line under a form or button row. */
export function InlineError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 font-body text-xs font-semibold text-[#f87171]">
      <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
