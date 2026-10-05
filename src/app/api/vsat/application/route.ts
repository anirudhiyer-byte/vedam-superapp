import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const appId = () => "VDM-" + Math.random().toString(36).slice(2, 7).toUpperCase() + Date.now().toString(36).slice(-3).toUpperCase();

/** Create the application_manager row (applicant) on "Start application". */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  let b: { accessToken?: string; app?: Record<string, unknown> };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "bad request" }, { status: 400 }); }
  const admin = createClient(url, svc);
  const { data: { user } } = await admin.auth.getUser(b.accessToken || "");
  if (!user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const A = b.app ?? {};
  const { data: prof } = await admin.from("profiles").select("public_id").eq("id", user.id).maybeSingle();

  // one application per lead: reuse if exists
  const { data: existing } = await admin.from("application_manager").select("application_id").eq("lead_id", user.id).maybeSingle();
  const application_id = existing?.application_id ?? appId();
  const row = {
    application_id,
    lead_id: user.id,
    application_no: prof?.public_id ?? null,
    registered_name: A.name ?? null, registered_email: A.email ?? null, registered_mobile: A.phone ?? null,
    campus_applied: A.campusPref ?? null,
    class_12_stream: A.stream ?? null,
    class12_year: A.gradYear ?? null,
    state: A.state ?? null, city: A.city ?? null,
    form_name: "VSAT Application",
    form_stage_1: "form_initiated",
    payment_stage_1: "payment_not_initiated",
    application_stage_1: "payment_not_initiated",
    current_attempt: 1,
    created_at: new Date().toISOString(),
  };
  const { error } = await admin.from("application_manager").upsert(row, { onConflict: "application_id" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  await admin.from("lead_manager").update({ lead_stage: "applicant_unpaid", application_submitted: true }).eq("lead_id", user.id);
  await admin.from("crm_activity_log").insert({ entity_type: "application", application_id, lead_id: user.id, action: "stage_change", stage_type: "application", to_value: "applicant", actor: "applicant", path: "/apply" });
  return Response.json({ ok: true, application_id });
}
