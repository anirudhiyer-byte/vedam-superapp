/**
 * VSAT · the Acceptance Letter PDF (offer-letter-pdf.ts), drawn on request, never stored.
 *
 *   GET /api/vsat/offer-letter                     the signed-in student's own current offer
 *   GET /api/vsat/offer-letter?application_id=…    admin / admissions, a released offer on a campus they manage
 *
 * Who may see what is decided in the database (vsat_offer_letter, migration 0156): the route only passes the
 * request on as the signed-in user and draws what comes back. Read-only, so no CSRF check is needed.
 */
import { NextResponse } from "next/server";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { campusKey, letterFileName, offerDays } from "@/lib/vsat/offer-letter";
import { buildOfferLetterPdf } from "@/lib/vsat/offer-letter-pdf";
import { siteUrl } from "@/lib/vsat/interview-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const preferredRegion = "bom1"; // same region as the Supabase database (Mumbai)

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

type LetterData = {
  available: boolean; reason?: string;
  name?: string | null; campus?: string | null; scholarship_pct?: number | string | null;
  programme_fee?: number | string | null; offer_days?: number | null; seat_block?: string | number | null;
  released_at?: string | null; expires_at?: string | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const appId = url.searchParams.get("application_id");
  if (appId !== null && !/^[A-Za-z0-9._:-]{1,80}$/.test(appId)) return json({ ok: false, code: "INVALID" }, 400);

  const sb = await createCookieClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return json({ ok: false, code: "NOT_SIGNED_IN" }, 401);

  const { data, error } = await sb.rpc("vsat_offer_letter", { p: appId ? { application_id: appId } : {} });
  if (error) {
    const code = /FORBIDDEN/.test(error.message) ? "FORBIDDEN" : /NOT_FOUND/.test(error.message) ? "NOT_FOUND" : "SERVER";
    return json({ ok: false, code }, code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 500);
  }
  const d = (data ?? { available: false }) as LetterData;
  const campus = campusKey(d.campus);
  if (!d.available || !campus) return json({ ok: false, code: d.reason ?? "NO_OFFER" }, 404);

  try {
    const pdf = await buildOfferLetterPdf({
      name: (d.name ?? "").trim() || "Student",
      campus,
      pct: d.scholarship_pct,
      programmeFee: d.programme_fee,
      seatBlock: d.seat_block ?? 50000,
      days: offerDays(d.released_at, d.expires_at, d.offer_days ?? 5),
      dashboardLink: `${siteUrl()}/apply/dashboard`,
    });
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${url.searchParams.get("view") === "1" ? "inline" : "attachment"}; filename="${letterFileName(d.name)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return json({ ok: false, code: "SERVER" }, 500);
  }
}
