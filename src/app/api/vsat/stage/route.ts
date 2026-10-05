import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
const ALLOWED = new Set(["payment_stage_1","payment_stage_2","form_stage_1","form_stage_2","application_stage_1","application_stage_2","vsat_slot_datetime_1","payment_stage_1_at"]);
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  let b: { accessToken?: string; updates?: Record<string, unknown> }; try { b = await req.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const admin = createClient(url, svc);
  const { data: { user } } = await admin.auth.getUser(b.accessToken || "");
  if (!user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { data: app } = await admin.from("application_manager").select("application_id").eq("lead_id", user.id).maybeSingle();
  if (!app) return Response.json({ ok: false, error: "no application" }, { status: 404 });
  const updates: Record<string, unknown> = { last_updated_date: new Date().toISOString() };
  for (const [k, v] of Object.entries(b.updates ?? {})) if (ALLOWED.has(k)) updates[k] = v;
  const { error } = await admin.from("application_manager").update(updates).eq("application_id", app.application_id);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  await admin.from("crm_activity_log").insert({ entity_type: "application", application_id: app.application_id, lead_id: user.id, action: "stage_change", metadata: b.updates ?? {}, actor: "applicant", path: "/vsat/dashboard" });
  return Response.json({ ok: true });
}
