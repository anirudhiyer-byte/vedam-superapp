"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FOCUS_RING } from "../../ui/primitives";
import { InlineError, Skeleton } from "../../ui/states";
import { useLoad } from "../../ui/use-load";
import { commLogsApi } from "../../lib/mock-api";
import type { CommLogRow } from "../../lib/types";

function Names({ id }: { id: string }) {
  const { state, reload } = useLoad(() => commLogsApi.listLabels(id), "Could not load the list name.");
  if (state.status === "loading") return <Skeleton className="h-4 w-28" />;
  if (state.status === "error") return <div className="grid gap-1"><InlineError>{state.message}</InlineError><button type="button" onClick={reload} className={`w-fit rounded px-1 font-body text-xs font-semibold text-accent-soft underline ${FOCUS_RING}`}>Try again</button></div>;
  return <ul className="grid gap-1">{state.data.map((n) => <li key={n} className="font-body text-xs text-foreground">{n}</li>)}</ul>;
}

/** The List Name link: opens a small panel with the full list name(s). Escape or a click elsewhere closes it and focus returns to the link. */
export function ListNames({ row }: { row: CommLogRow }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); ref.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-label={`List name for ${row.jobId}: ${row.listName}`} onClick={() => setOpen((v) => !v)}
        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-start rounded font-body font-semibold text-accent-soft underline-offset-2 hover:underline sm:min-h-0 sm:min-w-0 ${FOCUS_RING}`}>
        {row.listName}
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="List name" className="absolute left-0 top-full z-40 mt-1 block w-52 max-w-[calc(100vw-3rem)] rounded-xl border border-border bg-surface px-3.5 py-2.5 shadow-2xl">
          <Names id={row.id} />
        </div>
      )}
    </span>
  );
}
