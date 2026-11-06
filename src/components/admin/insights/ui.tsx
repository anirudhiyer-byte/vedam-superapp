"use client";

/* Small presentational pieces shared by the Insights tabs. Dark admin theme. */

import type { ReactNode } from "react";

export const ACCENT = "#8A18FF";
export const BLUE = "#2f9bff";
export const GREEN = "#22e06a";

export function Card({ title, sub, right, children, className = "" }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-bold text-white">{title}</h2>}
            {sub && <p className="mt-0.5 text-[13px] leading-snug text-white/50">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "border-[#8A18FF]/40 bg-[#8A18FF]/[0.08]" : "border-white/10 bg-white/[0.03]"}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{label}</div>
      <div className="mt-1.5 text-[28px] font-bold leading-none tabular-nums text-white">{value}</div>
      {sub && <div className="mt-2 text-[12px] leading-snug text-white/50">{sub}</div>}
    </div>
  );
}

/** A horizontal bar; value / max sets the length. */
export function Bar({ value, max, color = ACCENT, thin }: { value: number; max: number; color?: string; thin?: boolean }) {
  const w = max > 0 ? Math.max((value / max) * 100, value > 0 ? 1.5 : 0) : 0;
  return (
    <div className={`${thin ? "h-1.5" : "h-2.5"} w-full rounded-full bg-white/[0.07]`}>
      <div className={`${thin ? "h-1.5" : "h-2.5"} rounded-full`} style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

/** One line of a ranked list: name, bar, number and a note on the right. Clickable when onClick is set. */
export function BarRow({ name, value, max, right, note, onClick, color }: {
  name: ReactNode; value: number; max: number; right?: ReactNode; note?: ReactNode; onClick?: () => void; color?: string;
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[13.5px] text-white/90">{name}</span>
        <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-white">{right ?? value.toLocaleString("en-IN")}</span>
      </div>
      <div className="mt-1.5"><Bar value={value} max={max} color={color} /></div>
      {note && <div className="mt-1 text-[11.5px] text-white/45">{note}</div>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.05]">{body}</button>
  ) : (
    <div className="px-2 py-2">{body}</div>
  );
}

/** Funnel: each step's bar is sized against the first step; the % between steps is the step-to-step conversion.
 *  overNote = what to say when a step is bigger than the one above it (otherwise a neutral line). */
export function Funnel({ steps }: { steps: { label: string; value: number | null; note?: string; overNote?: string; onClick?: () => void; muted?: boolean }[] }) {
  const first = steps.find((s) => s.value != null)?.value ?? 0;
  return (
    <div className="space-y-1">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const conv = s.value != null && prev ? Math.round((s.value / prev) * 1000) / 10 : null;
        const rowCls = `grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-xl border px-3 py-2.5 text-left sm:grid-cols-[220px_minmax(0,1fr)_auto] ${s.muted ? "border-dashed border-white/10" : "border-white/10 bg-white/[0.02]"} ${s.onClick ? "transition-colors hover:bg-white/[0.06]" : ""}`;
        const inner = (
          <>
            <span className={`text-[13.5px] ${s.muted ? "text-white/40" : "text-white/90"}`}>{s.label}</span>
            <span className="order-3 col-span-2 sm:order-none sm:col-span-1">
              {s.value != null ? <Bar value={s.value} max={first} color={i === 0 ? BLUE : ACCENT} /> : <span className="text-[12px] text-white/35">{s.note}</span>}
            </span>
            <span className="text-right text-[15px] font-bold tabular-nums text-white">{s.value != null ? s.value.toLocaleString("en-IN") : "—"}</span>
          </>
        );
        return (
          <div key={s.label}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-0.5 pl-2 text-[11.5px] text-white/40">
                <span aria-hidden>↓</span>
                {conv == null ? <span>&nbsp;</span>
                  : conv > 100 ? <span>{s.overNote ?? "more than the step above"}</span>
                  : <span>{conv}% of the step above</span>}
              </div>
            )}
            {s.onClick
              ? <button type="button" onClick={s.onClick} className={rowCls}>{inner}</button>
              : <div className={rowCls}>{inner}</div>}
            {s.value != null && s.note && <div className="pl-3 pt-1 text-[11.5px] text-white/40">{s.note}</div>}
          </div>
        );
      })}
    </div>
  );
}

/** A short, plain-English finding shown above a chart. */
export function Insight({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-[#8A18FF]/25 bg-[#8A18FF]/[0.07] px-3.5 py-2.5 text-[13px] leading-snug text-white/85">
      <span aria-hidden className="mt-[1px] text-[#b07cff]">●</span>
      <span>{children}</span>
    </div>
  );
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "good" | "accent" | "muted" }) {
  const cls = {
    default: "border-white/15 bg-white/[0.06] text-white/80",
    good: "border-[#22e06a]/30 bg-[#22e06a]/10 text-[#7ff0a8]",
    accent: "border-[#8A18FF]/35 bg-[#8A18FF]/15 text-[#c9a3ff]",
    muted: "border-white/10 bg-transparent text-white/45",
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${cls}`}>{children}</span>;
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${value === o.key ? "bg-[#8A18FF] text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Loading({ h = 160 }: { h?: number }) {
  return <div className="animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" style={{ height: h }} />;
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="rounded-xl border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 px-4 py-3 text-[13px] text-[#ffb3b3]">Could not load this view: {message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-[13px] text-white/45">{children}</div>;
}

export function Delta({ cur, prev, tag }: { cur: number; prev: number; tag?: string }) {
  if (!prev && !cur) return <span className="text-white/30">—</span>;
  const up = cur >= prev;
  const p = prev === 0 ? null : Math.abs(((cur - prev) / prev) * 100);
  return (
    <span className={`text-[12px] ${up ? "text-[#22e06a]" : "text-[#ff6b6b]"}`} title={`was ${prev.toLocaleString("en-IN")}`}>
      {up ? "▲" : "▼"} {p == null ? "new" : `${p.toFixed(0)}%`}{tag && <span className="text-white/35"> {tag}</span>}
    </span>
  );
}
