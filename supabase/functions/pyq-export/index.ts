// pyq-export — STAGING ONLY. Hands published PYQ papers to production so production can load
// exactly what was checked on staging (staging -> production promotion).
// Called from the PRODUCTION database via pg_net:
//   select net.http_post(url := '<staging url>/functions/v1/pyq-export',
//     body := '{"list":true}'::jsonb  -- or {"ids":["<paper uuid>", ...]} (1-20 ids)
//     headers := jsonb_build_object('Content-Type','application/json','x-pyq-sync','<staging sync token>'),
//     timeout_milliseconds := 60000);
//   then: select public.pyq_import_bundle(b, '<production figure base>')
//           from jsonb_array_elements(<response content>::jsonb) b;
// Auth: x-pyq-sync must match the staging token (public.pyq_check_sync_token, service_role only).
// The response body is passed through untouched so numbers keep their exact database text.
// Deployed with verify_jwt = false because of that own check.
import { createClient } from "npm:@supabase/supabase-js@2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const token = req.headers.get("x-pyq-sync") ?? "";
  const { data: okToken } = await sb.rpc("pyq_check_sync_token", { t: token });
  if (okToken !== true) return new Response("forbidden", { status: 403 });

  const body = await req.json().catch(() => ({}));
  let fn: string;
  let args: Record<string, unknown>;
  if (body.list === true) {
    fn = "pyq_export_list"; args = {};
  } else {
    const ids: unknown = body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 20 || !ids.every((x) => typeof x === "string" && UUID.test(x))) {
      return Response.json({ error: "need list:true, or ids: 1-20 paper uuids" }, { status: 400 });
    }
    fn = "pyq_export_bundles"; args = { p_ids: ids };
  }

  // Raw PostgREST call (not supabase-js) so the JSON text is not re-parsed into JS numbers.
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(args),
  });
  return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
});
