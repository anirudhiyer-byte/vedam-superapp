/**
 * PeerPath · book (or reschedule) a chat.
 *
 * Bookings go through this server route — not straight from the browser to the
 * database — because each booking now sends real Google Calendar invites:
 *   - the per-IP limit uses Vercel's trusted visitor IP (can't be faked), and
 *   - the calendar invite + Meet link are created right here, server-side, so
 *     there is no public "sync" endpoint for anyone to poke.
 * pp_book itself is no longer callable by anon/authenticated (migration 0030).
 */
import { NextResponse } from "next/server";
import { adminDb, allowIp, syncBooking, trustedIp } from "@/lib/peerpath/meet-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BOOKINGS_PER_IP_PER_HOUR = 10;
const SYNC_WAIT_MS = 6000;

export async function POST(req: Request) {
  let p: Record<string, unknown>;
  try {
    p = (await req.json()) as Record<string, unknown>;
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("bad body");
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  // only the fields pp_book knows; nothing else from the browser goes to the DB
  const body = {
    seniorId: p.seniorId,
    start: p.start,
    type: p.type,
    duration: p.duration,
    name: p.name,
    email: p.email,
    phone: p.phone,
    question: p.question ?? null,
    rescheduleOf: p.rescheduleOf ?? null,
  };

  const ip = trustedIp(req);
  const db = adminDb(ip);
  if (!(await allowIp(db, "pp_book_route", ip, BOOKINGS_PER_IP_PER_HOUR, 3600))) {
    return NextResponse.json({ ok: false, error: "rate_limited" });
  }

  const { data, error } = await db.rpc("pp_book", { p: body });
  if (error || !data) return NextResponse.json({ ok: false, error: "server" });
  const res = data as { ok: boolean; id?: string; error?: string };
  if (!res.ok || !res.id) return NextResponse.json({ ok: false, error: res.error ?? "server" });

  // invite + Meet link now; if Google is slow the cron finishes it within 15 min
  const done = syncBooking(db, res.id).catch(() => {});
  if (body.rescheduleOf && typeof body.rescheduleOf === "string") {
    void done.then(() => syncBooking(db, body.rescheduleOf as string).catch(() => {}));
  }
  await Promise.race([done, new Promise((r) => setTimeout(r, SYNC_WAIT_MS))]);

  return NextResponse.json({ ok: true, id: res.id });
}
