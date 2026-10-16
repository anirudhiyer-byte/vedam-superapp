// pyq-figure-sync — copies PYQ figure PNGs from the public `pyq-data` branch on
// GitHub into the `pyq-figures` Storage bucket (pyq_figures/<name>).
// Called from SQL via pg_net by an admin loading paper bundles:
//   select net.http_post(
//     url := '<project url>/functions/v1/pyq-figure-sync',
//     body := jsonb_build_object('ref', '<40-char commit sha>', 'names', jsonb_build_array('a.png', …)),
//     headers := jsonb_build_object('Content-Type','application/json',
//                 'x-pyq-sync', (select token from private_pyq.sync_token limit 1)));
// Auth: the x-pyq-sync token must match the one stored in the database
// (checked through public.pyq_check_sync_token, callable only by service_role).
// Deployed with verify_jwt = false because of that own check.
import { createClient } from "npm:@supabase/supabase-js@2";

const REPO = "anirudhiyer-byte/vedam-superapp";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.png$/;
const REF_RE = /^[0-9a-f]{40}$/;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const token = req.headers.get("x-pyq-sync") ?? "";
  const { data: okToken } = await sb.rpc("pyq_check_sync_token", { t: token });
  if (okToken !== true) return new Response("forbidden", { status: 403 });

  const body = await req.json().catch(() => ({}));
  const ref = String(body.ref ?? "");
  const names: unknown = body.names;
  if (!REF_RE.test(ref) || !Array.isArray(names) || names.length === 0 || names.length > 150) {
    return Response.json({ error: "need ref (commit sha) and 1-150 names" }, { status: 400 });
  }

  const results: { name: string; ok: boolean; error?: string }[] = [];
  for (const raw of names) {
    const name = String(raw);
    if (!NAME_RE.test(name)) { results.push({ name, ok: false, error: "bad name" }); continue; }
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${ref}/figures/${name}`);
    if (!r.ok) { results.push({ name, ok: false, error: `github ${r.status}` }); continue; }
    const buf = new Uint8Array(await r.arrayBuffer());
    const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (!isPng) { results.push({ name, ok: false, error: "not a png" }); continue; }
    const { error } = await sb.storage.from("pyq-figures").upload(`pyq_figures/${name}`, buf, { contentType: "image/png", upsert: true });
    results.push({ name, ok: !error, ...(error ? { error: error.message } : {}) });
  }
  return Response.json({ ok: results.every((x) => x.ok), uploaded: results.filter((x) => x.ok).length, results });
});
