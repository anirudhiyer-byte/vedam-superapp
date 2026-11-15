"use client";

import { FOCUS_RING } from "./primitives";
import { InlineError } from "./states";

/**
 * Date range with quick presets (v2). The value is one string, "YYYY-MM-DD..YYYY-MM-DD",
 * so it fits the existing filter map. Empty string = no range.
 */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const PRESETS = [
  { key: "today", label: "Today", range: (t: Date) => [t, t] },
  { key: "yesterday", label: "Yesterday", range: (t: Date) => [addDays(t, -1), addDays(t, -1)] },
  { key: "last7", label: "Last 7 days", range: (t: Date) => [addDays(t, -6), t] },
  { key: "last30", label: "Last 30 days", range: (t: Date) => [addDays(t, -29), t] },
  { key: "month", label: "This month", range: (t: Date) => [new Date(t.getFullYear(), t.getMonth(), 1), t] },
  { key: "lastMonth", label: "Last month", range: (t: Date) => [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)] },
] as const;

const split = (v: string) => { const [from = "", to = ""] = v.split(".."); return { from, to }; };

export function rangeError(v: string): string | null {
  if (!v) return null;
  const { from, to } = split(v);
  if (!from && !to) return null;
  if (!from) return "Pick a start date.";
  if (!to) return "Pick an end date.";
  if (from > to) return "The start date must be on or before the end date.";
  return null;
}

const show = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
export function rangeLabel(v: string): string {
  const { from, to } = split(v);
  if (!from || !to) return from ? `from ${show(from)}` : to ? `until ${show(to)}` : "";
  return from === to ? show(from) : `${show(from)} – ${show(to)}`;
}

export function DateRangeField({ id, value, onChange, today = new Date() }: {
  id: string; value: string; onChange: (v: string) => void; today?: Date;
}) {
  const { from, to } = split(value);
  const err = rangeError(value);
  const set = (f: string, t: string) => onChange(f || t ? `${f}..${t}` : "");
  const activePreset = PRESETS.find((p) => { const [a, b] = p.range(today); return iso(a) === from && iso(b) === to; })?.key;
  const input = `w-full min-h-[44px] rounded-lg border bg-background px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft/60 sm:min-h-0 [color-scheme:dark] ${err ? "border-[#f87171]" : "border-border"}`;
  return (
    <div className="grid gap-3">
      <div role="group" aria-label="Quick ranges" className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" aria-pressed={activePreset === p.key}
            onClick={() => { const [a, b] = p.range(today); set(iso(a), iso(b)); }}
            className={`min-h-[44px] rounded-full border px-3 font-body text-xs font-semibold transition-colors sm:min-h-0 sm:py-1.5 ${FOCUS_RING} ${
              activePreset === p.key ? "border-accent bg-surface-warm text-accent" : "border-border text-muted hover:text-foreground"}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${id}-from`} className="mb-1 block font-body text-xs font-semibold text-muted">From</label>
          <input id={`${id}-from`} type="date" value={from} max={to || undefined} onChange={(e) => set(e.target.value, to)}
            aria-invalid={!!err || undefined} aria-describedby={err ? `${id}-error` : undefined} className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-to`} className="mb-1 block font-body text-xs font-semibold text-muted">To</label>
          <input id={`${id}-to`} type="date" value={to} min={from || undefined} onChange={(e) => set(from, e.target.value)}
            aria-invalid={!!err || undefined} aria-describedby={err ? `${id}-error` : undefined} className={input} />
        </div>
      </div>
      {err && <InlineError id={`${id}-error`}>{err}</InlineError>}
    </div>
  );
}
