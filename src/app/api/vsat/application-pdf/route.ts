import { createClient } from "@supabase/supabase-js";
import { applicationHtml, buildSections } from "@/lib/vsat/application-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only, print-ready HTML of the requester's OWN submitted VSAT application
 * (→ browser Save as PDF). Returns 409 until the form is submitted. All reads are
 * server-side (service role); the browser never gets table access.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const token = sp.get("token");
  if (!token) return new Response("missing token", { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svcKey) return new Response("not configured", { status: 500 });

  const asUser = createClient(url, anon);
  const { data: u, error } = await asUser.auth.getUser(token);
  if (error || !u?.user?.id) return new Response("unauthorized", { status: 401 });
  const userId = u.user.id;

  const svc = createClient(url, svcKey);
  // Select "*" so a column that exists on one environment but not another (e.g. campus_preference,
  // stream) can never break the fetch. campus/stream below are optional and fall back safely.
  // We also surface a real read error instead of silently reporting "No application found".
  const { data: appRow, error: readErr } = await svc.from("application_manager")
    .select("*")
    .eq("lead_id", userId).maybeSingle();
  if (readErr) return new Response("Couldn't load your application right now. Please try again in a moment.", { status: 500 });
  const a = appRow as (Record<string, unknown> & { form_data?: Record<string, unknown> }) | null;
  if (!a) return new Response("No application found", { status: 404 });

  const formData = (a.form_data ?? {}) as Record<string, unknown>;
  const meta = (formData["_meta"] ?? {}) as { submitted?: boolean };
  if (!meta.submitted) return new Response("Your application PDF is available once you submit the form.", { status: 409 });

  const { data: formRow } = await svc.from("vsat_forms").select("name, schema").eq("status", "active").maybeSingle();
  const form = (formRow ?? { name: "VSAT Application", schema: { categories: [] } }) as {
    name: string;
    schema: { categories?: { key: string; label?: string | null; questions?: { key: string; label?: string | null; type?: string | null }[] }[] };
  };

  const stageLabel = a.application_stage_1 ? String(a.application_stage_1).replace(/_/g, " ") : null;
  const html = applicationHtml({
    applicationNo: String(a.application_no || a.application_id || "—"),
    name: String(a.registered_name || ""),
    email: (a.registered_email as string) ?? null,
    phone: (a.registered_mobile as string) ?? null,
    campus: (a.campus_applied as string) || (a.campus_preference as string) || null,
    stream: (a.stream as string) ?? null,
    statusLabel: stageLabel,
    createdAtIso: (a.created_at as string) ?? null,
    formName: form.name,
    // render from the stored answers (never dropped if the live form changed), enriched by the schema labels
    sections: buildSections(formData, form.schema?.categories ?? []),
  });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
