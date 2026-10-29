/**
 * PeerPath · Meet automation cron (every 15 min).
 *   1. finish calendar work left over (new / failed / pending / cancelled / moved)
 *   2. read Meet attendance for chats that ended → completed or "needs marking"
 * Does nothing until the Google env vars are set.
 */
import { NextResponse } from "next/server";
import { adminDb, checkAttendance, syncPending } from "@/lib/peerpath/meet-sync";
import { googleConfigured } from "@/lib/peerpath/google";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  // fail closed: no secret set, or mismatch → reject
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!googleConfigured()) return NextResponse.json({ ok: true, skipped: "google_not_configured" });
  const db = adminDb();
  const synced = await syncPending(db);
  const attendance = await checkAttendance(db);
  return NextResponse.json({ ok: true, synced, ...attendance });
}
