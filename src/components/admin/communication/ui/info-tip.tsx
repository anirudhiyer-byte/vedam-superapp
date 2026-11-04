"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon, FOCUS_RING } from "./primitives";

/**
 * Small "i" button that explains a screen (v2). Opens on hover, keyboard focus or tap;
 * Escape or a click elsewhere closes it. The text is also linked with aria-describedby.
 */
export function InfoTip({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = open || pinned;

  useEffect(() => {
    if (!shown) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setPinned(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setPinned(false); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [shown]);

  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={label} aria-expanded={shown} aria-describedby={shown ? id : undefined}
        onClick={() => setPinned((v) => !v)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className={`grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:text-foreground sm:h-8 sm:w-8 ${FOCUS_RING}`}>
        <Icon name="info" className="h-4 w-4" />
      </button>
      {shown && (
        <span id={id} role="tooltip"
          className="absolute left-0 top-full z-40 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface px-3.5 py-2.5 font-body text-xs font-normal leading-relaxed text-foreground shadow-2xl">
          {children}
        </span>
      )}
    </span>
  );
}
