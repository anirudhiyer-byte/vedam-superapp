/**
 * VSAT exam · admin BULK pull-result — fetch every student's result for one VSAT date
 * straight from Wheebox and store it, mapped to each student (application_id / lead_id).
 *
 * Admin-only (is_admin, or a confirmed @vedam.org login). Body: { exam_date_id: uuid, kind?: "exam" | "mock" }.
 * Scoped by exam date either way: the cohort is everyone assigned to that VSAT date. For "exam" it
 * pulls the date's real test; for "mock" it pulls the single configured mock test (vsat_exam_settings.
 * mock_test_id) for that same cohort, anchored to the date's exam_date. Pulls only students that don't
 * already have a stored result for that test, so it is idempotent and RESUMABLE — re-run until
 * remaining = 0; each run processes up to BATCH students to stay within the limit.
 *
 * Mirrors /api/vsat/exam/pull-result's storage: vsat_exam_results (+ application_manager exam_* columns
 * for the real VSAT, or mock_* columns for the mock). Never vps_score.
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
export const maxDuration = 60;
export const preferredRegion = "bom1";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const BATCH = 40; // students per call; re-run to continue

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token && !sameOrigin(req)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  const raw = (await readJsonObject(req)) ?? {};
  const examDateId = typeof raw.exam_date_id === "string" ? raw.exam_date_id.trim() : "";
  const kind = raw.kind === "mock" ? "mock" : "exam";
  const isMock = kind === "mock";
  if (!examDateId) return json({ ok: false, code: "INVALID" }, 400);

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
  const { data: date } = await admin.from("vsat_exam_dates").select("wheebox_test_id, exam_date, label").eq("id", examDateId).maybeSingle();
  if (!date) return json({ ok: false, code: "DATE_UNAVAILABLE" }, 409);
  const examDate = date.exam_date ? new Date(date.exam_date) : new Date();

  const { data: settings } = await admin.from("vsat_exam_settings").select("mock_test_id, osr_format").eq("id", 1).maybeSingle();
  const osr = (settings?.osr_format || "o").toString();

  // exam → the date's real test; mock → the single configured mock test, same date cohort.
  const testId = isMock
    ? (settings?.mock_test_id ? String(settings.mock_test_id) : "")
    : (date.wheebox_test_id ? String(date.wheebox_test_id) : "");
  if (!testId) return json({ ok: false, code: isMock ? "MOCK_NOT_CONFIGURED" : "DATE_UNAVAILABLE" }, 409);
  const domainName = process.env.WHEEBOX_DOMAIN_NAME || creds.companyCode;
  const testName = process.env.WHEEBOX_TEST_NAME || testId;

  // everyone assigned to this VSAT date who doesn't already have a stored result for this test
  const { data: apps } = await admin
    .from("application_manager")
    .select("application_id, lead_id, wheebox_login_id, mock_launched_at")
    .eq("exam_date_id", examDateId);
  const all = (apps as { application_id: string; lead_id: string; wheebox_login_id: string | null; mock_launched_at: string | null }[] | null) ?? [];
  if (all.length === 0) return json({ ok: true, total: 0, pulled: 0, failed: 0, remaining: 0, results: [], vsat: date.label });

  const { data: done } = await admin
    .from("vsat_exam_results").select("application_id").eq("wheebox_test_id", testId).eq("is_mock", isMock);
  const haveResult = new Set((done as { application_id: string }[] | null)?.map((r) => r.application_id) ?? []);
  const pending = all.filter((a) => !haveResult.has(a.application_id));
  const slice = pending.slice(0, BATCH);

  const results: { application_id: string; ok: boolean; percentile?: number | null; error?: string }[] = [];
  let pulled = 0, failed = 0;
  for (const a of slice) {
    const loginId = a.wheebox_login_id || a.application_id;
    // mock: anchor to the student's own launch day; exam: the fixed date. Fall back to the date row.
    const dateAnchor = isMock && a.mock_launched_at ? new Date(a.mock_launched_at) : examDate;
    try {
      const result = await fetchResult({ domainName, testName, loginId, osr, dateOfExam: ymd(dateAnchor) }, creds);
      const parsed = parseWheeboxResult(result);
      await admin.from("vsat_exam_results").insert({
        application_id: a.application_id, lead_id: a.lead_id, wheebox_test_id: testId, is_mock: isMock,
        overall_result: parsed.overall, obtained_marks: parsed.obtainedMarks, max_marks: parsed.maxMarks,
        percentile: parsed.percentile, sections: parsed.sections,
        raw: (result && typeof result === "object" ? result : { raw: String(result) }) as Record<string, unknown>,
      });
      await admin.from("application_manager").update(
        isMock
          ? { mock_given: true, mock_result: studentMockResult(parsed), mock_percentile: parsed.percentile, mock_sections: parsed.sections }
          : { exam_given: true, exam_overall: parsed.overall, exam_obtained_marks: parsed.obtainedMarks, exam_max_marks: parsed.maxMarks, exam_percentile: parsed.percentile, exam_sections: parsed.sections },
      ).eq("lead_id", a.lead_id);
      pulled++; results.push({ application_id: a.application_id, ok: true, percentile: parsed.percentile });
    } catch (e) {
      failed++; results.push({ application_id: a.application_id, ok: false, error: e instanceof Error ? e.message : "WHEEBOX_ERROR" });
    }
  }

  return json({
    ok: true, vsat: date.label, total: all.length, pulled, failed,
    remaining: Math.max(0, pending.length - slice.length), results,
  });
}
