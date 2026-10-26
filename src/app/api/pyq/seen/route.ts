import { NextResponse } from "next/server";
import { createClient as createServer } from "@/lib/supabase/server";
import { svc } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Events the browser may report. Attempt milestones (started / submitted / result revealed)
 *  are NOT accepted here — the database records those itself, so they cannot be faked. */
const CLIENT_EVENTS = new Set(["screen_view", "exam_select", "paper_select"]);
const SCREENS = new Set(["landing", "register", "dashboard", "picker", "test", "result"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXAM = /^[\w .\-]{1,40}$/;

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

/** POST /api/pyq/event  { event_type, session_id, screen?, exam?, paper_id?, attempt_id?, meta?, utm_* }
 *  Public (logged-out visitors are tracked too). The user id is taken from the sign-in cookie,
 *  never from the body. Always answers 204 so tracking can never disturb the page. */
export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => null);
    if (!b || typeof b !== "object") return new NextResponse(null, { status: 204 });
    const eventType = b.event_type as string;
    if (!CLIENT_EVENTS.has(eventType)) return new NextResponse(null, { status: 204 });

    const screen = typeof b.screen === "string" && SCREENS.has(b.screen) ? b.screen : null;
    const exam = typeof b.exam === "string" && EXAM.test(b.exam) ? b.exam : null;

    // Small, flat, string-only meta (e.g. where a register screen was headed next).
    const meta: Record<string, string> = {};
    if (b.meta && typeof b.meta === "object") {
      for (const [k, v] of Object.entries(b.meta as Record<string, unknown>).slice(0, 6)) {
        if (/^[a-z_]{1,24}$/.test(k) && typeof v === "string") meta[k] = v.slice(0, 300);
      }
    }

    // Who is it? If the sign-in check fails for any reason (stale cookie right after a logout, etc.),
    // still save the event as a logged-out visit instead of dropping it.
    let userId: string | null = null;
    try {
      const sb = await createServer();
      const { data } = await sb.auth.getUser();
      userId = data?.user?.id ?? null;
    } catch (e) {
      console.error("[pyq/event] auth check failed, saving as logged-out:", (e as Error).message);
    }

    const { error } = await svc().from("pyq_events").insert({
      session_id: str(b.session_id, 64),
      user_id: userId,
      event_type: eventType,
      screen,
      exam,
      paper_id: uuid(b.paper_id),
      attempt_id: uuid(b.attempt_id),
      meta,
      utm_source: str(b.utm_source, 100),
      utm_medium: str(b.utm_medium, 100),
      utm_campaign: str(b.utm_campaign, 150),
    });
    if (error) console.error("[pyq/event] insert failed:", error.message);
  } catch (e) { console.error("[pyq/event] failed:", (e as Error).message); }
  return new NextResponse(null, { status: 204 });
}
