import { createClient } from "@supabase/supabase-js";
import { validateStageUpdates } from "@/lib/vsat/stage-updates";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";

/**
 * Applicant-side stage updates from the VSAT dashboard.
 * H-01: payment fields are refused (see src/lib/vsat/stage-updates.ts) — an
 * applicant can no longer mark their own payment as approved. Values are
 * validated; database errors are never returned to the browser.
 */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  let b: { accessToken?: string; updates?: unknown }; try { b = await req.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const admin = createClient(url, svc);
  const { data: { user } } = await admin.auth.getUser(typeof b.accessToken === "string" ? b.accessToken : "");
  if (!user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const check = validateStageUpdates(b.updates);
  if (!check.ok) return Response.json({ ok: false, error: check.error, field: check.field }, { status: 400 });
  const { data: app } = await admin.from("application_manager").select("application_id").eq("lead_id", user.id).maybeSingle();
  if (!app) return Response.json({ ok: false, error: "no application" }, { status: 404 });
  const updates: Record<string, unknown> = { ...check.updates, last_updated_date: new Date().toISOString() };
  const { error } = await admin.from("application_manager").update(updates).eq("application_id", app.application_id);
  if (error) return Response.json({ ok: false, error: "update_failed" }, { status: 500 });
  await admin.from("crm_activity_log").insert({ entity_type: "application", application_id: app.application_id, lead_id: user.id, action: "stage_change", metadata: check.updates, actor: "applicant", path: "/vsat/dashboard" });
  return Response.json({ ok: true });
}
