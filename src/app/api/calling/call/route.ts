/**
 * Calling CRM · place a click-to-call to a lead (callers + admins only).
 *
 * Who is calling and which lead comes ONLY from the login + calling_telecmi_prepare
 * (migration 0147), which checks the caller role and that the lead is assigned to them.
 * The TeleCMI app secret lives in the environment and never leaves this route; the
 * browser only sends { lead_id }.
 *
 * Order: CSRF (cookie requests) → JSON → per-IP limit → login → prepare (as the user,
 * also enforces the telecmi_enabled flag + agent mapping) → TeleCMI click2call with the
 * env secret → log the attempt (as the user). The caller's own phone (followme, 'mobile')
 * or browser softphone ('softphone', webrtc) rings first, then the lead is dialled.
 *
 * API clients may use `Authorization: Bearer <token>` instead of the cookie; same checks.
 */
import { NextResponse } from "next/server";
import { createClient as createTokenClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { adminDb, allowIp, trustedIp } from "@/lib/peerpath/meet-sync";
import { bearerToken, readJsonObject, sameOrigin } from "@/lib/peerpath/book-request";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const preferredRegion = "bom1";

/** Calls per caller IP per hour — a busy intern dials a lot; a shared office line is many interns. */
const CALLS_PER_IP_PER_HOUR = 400;
const CLICK2CALL_URL = "https://rest.telecmi.com/v2/webrtc/click2call";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

type Prepare = { ok: boolean; error?: string; lead_id?: string; to?: string; telecmi_user_id?: string; call_mode?: string; callerid?: string | null };

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token && !sameOrigin(req)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ ok: false, code: "INVALID" }, 415);
  }
  const raw = await readJsonObject(req);
  if (!raw) return json({ ok: false, code: "INVALID" }, 400);
  const leadId = typeof raw.lead_id === "string" ? raw.lead_id : "";
  if (!leadId) return json({ ok: false, code: "INVALID" }, 400);

  const ip = trustedIp(req);
  const admin = adminDb(ip);
  if (!(await allowIp(admin, "calling_call", ip, CALLS_PER_IP_PER_HOUR, 3600))) {
    return json({ ok: false, code: "RATE_LIMITED" }, 429);
  }

  const secret = process.env.TELECMI_SECRET;
  if (!secret) return json({ ok: false, code: "NOT_CONFIGURED" }, 503);

  const sb = token
    ? createTokenClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : await createCookieClient();
  const { data: auth } = token ? await sb.auth.getUser(token) : await sb.auth.getUser();
  if (!auth?.user) return json({ ok: false, code: "NOT_LOGGED_IN" }, 401);

  // Authorise + fetch call params (role, assignment, flag and agent mapping all checked here).
  const { data: prepData, error: prepErr } = await sb.rpc("calling_telecmi_prepare", { p: { lead_id: leadId } });
  if (prepErr) return json({ ok: false, code: "FORBIDDEN" }, 403);
  const prep = (prepData ?? {}) as Prepare;
  if (!prep.ok) return json({ ok: false, code: prep.error ?? "ERROR" }, prep.error === "disabled" ? 503 : 400);

  const softphone = prep.call_mode === "softphone";
  const body: Record<string, unknown> = {
    user_id: prep.telecmi_user_id,
    secret,
    to: Number(prep.to),
    webrtc: softphone,       // softphone → ring the browser softphone; mobile → ring the phone
    followme: !softphone,
    extra_params: { crm: true, lead_id: prep.lead_id },
  };
  const cid = prep.callerid ?? process.env.TELECMI_CALLERID;
  if (cid && /^[0-9]{6,15}$/.test(String(cid))) body.callerid = Number(cid);

  let tele: { code?: number; msg?: string; request_id?: string };
  try {
    const r = await fetch(CLICK2CALL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    tele = (await r.json().catch(() => ({}))) as typeof tele;
  } catch {
    return json({ ok: false, code: "TELEPHONY_UNREACHABLE" }, 502);
  }
  if (tele.code !== 200) return json({ ok: false, code: "TELEPHONY_REJECTED", detail: tele.msg ?? null }, 502);

  // Log the placed attempt (bumps the lead's call_count / last_called_at). Non-fatal.
  await sb.rpc("calling_telecmi_log_attempt", { p: { lead_id: prep.lead_id, request_id: tele.request_id ?? null, to: prep.to } })
    .then(() => undefined, () => undefined);

  return json({ ok: true, mode: softphone ? "softphone" : "mobile", request_id: tele.request_id ?? null });
}
