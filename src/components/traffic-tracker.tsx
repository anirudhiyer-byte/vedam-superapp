"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function sid(): string {
  try { let s = localStorage.getItem("v1_sid"); if (!s) { s = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)); localStorage.setItem("v1_sid", s); } return s; }
  catch { return "anon"; }
}
/** Logs one row per page navigation into traffic_events (site traffic + /register attempts). Best-effort, silent. */
export function TrafficTracker() {
  const pathname = usePathname();
  const last = useRef("");
  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;
    (async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        const q = new URLSearchParams(window.location.search);
        await sb.from("traffic_events").insert({
          session_id: sid(), user_id: user?.id ?? null, path: pathname,
          utm_source: q.get("utm_source"), utm_medium: q.get("utm_medium"), utm_campaign: q.get("utm_campaign"),
        });
      } catch { /* best effort */ }
    })();
  }, [pathname]);
  return null;
}
