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
 * Lightweight active-time heartbeat. While the tab is visible it accumulates seconds and
 * flushes the delta every 60s (and on hide / navigation). Every visible second counts
 * toward the whole-site bucket ("site"); seconds spent on a product surface
 * (CodeSprint / Bootcamp) additionally count toward that product. One write/user/~minute
 * per bucket keeps it scalable; the server rolls it into product_active_daily for
 * DAU/WAU/MAU (≥5 min/day).
 */
export function ActiveHeartbeat() {
  const path = usePathname();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const productRef = useRef<Product | null>(null);
  const siteSecs = useRef(0);               // unflushed whole-site seconds
  const prodSecs = useRef(0);               // unflushed product seconds
  const prodBucket = useRef<Product | null>(null);
  const loggedInRef = useRef(false);

  useEffect(() => {
    const sb = supabaseRef.current!;
    sb.auth.getSession().then(({ data }) => { loggedInRef.current = !!data.session?.user; });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => { loggedInRef.current = !!s?.user; });
    return () => sub.subscription.unsubscribe();
  }, []);

  const ping = async (product: string, secs: number) => {
    if (!secs || !loggedInRef.current) return;
    try { await supabaseRef.current!.rpc("track_active_ping", { p_product: product, p_seconds: secs }); } catch { /* best effort */ }
  };

  const flush = useRef(async () => {
    const site = Math.floor(siteSecs.current); siteSecs.current = 0;
    const prod = Math.floor(prodSecs.current); const bucket = prodBucket.current; prodSecs.current = 0;
    if (site > 0) await ping("site", site);
    if (prod > 0 && bucket) await ping(bucket, prod);
  });

  // keep the active product in sync with the route; flush the product bucket before switching
  useEffect(() => {
    const next = productFor(path);
    if (prodBucket.current && prodBucket.current !== next && prodSecs.current > 0) void flush.current();
    productRef.current = next;
    if (next) prodBucket.current = next;
  }, [path]);

  useEffect(() => {
    // 1s per visible second: always toward "site"; also toward the product when on one
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") {
        siteSecs.current += 1;
        if (productRef.current) { prodSecs.current += 1; prodBucket.current = productRef.current; }
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
