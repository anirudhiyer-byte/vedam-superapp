"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export function SearchableSelect({ options, value, onChange, placeholder = "Select…", disabled = false }:
  { options: string[]; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQ(""); } }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? options.filter((o) => o.toLowerCase().includes(t)) : options;
    return list.slice(0, 60);
  }, [options, q]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)}
        className={["flex w-full items-center justify-between rounded-lg border border-border-strong bg-background px-3 py-2.5 text-left font-body text-sm outline-none focus:border-[color:rgb(var(--accent))] disabled:opacity-50",
          value ? "text-foreground" : "text-muted"].join(" ")}>
        <span className="truncate">{value || placeholder}</span>
        <span className="ml-2 text-muted">▾</span>
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-[0_18px_40px_-18px_rgba(43,19,92,0.4)]">
          <div className="p-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-body text-sm text-foreground outline-none" />
          </div>
          <ul className="max-h-56 overflow-y-auto pb-1">
            {filtered.map((o) => (
              <li key={o}>
                <button type="button" onClick={() => { onChange(o); setOpen(false); setQ(""); }}
                  className={["block w-full px-3 py-2 text-left font-body text-sm hover:bg-surface-warm",
                    o === value ? "font-semibold text-accent" : "text-foreground"].join(" ")}>{o}</button>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-3 py-3 text-center font-body text-sm text-muted">No matches</li>}
            {options.length > 60 && filtered.length === 60 && <li className="px-3 py-2 text-center font-mono text-[11px] text-muted">Keep typing to narrow…</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
