import { createClient } from "@supabase/supabase-js";
import { parseBody, vsatLeadSchema } from "@/lib/validation";
import { sendVsatStepComms } from "@/lib/vsat/comms";
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
  // Self-heal the FK parent before writing the lead: lead_manager.lead_id -> profiles.id.
  // handle_new_user seeds profiles on signup, but an ORPHANED auth user (profile deleted
  // during re-testing, or a one-off trigger miss) would otherwise make every lead write
  // fail with foreign_key_violation (lead_manager_lead_id_fkey) — which hard-stops the whole
  // apply flow. Ensure the row exists first. ON CONFLICT DO NOTHING (ignoreDuplicates) never
  // touches an existing profile's data; the user has already OTP-verified by this point, so
  // mobile_verified is true for a freshly-seeded row.
  const { error: profErr } = await admin.from("profiles").upsert(
    {
      id: user.id,
      email: (L.email as string) || user.email || null,
      phone: (L.phone as string) || user.phone || null,
      full_name: (L.name as string) || null,
      mobile_verified: true,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (profErr) return Response.json({ ok: false, error: profErr.message }, { status: 500 });
  // Independent lookups — run together to shave a round-trip off the apply path.
  // profiles is guaranteed to exist now, so public_id resolves for brand-new leads too.
  const [{ data: prof }, { data: existing }] = await Promise.all([
    admin.from("profiles").select("public_id").eq("id", user.id).maybeSingle(),
    admin.from("lead_manager").select("lead_stage, user_registration_date").eq("lead_id", user.id).maybeSingle(),
  ]);
  // Supply the raw source/medium/campaign parts for this touch (falling back to a
  // combined full_utm split by "/"). The full attribution chain — primary / secondary /
  // tertiary / latest + the primary breakout — is maintained by the DB trigger
  // trg_vsat_lead_attribution (migration 0092), so the route never computes it.
  let us = (L.utm_source as string) || "", um = (L.utm_medium as string) || "", uc = (L.utm_campaign as string) || "";
  if (!us && !um && !uc && L.full_utm) {
    const parts = String(L.full_utm).split("/");
    us = parts[0] ?? ""; um = parts[1] ?? ""; uc = parts[2] ?? "";
  }
  const row = {
    lead_id: user.id,
    public_id: prof?.public_id ?? null,
    registered_name: L.name ?? null,
    registered_email: L.email ?? null,
    registered_mobile: L.phone ?? null,
    source_hearabout: L.hearAbout ?? null,
    campus_preference: L.campusPref ?? null,
    utm_source: us || null, utm_medium: um || null, utm_campaign: uc || null,
    utm_content: L.utm_content ?? null, utm_term: L.utm_term ?? null,
    lead_source: L.lead_source ?? null,
    mobile_verification_status: "verified",
    lead_verification_date: new Date().toISOString(),
    // preserve progress on a revisit: never downgrade lead_stage, keep the original
    // registration time (write-once).
    lead_stage: (existing?.lead_stage as string) ?? "lead",
    user_registration_date: (existing?.user_registration_date as string) ?? new Date().toISOString(),
  };
  const { error } = await admin.from("lead_manager").upsert(row, { onConflict: "lead_id" });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  await admin.from("crm_activity_log").insert({ entity_type: "lead", lead_id: user.id, action: "stage_change", stage_type: "application", to_value: "lead", actor: "applicant", path: "/apply" });
  // stage comm: first half filled → account + lead (fires once per lead, best-effort)
  await sendVsatStepComms("first_half", { leadId: user.id, name: (L.name as string) ?? null, email: (L.email as string) ?? null, phone: (L.phone as string) ?? null });
  return Response.json({ ok: true });
}
