"use client";

import { Icon, Menu, StatusPill, FOCUS_RING, type MenuItem } from "../../ui/primitives";
import { Skeleton } from "../../ui/states";
import type { FlowRow } from "../../lib/types";

export type FlowActions = {
  preview: (f: FlowRow) => void;
  use: (f: FlowRow) => void;
  duplicate: (f: FlowRow) => void;
  toggleStatus: (f: FlowRow) => void;
  remove: (f: FlowRow) => void;
};

/** Recommended flows can be previewed or used; your own flows can also be copied, switched and deleted. */
function menuFor(f: FlowRow, act: FlowActions): MenuItem[] {
  if (f.scope === "recommended") {
    return [
      { label: "Preview", icon: "phone", onClick: () => act.preview(f) },
      { label: "Use", icon: "plus", onClick: () => act.use(f) },
    ];
  }
  return [
    { label: "Preview", icon: "phone", onClick: () => act.preview(f) },
    { label: "Duplicate", icon: "copy", onClick: () => act.duplicate(f) },
    { label: f.status === "Active" ? "Move to Draft" : "Mark as Active", icon: "check", onClick: () => act.toggleStatus(f) },
    { label: "Delete", icon: "trash", danger: true, onClick: () => act.remove(f) },
  ];
}

export function FlowCard({ flow: f, act }: { flow: FlowRow; act: FlowActions }) {
  return (
    <article className="flex flex-col rounded-2xl border border-border bg-surface transition-colors hover:border-accent/50">
      <div className="flex items-start gap-3 p-4 pr-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-warm text-accent">
          <Icon name="whatsapp" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-sm font-bold text-heading">{f.name}</h2>
          <p className="truncate font-body text-xs text-muted">{f.description || "No description"}</p>
        </div>
        <Menu align="right" touch items={menuFor(f, act)}
          trigger={(open, toggle) => (
            <button type="button" onClick={toggle} aria-label={`Actions for ${f.name}`} aria-haspopup="menu" aria-expanded={open}
              data-flow-actions={f.id}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg sm:h-8 sm:w-8 ${FOCUS_RING} ${open ? "bg-surface-warm text-accent" : "text-muted hover:bg-surface-warm hover:text-foreground"}`}>
              <Icon name="dots" className="h-4 w-4" />
            </button>
          )}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 pb-4">
        <span className="inline-flex rounded-md bg-surface-warm px-2 py-1 font-mono text-[10px] font-semibold text-accent-soft">{f.tag}</span>
        <span className="inline-flex rounded-md border border-border px-2 py-1 font-mono text-[10px] font-semibold text-muted">{f.category}</span>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <span className="inline-flex items-center gap-1.5 font-body text-[11px] text-muted">
          <Icon name="calendar" className="h-3 w-3" />
          <span className="sr-only">Created on </span>{f.createdOn}
        </span>
        <StatusPill status={f.status} />
      </div>
    </article>
  );
}

export function FlowCardSkeleton() {
  return (
    <div aria-hidden className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>
      </div>
      <Skeleton className="mt-4 h-5 w-24" />
      <div className="mt-6 flex justify-between"><Skeleton className="h-3 w-28" /><Skeleton className="h-4 w-14" /></div>
    </div>
  );
}
