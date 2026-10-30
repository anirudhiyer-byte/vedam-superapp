/**
 * PeerPath · book (or reschedule) a chat — logged-in users only.
 *
 * Who is booking comes ONLY from the login (auth.uid() inside pp_book). The
 * browser sends the senior, time, type, duration, question and (for a move) the
 * old booking id; nothing else is forwarded. Name / email / phone are read from
 * the database by pp_book, never from this request.
 *
 * Order: CSRF (cookie requests) → JSON → per-IP limit → login → pp_book (as the
 * user) → Google invite. pp_book itself does the per-user limit, the VSAT gate,
 * the slot re-check and logs every attempt.
 *
 * API clients may call with `Authorization: Bearer <access token>` instead of the
 * cookie; they get exactly the same answers. A logged-in user can also call pp_book
 * straight through the Supabase API with their own token: same checks, but not this
 * route's per-IP limit (accepted by the owner — the per-user limits in the DB stay).
 */
import { NextResponse } from "next/server";
import { createClient as createTokenClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { adminDb, allowIp, syncBooking, trustedIp } from "@/lib/peerpath/meet-sync";
import { bearerToken, pickBookFields, readJsonObject, sameOrigin } from "@/lib/peerpath/book-request";
import { parseBookResult } from "@/lib/peerpath/booking-codes";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Booking attempts per visitor IP per hour (shared Wi-Fi in a school or hostel is many students). */
const BOOKINGS_PER_IP_PER_HOUR = 60;
const SYNC_WAIT_MS = 6000;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token && !sameOrigin(req)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ ok: false, code: "INVALID" }, 415);
  }
  const raw = await readJsonObject(req);
  if (!raw) return json({ ok: false, code: "INVALID" }, 400);

  // per-IP limit BEFORE the login check, so a flood of junk tokens never reaches Supabase Auth
  const ip = trustedIp(req);
  const admin = adminDb(ip);
  if (!(await allowIp(admin, "pp_book", ip, BOOKINGS_PER_IP_PER_HOUR, 3600))) {
    await admin
      .from("pp_book_attempts")
      .insert({ user_id: null, ip, code: "RATE_LIMITED", source: "route" })
      .then(() => undefined, () => undefined);
    return json({ ok: false, code: "RATE_LIMITED" }, 429);
  }

  const sb = token
    ? createTokenClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : await createCookieClient();
  const { data: auth } = token ? await sb.auth.getUser(token) : await sb.auth.getUser();
  const user = auth?.user;
  if (!user) return json({ ok: false, code: "NOT_LOGGED_IN" }, 401);

  const body = pickBookFields(raw);

  const { data, error } = await sb.rpc("pp_book", { p: body });
  if (error) return json({ ok: false, code: "SERVER" }, 500);
  const res = parseBookResult(data);
  if (!res.ok) return json(res);

  // Meet invite now; if Google is slow the cron finishes it within 15 minutes
  const done = syncBooking(admin, res.id).catch(() => {});
  if (typeof body.rescheduleOf === "string" && body.rescheduleOf) {
    const oldId = body.rescheduleOf;
    void done.then(() => syncBooking(admin, oldId).catch(() => {}));
  }
  await Promise.race([done, new Promise((r) => setTimeout(r, SYNC_WAIT_MS))]);
  return json(res);
}
