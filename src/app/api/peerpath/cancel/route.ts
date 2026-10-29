/**
 * PeerPath · cancel a chat, then take it off both calendars.
 *
 * Ownership is still proven inside pp_cancel (applicant email + phone, read here
 * from the device's proof cookie — the browser can't pass someone else's).
 * The per-IP limit uses Vercel's trusted visitor IP.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminDb, allowIp, syncBooking, trustedIp } from "@/lib/peerpath/meet-sync";
import { PROOF_COOKIE, decodeProof } from "@/lib/peerpath/proof";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANCELS_PER_IP_PER_15MIN = 20;
const SYNC_WAIT_MS = 4000;

export async function POST(req: Request) {
  let id: unknown;
  try {
    ({ id } = (await req.json()) as { id?: unknown });
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  if (typeof id !== "string" || !UUID.test(id)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const proof = decodeProof((await cookies()).get(PROOF_COOKIE)?.value);
  const ip = trustedIp(req);
  const db = adminDb(ip);
  if (!(await allowIp(db, "pp_cancel_route", ip, CANCELS_PER_IP_PER_15MIN, 900))) {
    return NextResponse.json({ ok: false, error: "rate_limited" });
  }

  const { data, error } = await db.rpc("pp_cancel", { p_id: id, p_email: proof?.email ?? "", p_phone: proof?.phone ?? "" });
  if (error || !data) return NextResponse.json({ ok: false, error: "server" });
  const res = data as { ok: boolean; error?: string };
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error ?? "server" });

  await Promise.race([syncBooking(db, id).catch(() => {}), new Promise((r) => setTimeout(r, SYNC_WAIT_MS))]);
  return NextResponse.json({ ok: true });
}
