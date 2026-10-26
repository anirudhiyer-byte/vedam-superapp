"use client";
import { readUtm } from "@/lib/utm";

/** Same browser-session id the site-wide TrafficTracker uses (localStorage `v1_sid`). */
export function pyqSid(): string {
  try {
    let s = localStorage.getItem("v1_sid");
    if (!s) { s = crypto.randomUUID?.() ?? String(Math.random()).slice(2); localStorage.setItem("v1_sid", s); }
    return s;
  } catch { return "anon"; }
}

export type PyqClientEvent = {
  event_type: "screen_view" | "exam_select" | "paper_select";
  screen?: "landing" | "register" | "dashboard" | "picker" | "test" | "result";
  exam?: string;
  paper_id?: string;
  attempt_id?: string;
  meta?: Record<string, string>;
};

/** Fire-and-forget PYQ event (works for logged-out visitors too). Never throws, never awaited. */
export function trackPyq(e: PyqClientEvent) {
  try {
    const u = readUtm();
    void fetch("/api/pyq/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        ...e, session_id: pyqSid(),
        utm_source: u.utm_source, utm_medium: u.utm_medium, utm_campaign: u.utm_campaign,
      }),
    }).catch(() => {});
  } catch { /* best effort */ }
}
