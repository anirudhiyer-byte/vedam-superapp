/**
 * VSAT exam · launch — returns the Wheebox URL to open for this logged-in
 * applicant's MOCK or main VSAT test.
 *
 * Who is launching comes ONLY from the login (auth.uid()). The browser sends just
 * { kind: "mock" | "exam" }; name/email/test-id/window are read from the database.
 *
 * Flow (server-side, service role, Wheebox creds from env):
 *   login → load application + eligibility → resolve test id + window
 *   → register on Wheebox (once) → assign the test for the window
 *   → get the test link → (if the link needs a login) authenticate + verify token
 *   → return the launchable URL.
 *
 * The sandbox cannot egress to wheebox.com, so the Wheebox calls only succeed from
 * a deployed environment; here they return a WHEEBOX_* error code the UI surfaces.
 */
import { NextResponse } from "next/server";
import { createClient as createTokenClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { adminDb } from "@/lib/peerpath/meet-sync";
import { bearerToken, sameOrigin, readJsonObject } from "@/lib/peerpath/book-request";
import { wheeboxCreds } from "@/lib/wheebox/crypto";
import { registerCandidate, assignTest, getTestLink, authenticate, verifyTokenUrl, toWheeboxDate, type RegisterInput } from "@/lib/wheebox/api";
import { extractLaunchUrl, extractAuthToken, isWheeboxOk } from "@/lib/wheebox/exam";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const preferredRegion = "bom1";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** A generous mock window: openable now, valid for 2 days. */
const MOCK_WINDOW_MS = 2 * 24 * 3600 * 1000;

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token && !sameOrigin(req)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  const raw = (await readJsonObject(req)) ?? {};
  const kind = raw.kind === "mock" ? "mock" : raw.kind === "exam" ? "exam" : null;
  if (!kind) return json({ ok: false, code: "INVALID" }, 400);

  // ── who ──────────────────────────────────────────────────────────────────
  const sb = token
    ? createTokenClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : await createCookieClient();
  const { data: authData } = token ? await sb.auth.getUser(token) : await sb.auth.getUser();
  const user = authData?.user;
  if (!user) return json({ ok: false, code: "NOT_LOGGED_IN" }, 401);
  const isAdminEmail = (user.email ?? "").toLowerCase().endsWith("@vedam.org") && !!user.email_confirmed_at;

  const creds = wheeboxCreds();
  if (!creds) return json({ ok: false, code: "WHEEBOX_NOT_CONFIGURED" }, 503);

  const admin = adminDb();

  // ── application + eligibility ──────────────────────────────────────────────
  const { data: app } = await admin
    .from("application_manager")
    .select("application_id, registered_name, registered_email, gender, state, city, country, wheebox_login_id, wheebox_registered, exam_date_id, application_stage_1, mock_given")
    .eq("lead_id", user.id)
    .maybeSingle();
  if (!app?.application_id) return json({ ok: false, code: "NOT_AN_APPLICANT" }, 403);

  if (!isAdminEmail) {
    const { data: paid } = await admin.from("vsat_payments").select("lead_id").eq("lead_id", user.id).maybeSingle();
    if (!paid) return json({ ok: false, code: "NOT_PAID" }, 403);
  }

  // ── settings (mock test id + OSR) ──────────────────────────────────────────
  const { data: settings } = await admin.from("vsat_exam_settings").select("mock_test_id, osr_format").eq("id", 1).maybeSingle();
  const osr = (settings?.osr_format || "o").toString();

  // ── resolve test id + window ───────────────────────────────────────────────
  let testId: string;
  let startAt: string;
  let endAt: string;
  if (kind === "mock") {
    if (app.mock_given === true) return json({ ok: false, code: "MOCK_ALREADY_DONE" }, 409);
    if (!settings?.mock_test_id) return json({ ok: false, code: "MOCK_NOT_CONFIGURED" }, 409);
    testId = String(settings.mock_test_id);
    const now = Date.now();
    startAt = new Date(now - 2 * 60 * 1000).toISOString();
    endAt = new Date(now + MOCK_WINDOW_MS).toISOString();
  } else {
    if (app.application_stage_1 !== "slot_selected" || !app.exam_date_id) return json({ ok: false, code: "NO_SLOT" }, 409);
    const { data: date } = await admin
      .from("vsat_exam_dates")
      .select("wheebox_test_id, start_at, end_at, clickable_lead_minutes, enabled")
      .eq("id", app.exam_date_id)
      .maybeSingle();
    if (!date?.wheebox_test_id) return json({ ok: false, code: "DATE_UNAVAILABLE" }, 409);
    const now = Date.now();
    const openFrom = new Date(date.start_at).getTime() - (date.clickable_lead_minutes ?? 15) * 60 * 1000;
    const closeAt = new Date(date.end_at).getTime();
    if (now < openFrom) return json({ ok: false, code: "NOT_IN_WINDOW" }, 409);
    if (now > closeAt) return json({ ok: false, code: "WINDOW_CLOSED" }, 409);
    testId = String(date.wheebox_test_id);
    startAt = new Date(date.start_at).toISOString();
    endAt = new Date(date.end_at).toISOString();
  }

  const loginId = app.wheebox_login_id || app.application_id;

  try {
    // ── register once ────────────────────────────────────────────────────────
    if (!app.wheebox_registered) {
      const name = (app.registered_name || "").trim();
      const sp = name.indexOf(" ");
      const input: RegisterInput = {
        loginId,
        firstName: sp > 0 ? name.slice(0, sp) : name || app.application_id,
        lastName: sp > 0 ? name.slice(sp + 1) : undefined,
        emailId: app.registered_email || undefined,
        state: app.state || undefined,
        city: app.city || undefined,
        country: app.country || "India",
        gender: app.gender || undefined,
        regNO: app.application_id,
      };
      const reg = await registerCandidate(input, creds);
      if (!isWheeboxOk(reg)) return json({ ok: false, code: "WHEEBOX_REGISTER_FAILED", detail: reg }, 502);
      await admin.from("application_manager").update({ wheebox_login_id: loginId, wheebox_registered: true }).eq("lead_id", user.id);
    }

    // ── assign the test for its window ─────────────────────────────────────────
    const assignRes = await assignTest(loginId, { [testId]: { startDate: toWheeboxDate(startAt), endDate: toWheeboxDate(endAt) } }, creds);
    if (!isWheeboxOk(assignRes)) return json({ ok: false, code: "WHEEBOX_ASSIGN_FAILED", detail: assignRes }, 502);
    await admin
      .from("application_manager")
      .update(kind === "mock" ? { mock_assigned: true } : { exam_assigned: true })
      .eq("lead_id", user.id);

    // ── get the launch link ────────────────────────────────────────────────────
    const linkRes = await getTestLink(testId, loginId, osr, creds);
    let url = extractLaunchUrl(linkRes);

    // ── if the link needs a login, authenticate + verify token ─────────────────
    if (!url) {
      const t = extractAuthToken(linkRes);
      if (t) {
        const authRes = await authenticate(loginId, t, creds);
        const vt = extractAuthToken(authRes) ?? t;
        url = verifyTokenUrl(creds, vt);
      }
    }
    if (!url) return json({ ok: false, code: "WHEEBOX_NO_LINK", detail: linkRes }, 502);

    return json({ ok: true, url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "WHEEBOX_ERROR";
    return json({ ok: false, code: msg === "WHEEBOX_NOT_CONFIGURED" ? msg : "WHEEBOX_ERROR" }, 502);
  }
}
