"use client";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

function sid(): string {
  try { let s = localStorage.getItem("v1_sid"); if (!s) { s = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)); localStorage.setItem("v1_sid", s); } return s; }
  catch { return "anon"; }
}
/** Autocapture: logs a click row (label + section + page + utm) for any button / link / [data-track]. Best-effort, silent. */
export function ClickTracker() {
  useEffect(() => {
    const handler = async (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest("[data-track],button,a,[role='button']") as HTMLElement | null;
      if (!el) return;
      const label = (el.getAttribute("data-track") || el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 60) || el.tagName)
        .replace(/\s+/g, " ").trim();
      if (!label) return;
      const section = (el.closest("[data-section]") as HTMLElement | null)?.getAttribute("data-section") || null;
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        const q = new URLSearchParams(window.location.search);
        await sb.from("traffic_events").insert({
          session_id: sid(), user_id: user?.id ?? null, path: window.location.pathname,
          kind: "click", label, section,
          utm_source: q.get("utm_source"), utm_medium: q.get("utm_medium"), utm_campaign: q.get("utm_campaign"),
        });
      } catch { /* */ }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);
  return null;
}
