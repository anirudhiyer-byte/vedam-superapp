import { createClient } from "@supabase/supabase-js";
import { parseBody, vsatLeadSchema } from "@/lib/validation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Upsert a VSAT lead (lead_manager) + mirror to profiles. Fired on phone-OTP verify. */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  const parsed = await parseBody(req, vsatLeadSchema);
  if (!parsed.ok) return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  const b = parsed.data;
  const admin = createClient(url, svc);
  const { data: { user } } = await admin.auth.getUser(b.accessToken || "");
  if (!user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const L = b.lead ?? {};
  const { data: prof } = await admin.from("profiles").select("public_id").eq("id", user.id).maybeSingle();
  const { data: existing } = await admin.from("lead_manager").select("primary_utm").eq("lead_id", user.id).maybeSingle();
  // build source/medium/campaign from the three parts (not just the campaign)
  const s = (L.utm_source as string) || "", m = (L.utm_medium as string) || "", c = (L.utm_campaign as string) || "";
  const triple = (s || m || c) ? [s, m, c].join("/") : ((L.full_utm as string) ?? null);
  const priorPrimary = existing?.primary_utm as string | undefined;
  // keep the real first-touch, but self-heal a stale campaign-only value (no "/")
  const primaryUtm = (priorPrimary && priorPrimary.includes("/")) ? priorPrimary : triple;
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
    latest_utm: triple,   // always the newest source/medium/campaign
    lead_source: L.lead_source ?? null,
    mobile_verification_status: "verified",
    lead_verification_date: new Date().toISOString(),
    primary_utm: primaryUtm,  // write-once first-touch (self-heals a stale campaign-only value)
    lead_stage: "lead",
    user_registration_date: new Date().toISOString(),
  };
  const { error } = await admin.from("lead_manager").upsert(row, { onConflict: "lead_id" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  await admin.from("crm_activity_log").insert({ entity_type: "lead", lead_id: user.id, action: "stage_change", stage_type: "application", to_value: "lead", actor: "applicant", path: "/apply" });
  return Response.json({ ok: true });
}
