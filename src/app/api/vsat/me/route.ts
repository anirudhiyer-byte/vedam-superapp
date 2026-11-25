import { createClient } from "@supabase/supabase-js";
import { isTerminalFail } from "@/lib/vsat/pipeline";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  let b: { accessToken?: string }; try { b = await req.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const admin = createClient(url, svc);
  const { data: { user } } = await admin.auth.getUser(b.accessToken || "");
  if (!user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // These three only depend on user.id — run them in parallel instead of serially
  // (saves two DB round-trips on every dashboard load).
  const [{ data: app }, { data: lead }, { data: dates }, { data: flagRows }] = await Promise.all([
    admin.from("application_manager").select("*").eq("lead_id", user.id).maybeSingle(),
    admin.from("lead_manager").select("lead_stage,registered_name,public_id,campus_preference").eq("lead_id", user.id).maybeSingle(),
    // Enabled, not-yet-finished exam dates for the student date picker (no Wheebox test id exposed).
    admin.from("vsat_exam_dates")
      .select("id,label,exam_date,start_at,end_at")
      .eq("enabled", true).gte("end_at", new Date().toISOString())
      .order("start_at", { ascending: true }),
    admin.from("app_flags").select("key,value").in("key", ["vsat_mock_enabled", "vsat_exam_enabled"]),
  ]);
  // student-facing exam master switches (admins bypass these in the launch route anyway)
  const fv = (k: string, dflt: string) => (flagRows as { key: string; value: string }[] | null)?.find((r) => r.key === k)?.value ?? dflt;
  const examFlags = { mock: fv("vsat_mock_enabled", "off") === "on", exam: fv("vsat_exam_enabled", "on") === "on" };
  // pipeline stage/status (keyed by application_id) — lets the dashboard show the exact
  // terminal-fail state and whether a 2nd attempt is offered (legacy application_stage_1 can't
  // tell a no-show from a not-cleared, and has no value for a counselling fail).
  type Vp = { stage: string; status: string; attempt_no: number };
  let pipeline: Vp | null = null;
  const applicationId = (app as { application_id?: string } | null)?.application_id;
  if (applicationId) {
    const { data: vp } = await admin.from("vsat_pipeline").select("stage,status,attempt_no").eq("application_id", applicationId).maybeSingle();
    pipeline = (vp as Vp | null) ?? null;
  }
  const a = app as { payment_stage_1?: string | null; payment_stage_2?: string | null } | null;
  const secondAttemptEligible = !!pipeline && pipeline.attempt_no === 1 &&
    isTerminalFail(pipeline.stage, pipeline.status) &&
    a?.payment_stage_1 === "payment_approved" && a?.payment_stage_2 !== "payment_approved";
  // Raw VSAT/exam marks are admin-only — the student only ever sees a VPS score (+ the
  // Cleared/Not-Cleared verdict) and their mock result. select("*") above pulls the raw
  // marks too, so strip them before they reach the browser (they're never rendered, but
  // would otherwise be readable in the network response). Admin views read them separately.
  const SCORE_PRIVATE = [
    "exam_overall", "exam_sections", "exam_obtained_marks", "exam_max_marks", "exam_percentile",
    "vsat_score_lr_1", "vsat_score_maths_1", "vsat_score_cs_1", "vsat_total_1", "vsat_percentile_1",
    "vsat_score_lr_2", "vsat_score_maths_2", "vsat_score_cs_2", "vsat_total_2", "vsat_percentile_2",
  ];
  let appSafe = app as Record<string, unknown> | null;
  if (appSafe) { appSafe = { ...appSafe }; for (const k of SCORE_PRIVATE) delete appSafe[k]; }
  return Response.json({ ok: true, app: appSafe, lead, dates: dates ?? [], pipeline, secondAttemptEligible, examFlags });
}
