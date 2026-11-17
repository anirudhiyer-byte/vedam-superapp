import { createClient } from "@supabase/supabase-js";
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
  const [{ data: app }, { data: lead }, { data: dates }] = await Promise.all([
    admin.from("application_manager").select("*").eq("lead_id", user.id).maybeSingle(),
    admin.from("lead_manager").select("lead_stage,registered_name,public_id,campus_preference").eq("lead_id", user.id).maybeSingle(),
    // Enabled, not-yet-finished exam dates for the student date picker (no Wheebox test id exposed).
    admin.from("vsat_exam_dates")
      .select("id,label,exam_date,start_at,end_at")
      .eq("enabled", true).gte("end_at", new Date().toISOString())
      .order("start_at", { ascending: true }),
  ]);
  return Response.json({ ok: true, app, lead, dates: dates ?? [] });
}
