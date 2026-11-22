/**
 * VSAT interviews · cron (every 10 minutes, vercel.json).
 *   1. Google: make / move / remove calendar events that are still queued (5 tries each)
 *   2. Google: read Meet attendance for interviews that ended (joined / no-show / please mark)
 *   3. Email: invite / moved / cancelled emails through the VSAT comms steps
 * Google steps are skipped until the ADMISSIONS_* env is set; emails still go (with the dashboard link).
 * Fails closed without CRON_SECRET.
 */
import { NextResponse } from "next/server";
import { checkInterviewAttendance, sendInterviewNotices, serviceDb, syncInterviews } from "@/lib/vsat/interview-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const preferredRegion = "bom1";

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const db = serviceDb();
  if (!db) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 500 });
  const t0 = Date.now();
  const out: Record<string, unknown> = { ok: true };
  // each step on its own: one failing must not stop the others
  try { out.synced = await syncInterviews(db, { limit: 25, deadline: t0 + 150_000 }); } catch (e) { out.synced = { error: String(e).slice(0, 200) }; }
  try { out.attendance = await checkInterviewAttendance(db, 20); } catch (e) { out.attendance = { error: String(e).slice(0, 200) }; }
  try { out.notified = await sendInterviewNotices(db, { limit: 50 }); } catch (e) { out.notified = { error: String(e).slice(0, 200) }; }
  return NextResponse.json(out);
}
