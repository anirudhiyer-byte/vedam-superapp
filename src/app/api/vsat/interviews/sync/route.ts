/**
 * VSAT interviews · "sync now" after admin / admissions save a schedule, move or cancel.
 *
 * The save itself already happened in the database (vsat_assign_interview etc.); this only runs
 * the queued Google + email work for those students straight away instead of waiting for the
 * cron (every 10 minutes). Safe to call twice: the database hands each job out once.
 *
 * Order: CSRF (same origin) → JSON → login → role (admin / admissions) → keep only the students
 * this person may see (the grid applies campus rules) → Google, then emails, with a time budget.
 */
import { NextResponse } from "next/server";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { readJsonObject, sameOrigin } from "@/lib/peerpath/book-request";
import { sendInterviewNotices, serviceDb, syncInterviews } from "@/lib/vsat/interview-sync";
import { parseIdList } from "@/lib/vsat/interviews";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "bom1"; // same region as the Supabase database (Mumbai)

const MAX_IDS = 50;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return json({ ok: false, code: "INVALID" }, 415);
  const raw = await readJsonObject(req, 8192);
  const ids = raw ? parseIdList(raw.application_ids, MAX_IDS) : null;
  if (!ids) return json({ ok: false, code: "INVALID" }, 400);

  const sb = await createCookieClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return json({ ok: false, code: "NOT_SIGNED_IN" }, 401);
  const { data: roles } = await sb.rpc("vsat_my_roles");
  const r = roles as { admin?: boolean; roles?: string[] } | null;
  if (!r?.admin && !(r?.roles ?? []).includes("admissions")) return json({ ok: false, code: "FORBIDDEN" }, 403);

  // only students this person can see (campus rules live in the database)
  const { data: grid, error: gridErr } = await sb.rpc("vsat_grid_list", { p: { application_ids: ids, columns: [], limit: MAX_IDS } });
  if (gridErr) return json({ ok: false, code: "SERVER" }, 500);
  const allowed = ((grid as { rows?: { application_id: string }[] } | null)?.rows ?? []).map((x) => x.application_id);
  if (!allowed.length) return json({ ok: true, synced: null, notified: null });

  const db = serviceDb();
  if (!db) return json({ ok: false, code: "SERVER" }, 500);
  try {
    const synced = await syncInterviews(db, { ids: allowed, limit: allowed.length, deadline: Date.now() + 25_000 });
    const notified = await sendInterviewNotices(db, { ids: allowed, limit: MAX_IDS });
    return json({ ok: true, synced, notified });
  } catch {
    // the work stays queued; the cron picks it up
    return json({ ok: false, code: "SERVER" }, 500);
  }
}
