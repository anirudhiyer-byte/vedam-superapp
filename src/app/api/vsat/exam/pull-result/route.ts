/**
 * VSAT exam · admin pull-result — an admin fetches a candidate's result straight
 * from Wheebox (the fallback to the callback ingest).
 *
 * Admin-only (is_admin, or a confirmed @vedam.org login). Body:
 *   { applicationId: string, kind?: "mock" | "exam" }
 * Resolves the login id + test id + exam date, calls the Wheebox result API, and
 * stores it exactly like the callback does (mock → student-visible; main VSAT →
 * admin-only columns + ledger; never vps_score).
 *
 * The Wheebox result API keys the lookup by domain + test NAME + date. Those come
 * from env (WHEEBOX_DOMAIN_NAME / WHEEBOX_TEST_NAME) when set; otherwise the test
 * id is used as the test name — confirm against a real result sample on first use.
 */
import { NextResponse } from "next/server";
import { createClient as createTokenClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { adminDb } from "@/lib/peerpath/meet-sync";
import { bearerToken, sameOrigin, readJsonObject } from "@/lib/peerpath/book-request";
import { wheeboxCreds } from "@/lib/wheebox/crypto";
import { fetchResult } from "@/lib/wheebox/api";
import { parseWheeboxResult, studentMockResult } from "@/lib/wheebox/exam";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const preferredRegion = "bom1";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token && !sameOrigin(req)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  const raw = (await readJsonObject(req)) ?? {};
  const applicationId = typeof raw.applicationId === "string" ? raw.applicationId.trim() : "";
  const kind = raw.kind === "mock" ? "mock" : "exam";
  if (!applicationId) return json({ ok: false, code: "INVALID" }, 400);

  // ── admin only ─────────────────────────────────────────────────────────────
  const sb = token
    ? createTokenClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : await createCookieClient();
  const { data: authData } = token ? await sb.auth.getUser(token) : await sb.auth.getUser();
  const user = authData?.user;
  if (!user) return json({ ok: false, code: "NOT_LOGGED_IN" }, 401);
  let isAdmin = (user.email ?? "").toLowerCase().endsWith("@vedam.org") && !!user.email_confirmed_at;
  if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  if (!isAdmin) return json({ ok: false, code: "FORBIDDEN" }, 403);

  const creds = wheeboxCreds();
  if (!creds) return json({ ok: false, code: "WHEEBOX_NOT_CONFIGURED" }, 503);

  const admin = adminDb();
  const { data: app } = await admin
    .from("application_manager")
    .select("lead_id, application_id, wheebox_login_id, exam_date_id")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (!app?.application_id) return json({ ok: false, code: "NOT_FOUND" }, 404);

  const { data: settings } = await admin.from("vsat_exam_settings").select("mock_test_id, osr_format").eq("id", 1).maybeSingle();
  const osr = (settings?.osr_format || "o").toString();

  // Resolve test id + exam date.
  let testId: string | null = null;
  let examDate = new Date();
  if (kind === "mock") {
    testId = settings?.mock_test_id ? String(settings.mock_test_id) : null;
  } else if (app.exam_date_id) {
    const { data: d } = await admin.from("vsat_exam_dates").select("wheebox_test_id, exam_date").eq("id", app.exam_date_id).maybeSingle();
    if (d?.wheebox_test_id) { testId = String(d.wheebox_test_id); if (d.exam_date) examDate = new Date(d.exam_date); }
  }
  if (!testId) return json({ ok: false, code: kind === "mock" ? "MOCK_NOT_CONFIGURED" : "NO_SLOT" }, 409);

  const loginId = app.wheebox_login_id || app.application_id;
  const domainName = process.env.WHEEBOX_DOMAIN_NAME || creds.companyCode;
  const testName = process.env.WHEEBOX_TEST_NAME || testId;

  try {
    const result = await fetchResult({ domainName, testName, loginId, osr, dateOfExam: ymd(examDate) }, creds);
    const parsed = parseWheeboxResult(result);
    const isMock = kind === "mock";

    await admin.from("vsat_exam_results").insert({
      application_id: app.application_id,
      lead_id: app.lead_id,
      wheebox_test_id: testId,
      is_mock: isMock,
      overall_result: parsed.overall,
      obtained_marks: parsed.obtainedMarks,
      max_marks: parsed.maxMarks,
      percentile: parsed.percentile,
      sections: parsed.sections,
      raw: (result && typeof result === "object" ? result : { raw: String(result) }) as Record<string, unknown>,
    });

    if (isMock) {
      await admin.from("application_manager").update({ mock_given: true, mock_result: studentMockResult(parsed) }).eq("lead_id", app.lead_id);
    } else {
      await admin.from("application_manager").update({
        exam_given: true,
        exam_overall: parsed.overall,
        exam_obtained_marks: parsed.obtainedMarks,
        exam_max_marks: parsed.maxMarks,
        exam_percentile: parsed.percentile,
        exam_sections: parsed.sections,
      }).eq("lead_id", app.lead_id);
    }

    return json({ ok: true, parsed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "WHEEBOX_ERROR";
    return json({ ok: false, code: msg === "WHEEBOX_NOT_CONFIGURED" ? msg : "WHEEBOX_ERROR" }, 502);
  }
}
