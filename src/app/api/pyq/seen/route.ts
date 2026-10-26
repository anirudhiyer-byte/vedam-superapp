import { NextResponse } from "next/server";
import { createClient as createServer } from "@/lib/supabase/server";
import { svc } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NOTE: the path is deliberately neutral ("seen", not "event"/"track"/"analytics") — content
// blockers match on words like those. It is also same-origin, so it is not a third-party tracker.

/** Events the browser may report. Attempt milestones (started / submitted / result revealed)
 *  are NOT accepted here — the database records those itself, so they cannot be faked. */
const CLIENT_EVENTS = new Set(["screen_view", "exam_select", "paper_select"]);
const SCREENS = new Set(["landing", "register", "dashboard", "picker", "test", "result"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXAM = /^[\w .\-]{1,40}$/;
const MAX_BATCH = 20;
const MAX_PER_MINUTE = 60; // per browser session, per server instance (best effort)

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

/** Cheap in-memory limiter. Serverless instances do not share memory, so this only stops a
 *  single noisy client hammering one instance; it is a guard rail, not a hard cap. */
const hits = new Map<string, { n: number; reset: number }>();
function allow(sessionId: string, count: number): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const h = hits.get(sessionId);
  if (!h || h.reset < now) { hits.set(sessionId, { n: count, reset: now + 60_000 }); return true; }
  h.n += count;
  return h.n <= MAX_PER_MINUTE;
}

/** The browser's own clock is used for ordering (events are sent separately and can arrive out of
 *  order), but only when it is believable: at most 10 min in the past or 1 min in the future. */
function when(t: unknown): string {
  const now = Date.now();
  const n = typeof t === "number" && Number.isFinite(t) ? t : now;
  return new Date(n < now - 600_000 || n > now + 60_000 ? now : n).toISOString();
}

/** POST /api/pyq/seen  { session_id, utm_*, events: [{ event_type, t, screen?, exam?, paper_id?, attempt_id?, meta? }] }
 *  Public (logged-out visitors are tracked too). The user id is taken from the sign-in cookie,
 *  never from the body. Always answers 204 so tracking can never disturb the page. */
export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => null);
    if (!b || typeof b !== "object" || !Array.isArray(b.events)) return new NextResponse(null, { status: 204 });

    const sessionId = str(b.session_id, 64);
    const incoming = (b.events as unknown[]).slice(0, MAX_BATCH);
    if (!sessionId || !incoming.length || !allow(sessionId, incoming.length)) return new NextResponse(null, { status: 204 });

    // Who is it? If the sign-in check fails for any reason (stale cookie right after a logout, etc.),
    // still save the events as a logged-out visit instead of dropping them.
    let userId: string | null = null;
    try {
      const sb = await createServer();
      const { data } = await sb.auth.getUser();
      userId = data?.user?.id ?? null;
    } catch (e) {
      console.error("[pyq/seen] auth check failed, saving as logged-out:", (e as Error).message);
    }

    const rows = [];
    for (const raw of incoming) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as Record<string, unknown>;
      if (typeof e.event_type !== "string" || !CLIENT_EVENTS.has(e.event_type)) continue;

      // Small, flat, string-only meta (e.g. where a register screen was headed next).
      const meta: Record<string, string> = {};
      if (e.meta && typeof e.meta === "object") {
        for (const [k, v] of Object.entries(e.meta as Record<string, unknown>).slice(0, 6)) {
          if (/^[a-z_]{1,24}$/.test(k) && typeof v === "string") meta[k] = v.slice(0, 300);
        }
      }
      rows.push({
        created_at: when(e.t),
        session_id: sessionId,
        user_id: userId,
        event_type: e.event_type,
        screen: typeof e.screen === "string" && SCREENS.has(e.screen) ? e.screen : null,
        exam: typeof e.exam === "string" && EXAM.test(e.exam) ? e.exam : null,
        paper_id: uuid(e.paper_id),
        attempt_id: uuid(e.attempt_id),
        meta,
        utm_source: str(b.utm_source, 100),
        utm_medium: str(b.utm_medium, 100),
        utm_campaign: str(b.utm_campaign, 150),
      });
    }
    if (rows.length) {
      const { error } = await svc().from("pyq_events").insert(rows);
      if (error) console.error("[pyq/seen] insert failed:", error.message);
    }
  } catch (e) { console.error("[pyq/seen] failed:", (e as Error).message); }
  return new NextResponse(null, { status: 204 });
}
