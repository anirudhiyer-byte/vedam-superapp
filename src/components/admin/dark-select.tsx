"use client";

import { useEffect, useRef, useState } from "react";

/** Fully theme-controlled dark dropdown — replaces native <select> so the
 *  open list isn't the OS light-blue highlight. Accent-tinted selection. */
export function DarkSelect({
  value, onChange, options, placeholder = "Select", className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);

  return (
    <div ref={ref} className={"relative font-[family-name:var(--font-inter)] " + className}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-left text-sm text-white outline-none transition-colors hover:border-white/25 focus:border-[color:rgb(var(--accent))]">
        <span className={"truncate " + (cur ? "text-white" : "text-white/40")}>{cur ? cur.label : placeholder}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={"h-4 w-4 shrink-0 text-white/50 transition-transform " + (open ? "rotate-180" : "")}><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-72 min-w-full overflow-auto rounded-xl border border-white/10 bg-[#16161b] p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]">
          {options.length === 0 && <div className="px-3 py-2 text-sm text-white/40">No options</div>}
          {options.map((o) => {
            const sel = o.value === value;
            return (
              <button key={o.value || "__empty"} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
                className={["flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  sel ? "bg-[color:rgb(var(--accent))]/20 text-white" : "text-white/80 hover:bg-white/[0.07] hover:text-white"].join(" ")}>
                <span className="truncate">{o.label}</span>
                {sel && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 text-[color:rgb(var(--accent))]"><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
