/**
 * VSAT exam · admin GLOBAL mock pull-result — fetch the mock result for every student who has
 * TAKEN the mock, mapped to each student. The mock is not tied to any VSAT date, so this is not
 * date-scoped: the cohort is everyone with mock_assigned = true who doesn't yet have a mock result.
 *
 * Admin-only. No body. Each student's result is looked up anchored to THEIR OWN mock_launched_at
 * (the day they sat it), using the mock's stored test name + domain name (vsat_exam_settings, 0165)
 * — the Wheebox result API keys on those, not the numeric id. A fetch that isn't a real result is
 * NOT stored. Idempotent + RESUMABLE — re-run until remaining = 0; up to BATCH students per call.
 */
import { NextResponse } from "next/server";
import { createClient as createTokenClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { adminDb } from "@/lib/peerpath/meet-sync";
import { bearerToken, sameOrigin } from "@/lib/peerpath/book-request";
import { wheeboxCreds } from "@/lib/wheebox/crypto";
import { fetchResult } from "@/lib/wheebox/api";
import { parseWheeboxResult, studentMockResult, isWheeboxOk, hasResultData } from "@/lib/wheebox/exam";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "bom1";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const BATCH = 40;

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token && !sameOrigin(req)) return json({ ok: false, code: "FORBIDDEN" }, 403);

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
  const { data: settings } = await admin.from("vsat_exam_settings").select("mock_test_id, mock_test_name, mock_domain_name, osr_format").eq("id", 1).maybeSingle();
  const testId = settings?.mock_test_id ? String(settings.mock_test_id) : "";
  if (!testId) return json({ ok: false, code: "MOCK_NOT_CONFIGURED" }, 409);
  const osr = (settings?.osr_format || "o").toString();
  const domainName = settings?.mock_domain_name || process.env.WHEEBOX_DOMAIN_NAME || creds.companyCode;
  const testName = settings?.mock_test_name || process.env.WHEEBOX_TEST_NAME || testId;

  // everyone who took the mock (mock_assigned) but doesn't have the mock result stored yet
  type Row = { application_id: string; lead_id: string; wheebox_login_id: string | null; mock_launched_at: string | null; mock_given: boolean | null };
  const { data: apps } = await admin
    .from("application_manager")
    .select("application_id, lead_id, wheebox_login_id, mock_launched_at, mock_given")
    .eq("mock_assigned", true)
    .limit(5000);
  const all = ((apps as Row[] | null) ?? []).filter((r) => r.mock_given !== true);
  if (all.length === 0) return json({ ok: true, total: 0, pulled: 0, failed: 0, remaining: 0, results: [] });

  const { data: done } = await admin
    .from("vsat_exam_results").select("application_id").eq("wheebox_test_id", testId).eq("is_mock", true);
  const haveResult = new Set((done as { application_id: string }[] | null)?.map((r) => r.application_id) ?? []);
  const pending = all.filter((a) => !haveResult.has(a.application_id));
  const slice = pending.slice(0, BATCH);

  const results: { application_id: string; ok: boolean; percentile?: number | null; error?: string }[] = [];
  let pulled = 0, failed = 0;
  for (const a of slice) {
    const loginId = a.wheebox_login_id || a.application_id;
    const dateAnchor = a.mock_launched_at ? new Date(a.mock_launched_at) : new Date();
    try {
      const result = await fetchResult({ domainName, testName, loginId, osr, dateOfExam: ymd(dateAnchor) }, creds);
      const parsed = parseWheeboxResult(result);
      if (!isWheeboxOk(result) || !hasResultData(parsed)) { failed++; results.push({ application_id: a.application_id, ok: false, error: "no result yet" }); continue; }
      await admin.from("vsat_exam_results").insert({
        application_id: a.application_id, lead_id: a.lead_id, wheebox_test_id: testId, is_mock: true,
        overall_result: parsed.overall, obtained_marks: parsed.obtainedMarks, max_marks: parsed.maxMarks,
        percentile: parsed.percentile, sections: parsed.sections,
        raw: (result && typeof result === "object" ? result : { raw: String(result) }) as Record<string, unknown>,
      });
      await admin.from("application_manager").update({
        mock_given: true, mock_result: studentMockResult(parsed), mock_percentile: parsed.percentile, mock_sections: parsed.sections,
      }).eq("lead_id", a.lead_id);
      pulled++; results.push({ application_id: a.application_id, ok: true, percentile: parsed.percentile });
    } catch (e) {
      failed++; results.push({ application_id: a.application_id, ok: false, error: e instanceof Error ? e.message : "WHEEBOX_ERROR" });
    }
  }

  return json({ ok: true, total: all.length, pulled, failed, remaining: Math.max(0, pending.length - slice.length), results });
}
