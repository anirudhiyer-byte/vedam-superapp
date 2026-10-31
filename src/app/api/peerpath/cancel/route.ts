/**
 * PeerPath · cancel a chat, then take it off both calendars.
 *
 * Ownership is checked inside pp_cancel from the login (auth.uid()); this route
 * calls it as the user. CSRF guard on cookie requests, per-IP limit with the
 * trusted visitor IP, and no database error text ever reaches the browser.
 */
import { NextResponse } from "next/server";
import { createClient as createTokenClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { adminDb, allowIp, syncBooking, trustedIp } from "@/lib/peerpath/meet-sync";
import { bearerToken, readJsonObject, sameOrigin } from "@/lib/peerpath/book-request";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const preferredRegion = "bom1"; // same region as the Supabase database (ap-south-1, Mumbai)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANCELS_PER_IP_PER_15MIN = 20;
const SYNC_WAIT_MS = 4000;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token && !sameOrigin(req)) return json({ ok: false, error: "forbidden" }, 403);
  const raw = await readJsonObject(req);
  const id = raw?.id;
  if (typeof id !== "string" || !UUID.test(id)) return json({ ok: false, error: "invalid" }, 400);

  // per-IP limit before the login check (junk tokens never reach Supabase Auth)
  const ip = trustedIp(req);
  const admin = adminDb(ip);
  if (!(await allowIp(admin, "pp_cancel", ip, CANCELS_PER_IP_PER_15MIN, 900))) {
    return json({ ok: false, error: "rate_limited" });
  }

  const sb = token
    ? createTokenClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : await createCookieClient();
  const { data: auth } = token ? await sb.auth.getUser(token) : await sb.auth.getUser();
  if (!auth?.user) return json({ ok: false, error: "not_logged_in" }, 401);

  const { data, error } = await sb.rpc("pp_cancel", { p_id: id });
  if (error || !data || typeof data !== "object") return json({ ok: false, error: "server" });
  const res = data as { ok?: unknown; error?: unknown };
  if (res.ok !== true) return json({ ok: false, error: typeof res.error === "string" ? res.error : "server" });

  await Promise.race([syncBooking(admin, id).catch(() => {}), new Promise((r) => setTimeout(r, SYNC_WAIT_MS))]);
  return json({ ok: true });
}
