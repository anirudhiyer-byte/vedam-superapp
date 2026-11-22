/**
 * Applicant help — "I have a query". A signed-in applicant writes a question in the
 * dashboard help box; this route emails it to the helpdesk (connect@vedam.org) with
 * their details attached, so support can reply.
 *
 * Who is asking comes ONLY from the login (auth.uid()). Name / email / phone are read
 * from the database (application_manager → lead_manager), never trusted from the browser;
 * the client sends only the query text. Order mirrors /api/peerpath/book: CSRF (cookie
 * requests) → content-type → JSON → per-IP limit → login → send.
 */
import { NextResponse } from "next/server";
import { createClient as createTokenClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { bearerToken, readJsonObject, sameOrigin } from "@/lib/peerpath/book-request";
import { adminDb, allowIp, trustedIp } from "@/lib/peerpath/meet-sync";
import { deliverEmail } from "@/lib/email/deliver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;
export const preferredRegion = "bom1"; // same region as the database

const HELPDESK = "connect@vedam.org";
const QUERIES_PER_IP_PER_HOUR = 20;
const MAX_QUERY = 2000;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const str = (v: unknown) => (v == null ? "" : String(v)).trim();

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token && !sameOrigin(req)) return json({ ok: false, error: "FORBIDDEN" }, 403);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json"))
    return json({ ok: false, error: "INVALID" }, 415);

  const raw = await readJsonObject(req);
  if (!raw) return json({ ok: false, error: "INVALID" }, 400);
  const query = typeof raw.query === "string" ? raw.query.trim() : "";
  if (query.length < 1) return json({ ok: false, error: "EMPTY" }, 400);
  if (query.length > MAX_QUERY) return json({ ok: false, error: "TOO_LONG" }, 400);

  // per-IP limit BEFORE the login check, so junk never reaches Supabase Auth
  const ip = trustedIp(req);
  const admin = adminDb(ip);
  if (!(await allowIp(admin, "apply_query", ip, QUERIES_PER_IP_PER_HOUR, 3600)))
    return json({ ok: false, error: "RATE_LIMITED" }, 429);

  // who is asking — login only
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let user: { id: string; email: string | null } | null = null;
  if (token && url && anon) {
    const c = createTokenClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data } = await c.auth.getUser(token);
    user = data?.user ? { id: data.user.id, email: data.user.email ?? null } : null;
  } else {
    const c = await createCookieClient();
    const { data } = await c.auth.getUser();
    user = data?.user ? { id: data.user.id, email: data.user.email ?? null } : null;
  }
  if (!user) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);

  // details from the database, never from the client
  const [{ data: app }, { data: lead }] = await Promise.all([
    admin.from("application_manager")
      .select("registered_name, registered_email, registered_mobile, application_no")
      .eq("lead_id", user.id).maybeSingle(),
    admin.from("lead_manager")
      .select("registered_name, registered_email, registered_mobile, public_id")
      .eq("lead_id", user.id).maybeSingle(),
  ]);
  const name = str(app?.registered_name) || str(lead?.registered_name) || "—";
  const email = str(user.email) || str(app?.registered_email) || str(lead?.registered_email) || "—";
  const phone = str(app?.registered_mobile) || str(lead?.registered_mobile) || "—";
  const appNo = str(app?.application_no) || str(lead?.public_id);

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1030;max-width:560px">
      <p style="margin:0 0 14px;font-size:15px">An applicant submitted a query from the Vedam One applicant dashboard.</p>
      <table style="border-collapse:collapse;font-size:14px;margin:0 0 16px">
        <tr><td style="padding:3px 14px 3px 0;color:#6c6485">Name</td><td style="padding:3px 0;font-weight:600">${esc(name)}</td></tr>
        <tr><td style="padding:3px 14px 3px 0;color:#6c6485">Email</td><td style="padding:3px 0;font-weight:600">${esc(email)}</td></tr>
        <tr><td style="padding:3px 14px 3px 0;color:#6c6485">Phone</td><td style="padding:3px 0;font-weight:600">${esc(phone)}</td></tr>
        ${appNo ? `<tr><td style="padding:3px 14px 3px 0;color:#6c6485">Application</td><td style="padding:3px 0;font-weight:600">${esc(appNo)}</td></tr>` : ""}
      </table>
      <div style="border-left:3px solid #8a18ff;background:#f6f0ff;padding:12px 14px;border-radius:0 10px 10px 0">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#7312e0">Their query</p>
        <p style="margin:0;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(query)}</p>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#a79fbd">Reply directly to ${esc(email)}.</p>
    </div>`;

  const r = await deliverEmail({
    to: HELPDESK,
    subject: "applicant has a query",
    html,
    kind: "applicant_query",
    userId: user.id,
    refName: appNo || null,
    fromName: "Vedam One · Applicant help",
  });
  if (!r.ok && !r.skipped) return json({ ok: false, error: "SEND_FAILED" }, 502);
  return json({ ok: true });
}
