import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Upsert a VSAT lead (lead_manager) + mirror to profiles. Fired on phone-OTP verify. */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  let b: { accessToken?: string; lead?: Record<string, unknown> };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "bad request" }, { status: 400 }); }
  const admin = createClient(url, svc);
  const { data: { user } } = await admin.auth.getUser(b.accessToken || "");
  if (!user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const L = b.lead ?? {};
  const { data: prof } = await admin.from("profiles").select("public_id").eq("id", user.id).maybeSingle();
  const row = {
    lead_id: user.id,
    public_id: prof?.public_id ?? null,
    registered_name: L.name ?? null,
    registered_email: L.email ?? null,
    registered_mobile: L.phone ?? null,
    source_hearabout: L.hearAbout ?? null,
    campus_preference: L.campusPref ?? null,
    utm_source: L.utm_source ?? null, utm_medium: L.utm_medium ?? null, utm_campaign: L.utm_campaign ?? null,
    utm_content: L.utm_content ?? null, utm_term: L.utm_term ?? null,
    primary_utm: L.primary_utm ?? null, latest_utm: L.latest_utm ?? null,
    lead_source: L.lead_source ?? null,
    mobile_verification_status: "verified",
    lead_verification_date: new Date().toISOString(),
    lead_stage: "lead",
    user_registration_date: new Date().toISOString(),
  };
  const { error } = await admin.from("lead_manager").upsert(row, { onConflict: "lead_id" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  await admin.from("crm_activity_log").insert({ entity_type: "lead", lead_id: user.id, action: "stage_change", stage_type: "application", to_value: "lead", actor: "applicant", path: "/apply" });
  return Response.json({ ok: true });
}
