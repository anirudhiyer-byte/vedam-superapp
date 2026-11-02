/**
 * VSAT exam · Wheebox result callback (Wheebox API doc §6).
 *
 * Wheebox appends `?testresult=<encoded json>` to the callback URL we register, so
 * the secret and kind live in the PATH (not the query) to avoid a `?` collision:
 *     GET|POST  https://<us>/api/vsat/exam/wheebox-callback/<secret>/<mock|exam>?testresult=<encoded json>
 *
 * `testresult` is an encoded JSON string holding an `OVERALL` object and a
 * `SECTIONWISE` block, keyed to the candidate by `emailId` (= our Wheebox loginId =
 * application_id, or the registered email) and `testName`.
 *
 * Guard: the <secret> path segment must equal WHEEBOX_CALLBACK_SECRET.
 * <kind> ("mock" | "exam") decides mock vs main — we register one URL per kind.
 * Anything other than "mock" is treated as EXAM, the safe default: a mock result is
 * student-visible and a main-VSAT result must never be.
 *
 * Student visibility (migration 0040): mock → application_manager.mock_result
 * (student-visible). main VSAT → admin-only exam_* columns + the ledger, never
 * vps_score (set later at the Cleared / Not-Cleared stage).
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/peerpath/meet-sync";
import { wheeboxCreds, wheeboxDecrypt } from "@/lib/wheebox/crypto";
import { parseWheeboxResult, studentMockResult } from "@/lib/wheebox/exam";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const preferredRegion = "bom1";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

const str = (o: Record<string, unknown>, keys: string[]): string | null => {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) lower[k.toLowerCase()] = v;
  for (const k of keys) { const v = lower[k.toLowerCase()]; if (v !== undefined && v !== null && String(v) !== "") return String(v); }
  return null;
};

/** Decode the `testresult` string → JSON object (plain, or AES-hex when encrypted). */
function decodeResult(testresult: string): Record<string, unknown> | null {
  const s = testresult.trim();
  try { return JSON.parse(s) as Record<string, unknown>; } catch { /* not plain json */ }
  const creds = wheeboxCreds();
  if (creds && /^[0-9a-f]+$/i.test(s)) {
    try { return JSON.parse(wheeboxDecrypt(s, creds.privateKey)) as Record<string, unknown>; } catch { /* not hex json */ }
  }
  return null;
}

type Params = { params: Promise<{ secret: string; kind: string }> };

async function handle(req: Request, { params }: Params): Promise<NextResponse> {
  const secret = process.env.WHEEBOX_CALLBACK_SECRET;
  if (!secret) return json({ ok: false, code: "CALLBACK_NOT_CONFIGURED" }, 503);
  const { secret: urlSecret, kind: urlKind } = await params;
  if (!timingSafeEq(urlSecret ?? "", secret)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  const kind = urlKind === "mock" ? "mock" : "exam"; // anything else ⇒ exam (safe default)

  const url = new URL(req.url);
  let testresult = url.searchParams.get("testresult");
  let bodyObj: Record<string, unknown> = {};
  if (!testresult && req.method === "POST") {
    const ctype = (req.headers.get("content-type") ?? "").toLowerCase();
    try {
      if (ctype.includes("application/json")) {
        bodyObj = (await req.json()) as Record<string, unknown>;
        testresult = typeof bodyObj.testresult === "string" ? bodyObj.testresult : null;
      } else {
        const form = await req.formData();
        bodyObj = Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
        testresult = typeof bodyObj.testresult === "string" ? (bodyObj.testresult as string) : null;
      }
    } catch { /* fall through */ }
  }

  const payload = testresult ? decodeResult(testresult) : (Object.keys(bodyObj).length ? bodyObj : null);
  if (!payload) return json({ ok: false, code: "NO_RESULT" }, 400);

  const overall = (payload.OVERALL && typeof payload.OVERALL === "object" ? payload.OVERALL : payload) as Record<string, unknown>;
  const emailId = str(overall, ["emailId", "email_id", "loginId", "login_id", "regNO", "applicationId"]);
  const testName = str(overall, ["testName", "test_name"]);
  const testId = str(overall, ["testId", "testNo", "test_id"]);
  if (!emailId) return json({ ok: false, code: "NO_EMAIL_ID" }, 400);

  const admin = adminDb();

  // Resolve the applicant by the Wheebox email id — our loginId (= application_id)
  // or the registered email. Three safe equality lookups.
  let app: { lead_id: string | null; application_id: string } | null = null;
  for (const col of ["wheebox_login_id", "application_id", "registered_email"] as const) {
    const r = await admin.from("application_manager").select("lead_id, application_id").eq(col, emailId).maybeSingle();
    if (r.data) { app = r.data; break; }
  }

  const isMock = kind === "mock";
  const parsed = parseWheeboxResult(payload);

  // Admin-only ledger — always, even if no applicant matched.
  await admin.from("vsat_exam_results").insert({
    application_id: app?.application_id ?? emailId,
    lead_id: app?.lead_id ?? null,
    wheebox_test_id: testId ?? testName,
    is_mock: isMock,
    overall_result: parsed.overall,
    obtained_marks: parsed.obtainedMarks,
    max_marks: parsed.maxMarks,
    percentile: parsed.percentile,
    sections: parsed.sections,
    raw: payload,
  });

  // Update the application. OVERALL and SECTIONWISE may arrive in separate hits, so
  // only write the fields present in THIS payload.
  if (app?.lead_id) {
    const hasOverall = parsed.overall !== null || parsed.obtainedMarks !== null || parsed.maxMarks !== null;
    const hasSections = Object.keys(parsed.sections).length > 0;
    if (isMock) {
      const prev = await admin.from("application_manager").select("mock_result").eq("lead_id", app.lead_id).maybeSingle();
      const merged = { ...((prev.data?.mock_result as Record<string, unknown> | null) ?? {}), ...studentMockResult(parsed) };
      await admin.from("application_manager").update({ mock_given: true, mock_result: merged }).eq("lead_id", app.lead_id);
    } else {
      const upd: Record<string, unknown> = { exam_given: true };
      if (hasOverall) {
        upd.exam_overall = parsed.overall;
        upd.exam_obtained_marks = parsed.obtainedMarks;
        upd.exam_max_marks = parsed.maxMarks;
        if (parsed.percentile !== null) upd.exam_percentile = parsed.percentile;
      }
      if (hasSections) upd.exam_sections = parsed.sections;
      await admin.from("application_manager").update(upd).eq("lead_id", app.lead_id);
    }
  }

  return json({ ok: true, matched: !!app?.lead_id, isMock });
}

export async function POST(req: Request, ctx: Params) { return handle(req, ctx); }
export async function GET(req: Request, ctx: Params) { return handle(req, ctx); }
