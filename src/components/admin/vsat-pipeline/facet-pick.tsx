"use client";
import { useEffect, useRef, useState } from "react";
import { pickSummary } from "@/lib/vsat/grid";

/** One option in a facet dropdown: a value, its label and a count (null = counts not loaded yet). */
export type Opt = { value: string; label: string; count: number | null };

const input = "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#22d3ee] focus:outline-none";

/**
 * Multi-select dropdown with a checkbox + count per option. The list is position:fixed so nothing
 * clips it. Shared by the VSAT Applications grid and the VSAT Leads panel so both read the same.
 */
export function FacetPick({ title, options, value, onChange }:
  { title: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const off = () => setOpen(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    window.addEventListener("scroll", off, true); window.addEventListener("resize", off);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", off, true); window.removeEventListener("resize", off); };
  }, [open]);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <>
      <button ref={btnRef} type="button" aria-label={title} aria-expanded={open}
        onClick={() => { const r = btnRef.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, top: r.bottom + 4 }); setOpen((o) => !o); }}
        className={`${input} flex min-w-[150px] items-center justify-between gap-2 text-left ${value.length ? "border-[#34e2b0]/50" : ""}`}>
        <span className="truncate"><span className="text-white/45">{title}: </span>{pickSummary(value, labelOf)}</span>
        <span className="text-white/40">▾</span>
      </button>
      {open && pos && (
        <div ref={box} style={{ left: pos.left, top: pos.top }} className="fixed z-50 max-h-80 min-w-[240px] overflow-auto rounded-xl border border-white/10 bg-[#141a38] p-1 text-sm shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]">
          {options.length === 0 && <div className="px-3 py-2 text-white/40">Nothing here</div>}
          {options.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-white/85 hover:bg-white/[0.07]">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} className="h-3.5 w-3.5 accent-[#34e2b0]" />
              <span className={`flex-1 ${o.count === 0 ? "text-white/40" : ""}`}>{o.label}</span>
              {o.count !== null && <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${o.count ? "bg-white/10 text-white/80" : "text-white/30"}`}>{o.count}</span>}
            </label>
          ))}
          {value.length > 0 && <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-lg border-t border-white/10 px-2.5 py-1.5 text-left text-xs text-white/55 hover:text-white">Clear</button>}
        </div>
      )}
    </>
  );
}
