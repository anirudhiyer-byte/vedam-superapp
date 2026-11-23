"use client";
/**
 * VSAT admin · refresh shimmer. Pressing Refresh blurs a card's content and sweeps a soft band of white light across it
 * until the new data is in (at least one full sweep). CSS: `.vx-refresh` in src/app/globals.css; timing rule:
 * src/lib/admin/refresh-shimmer.ts. Only the Refresh button starts it; other reloads (after a booking, realtime) do not.
 *
 *   const shimmer = useRefreshShimmer(loading);
 *   <button onClick={() => { shimmer.start(); reload(); }}>Refresh</button>
 *   <RefreshShimmer on={shimmer.on} className="rounded-[18px]">…card…</RefreshShimmer>
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { REFRESH_MIN_MS, refreshHoldMs } from "@/lib/admin/refresh-shimmer";

export function useRefreshShimmer(loading: boolean, minMs = REFRESH_MIN_MS): { on: boolean; start: () => void } {
  const [on, setOn] = useState(false);
  const startedAt = useRef(0);
  const start = useCallback(() => { startedAt.current = Date.now(); setOn(true); }, []);
  useEffect(() => {
    if (!on) return;
    const hold = refreshHoldMs(startedAt.current, Date.now(), loading, minMs);
    if (hold === null) return; // still loading: wait for it
    const t = setTimeout(() => setOn(false), hold);
    return () => clearTimeout(t);
  }, [on, loading, minMs]);
  return { on, start };
}

/** Wraps one card. `delayMs` staggers the sweep when a page has several cards (a small wave). */
export function RefreshShimmer({ on, delayMs = 0, className, children }: { on: boolean; delayMs?: number; className?: string; children: ReactNode }) {
  return (
    <div className={`vx-refresh ${className ?? ""}`} data-refreshing={on ? "" : undefined} aria-busy={on || undefined}
      style={{ "--vx-refresh-delay": `${delayMs}ms` } as CSSProperties}>
      {children}
      <span aria-hidden="true" className="vx-refresh-sweep" />
    </div>
  );
}
