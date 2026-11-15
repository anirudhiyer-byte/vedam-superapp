"use client";

import { Select, FOCUS_RING } from "../../ui/primitives";

type Props = { total: number; categories: [string, number][]; active: string | null; onChange: (c: string | null) => void };

/**
 * Category filter for the flow cards: a side rail on large screens, a dropdown on phones and tablets.
 * Only one of the two is displayed at a time (CSS), so keyboard users never meet both.
 */
export function CategoryRail({ total, categories, active, onChange }: Props) {
  return (
    <>
      <nav aria-label="Flow categories" className="hidden h-fit rounded-2xl border border-border bg-surface p-2 lg:block">
        <ul className="space-y-1">
          <li><RailItem label="All" sub="Every flow in this tab" count={total} active={active === null} onClick={() => onChange(null)} /></li>
          {categories.map(([name, n]) => (
            <li key={name}><RailItem label={name} count={n} active={active === name} onClick={() => onChange(name)} /></li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-1.5 lg:hidden">
        <label htmlFor="flow-category" className="font-body text-sm font-semibold text-heading">Category</label>
        <Select id="flow-category" touch placeholder={`All (${total})`} value={active ?? ""}
          options={categories.map(([name, n]) => ({ value: name, label: `${name} (${n})` }))}
          onChange={(v) => onChange(v || null)} />
      </div>
    </>
  );
}

function RailItem({ label, sub, count, active, onClick }: { label: string; sub?: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${FOCUS_RING} ${active ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
      <span className="min-w-0 flex-1">
        <span className={`block font-body text-sm font-bold ${active ? "text-accent-soft" : "text-foreground"}`}>{label}</span>
        {sub && <span className="mt-0.5 block font-body text-[11px] leading-snug text-muted">{sub}</span>}
      </span>
      <span className="shrink-0 rounded-full bg-surface-warm px-2 py-0.5 font-mono text-[10px] font-bold text-muted">
        {count}<span className="sr-only"> flows</span>
      </span>
    </button>
  );
}
