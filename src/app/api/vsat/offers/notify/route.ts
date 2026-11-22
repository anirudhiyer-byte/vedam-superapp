/**
 * VSAT offers · "send now" after admin / admissions release offers in the Counselling panel.
 *
 * The release itself already happened in the database (vsat_offers_release → the offer trigger, 0144),
 * which queued one email job per student; this only sends those emails straight away instead of waiting
 * for the cron (every 10 minutes). Safe to call twice: the database hands each job out once.
 *
 * Order: CSRF (same origin) → JSON → login → role (admin / admissions) → keep only the students this
 * person may see (the grid applies campus rules) → send.
 */
import { NextResponse } from "next/server";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { readJsonObject, sameOrigin } from "@/lib/peerpath/book-request";
import { serviceDb, siteUrl } from "@/lib/vsat/interview-sync";
import { parseIdList } from "@/lib/vsat/interviews";
import { sendOfferNotices } from "@/lib/vsat/offer-sync";
import { RELEASE_MAX } from "@/lib/vsat/offers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "bom1"; // same region as the Supabase database (Mumbai)

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return json({ ok: false, code: "INVALID" }, 415);
  const raw = await readJsonObject(req, 8192);
  const ids = raw ? parseIdList(raw.application_ids, RELEASE_MAX) : null;
  if (!ids) return json({ ok: false, code: "INVALID" }, 400);

  const sb = await createCookieClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return json({ ok: false, code: "NOT_SIGNED_IN" }, 401);
  const { data: roles } = await sb.rpc("vsat_my_roles");
  const r = roles as { admin?: boolean; roles?: string[] } | null;
  if (!r?.admin && !(r?.roles ?? []).includes("admissions")) return json({ ok: false, code: "FORBIDDEN" }, 403);

  // only students this person can see (campus rules live in the database)
  const { data: grid, error: gridErr } = await sb.rpc("vsat_grid_list", { p: { application_ids: ids, columns: [], limit: RELEASE_MAX } });
  if (gridErr) return json({ ok: false, code: "SERVER" }, 500);
  const allowed = ((grid as { rows?: { application_id: string }[] } | null)?.rows ?? []).map((x) => x.application_id);
  if (!allowed.length) return json({ ok: true, notified: null });

  const db = serviceDb();
  if (!db) return json({ ok: false, code: "SERVER" }, 500);
  try {
    const notified = await sendOfferNotices(db, { ids: allowed, limit: RELEASE_MAX, site: siteUrl() });
    return json({ ok: true, notified });
  } catch {
    // the jobs stay queued; the cron picks them up
    return json({ ok: false, code: "SERVER" }, 500);
  }
}
