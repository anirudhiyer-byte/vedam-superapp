"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

type Product = "codesprint" | "bootcamp";
function productFor(path: string | null): Product | null {
  if (!path) return null;
  if (path.startsWith("/codesprint")) return "codesprint";
  if (path.startsWith("/events") || path.startsWith("/e/")) return "bootcamp";
  return null;
}

/**
 * Lightweight active-time heartbeat. While the tab is visible on a product surface
 * (CodeSprint / Bootcamp), it accumulates seconds client-side and flushes the delta to
 * track_active_ping every 60s and on hide / navigation. One write/user/~minute keeps it
 * scalable; the server rolls it into product_active_daily for DAU/WAU/MAU (≥5 min/day).
 */
export function ActiveHeartbeat() {
  const path = usePathname();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const productRef = useRef<Product | null>(null);
  const pendingRef = useRef(0);          // unflushed active seconds
  const pendingProductRef = useRef<Product | null>(null);
  const loggedInRef = useRef(false);

  // track auth presence (don't ping for anonymous visitors)
  useEffect(() => {
    const sb = supabaseRef.current!;
    sb.auth.getSession().then(({ data }) => { loggedInRef.current = !!data.session?.user; });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => { loggedInRef.current = !!s?.user; });
    return () => sub.subscription.unsubscribe();
  }, []);

  const flush = useRef(async () => {
    const secs = Math.floor(pendingRef.current);
    const prod = pendingProductRef.current;
    pendingRef.current = 0;
    if (!secs || !prod || !loggedInRef.current) return;
    try { await supabaseRef.current!.rpc("track_active_ping", { p_product: prod, p_seconds: secs }); } catch { /* best effort */ }
  });

  // keep the active product in sync with the route; flush pending before switching
  useEffect(() => {
    const next = productFor(path);
    if (pendingProductRef.current && pendingProductRef.current !== next && pendingRef.current > 0) void flush.current();
    productRef.current = next;
    if (next) pendingProductRef.current = next;
  }, [path]);

  useEffect(() => {
    // accumulate 1s per visible second spent on a product surface
    const tick = setInterval(() => {
      if (productRef.current && document.visibilityState === "visible") {
        pendingRef.current += 1;
        pendingProductRef.current = productRef.current;
      }
    }, 1000);
    const flushTimer = setInterval(() => { void flush.current(); }, 60000);
    const onHide = () => { if (document.visibilityState === "hidden") void flush.current(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(tick); clearInterval(flushTimer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      void flush.current();
    };
  }, []);

  return null;
}
