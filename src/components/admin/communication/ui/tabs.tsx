"use client";

import { useRef } from "react";
import { Icon, FOCUS_RING, type IconName } from "./primitives";

/**
 * Accessible tab strip (v2): role=tablist, arrow keys / Home / End move between tabs,
 * only the active tab is in the Tab order, 44px tall on phones.
 * The caller renders the panel with `tabPanelProps(prefix, key)`.
 */
export const tabId = (prefix: string, key: string) => `${prefix}-tab-${key}`;
export const panelId = (prefix: string, key: string) => `${prefix}-panel-${key}`;
export const tabPanelProps = (prefix: string, key: string) =>
  ({ role: "tabpanel", id: panelId(prefix, key), "aria-labelledby": tabId(prefix, key), tabIndex: 0 }) as const;

export function Tabs<T extends string>({ prefix, label, tabs, active, onChange, cols = 4 }: {
  prefix: string; label: string;
  tabs: { key: T; label: string; icon?: IconName }[]; active: T; onChange: (k: T) => void;
  /** number of equal columns; use 2 for a two-tab strip (it stays compact on wide screens) */
  cols?: 2 | 4 | 5;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (to: number) => {
    const t = tabs[(to + tabs.length) % tabs.length];
    onChange(t.key);
    refs.current[t.key]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") { e.preventDefault(); move(i + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(tabs.length - 1); }
  };
  return (
    <div role="tablist" aria-label={label} className={`grid gap-1 rounded-xl border border-border bg-background p-1 ${cols === 2 ? "grid-cols-2 sm:max-w-sm" : cols === 5 ? "grid-cols-5" : "grid-cols-4"}`}>
      {tabs.map((t, i) => {
        const on = t.key === active;
        return (
          <button key={t.key} ref={(el) => { refs.current[t.key] = el; }} type="button" role="tab"
            id={tabId(prefix, t.key)} aria-selected={on} aria-controls={panelId(prefix, t.key)} tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.key)} onKeyDown={(e) => onKey(e, i)}
            className={`flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 font-body text-xs font-semibold transition-colors sm:min-h-0 sm:flex-row sm:gap-2 sm:py-2 sm:text-sm ${FOCUS_RING} ${
              on ? "bg-surface-warm text-accent-soft" : "text-muted hover:text-foreground"}`}>
            {t.icon && <Icon name={t.icon} className="h-4 w-4 shrink-0" />}
            <span className="truncate">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
