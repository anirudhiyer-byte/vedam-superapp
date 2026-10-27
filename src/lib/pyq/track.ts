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
type Queued = PyqClientEvent & { t: number };

// Same-origin, neutral path (content blockers match on words like "event" / "track").
const ENDPOINT = "/api/pyq/seen";
const QKEY = "v1_pyq_q";
const QMAX = 50;

function readQ(): Queued[] {
  try { const a = JSON.parse(localStorage.getItem(QKEY) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}
function writeQ(q: Queued[]) {
  try { if (q.length) localStorage.setItem(QKEY, JSON.stringify(q.slice(-QMAX))); else localStorage.removeItem(QKEY); } catch { /* storage unavailable */ }
}

let flushing = false;

/** Send events (oldest first). Anything that could not be delivered stays in the local queue and
 *  is retried on the next event, the next page load, or when the browser comes back online. */
async function send(events: Queued[]): Promise<boolean> {
  try {
    const u = readUtm();
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        session_id: pyqSid(), events,
        utm_source: u.utm_source, utm_medium: u.utm_medium, utm_campaign: u.utm_campaign,
      }),
    });
    return r.ok;
  } catch { return false; } // offline, or blocked by an extension
}

export async function flushPyqQueue() {
  if (flushing) return;
  const q = readQ();
  if (!q.length) return;
  flushing = true;
  try {
    // Take at most 20 per request; keep the rest. Only drop what the server accepted.
    const batch = q.slice(0, 20);
    if (await send(batch)) writeQ(readQ().filter((x) => !batch.some((b) => b.t === x.t && b.event_type === x.event_type && b.paper_id === x.paper_id && b.screen === x.screen)));
  } finally { flushing = false; }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void flushPyqQueue(); });
}

/** Fire-and-forget PYQ event (works for logged-out visitors too). Never throws, never awaited.
 *  Each event carries the browser's own timestamp so they can be ordered correctly even when
 *  they arrive out of order, and an undelivered event is kept and retried later. */
export function trackPyq(e: PyqClientEvent) {
  try {
    const ev: Queued = { ...e, t: Date.now() };
    void (async () => {
      if (await send([ev])) { void flushPyqQueue(); return; }
      writeQ([...readQ(), ev]);
    })();
  } catch { /* best effort */ }
}
