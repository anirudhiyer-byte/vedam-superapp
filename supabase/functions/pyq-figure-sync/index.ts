// pyq-figure-sync — copies PYQ figure PNGs into this project's `pyq-figures` Storage bucket
// (pyq_figures/<name>). Two sources:
//   - GitHub: the public `pyq-data` branch at a commit  -> body { ref: '<40-char sha>', names: [...] }
//   - Staging: the staging project's public pyq-figures bucket -> body { from: 'staging', names: [...] }
//     (used to promote figures that were checked on staging to production).
// Called from SQL via pg_net by an admin loading papers:
//   select net.http_post(
//     url := '<project url>/functions/v1/pyq-figure-sync',
//     body := jsonb_build_object('ref', '<sha>', 'names', jsonb_build_array('a.png', …)),
//     headers := jsonb_build_object('Content-Type','application/json',
//                 'x-pyq-sync', (select token from private_pyq.sync_token limit 1)),
//     timeout_milliseconds := 120000);
// Auth: the x-pyq-sync token must match the one stored in the database
// (checked through public.pyq_check_sync_token, callable only by service_role).
// Deployed with verify_jwt = false because of that own check.
import { createClient } from "npm:@supabase/supabase-js@2";

const REPO = "anirudhiyer-byte/vedam-superapp";
// Fixed allow-list: the only non-GitHub source is the staging bucket.
const STAGING_BASE = "https://kyhakenhbgcissmaacws.supabase.co/storage/v1/object/public/pyq-figures/pyq_figures/";
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.png$/;
const REF_RE = /^[0-9a-f]{40}$/;
const PARALLEL = 6;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const token = req.headers.get("x-pyq-sync") ?? "";
  const { data: okToken } = await sb.rpc("pyq_check_sync_token", { t: token });
  if (okToken !== true) return new Response("forbidden", { status: 403 });

  const body = await req.json().catch(() => ({}));
  const fromStaging = body.from === "staging";
  const ref = String(body.ref ?? "");
  const names: unknown = body.names;
  if ((!fromStaging && !REF_RE.test(ref)) || !Array.isArray(names) || names.length === 0 || names.length > 150) {
    return Response.json({ error: "need ref (commit sha) or from:'staging', and 1-150 names" }, { status: 400 });
  }
  const source = (name: string) => fromStaging
    ? `${STAGING_BASE}${name}`
    : `https://raw.githubusercontent.com/${REPO}/${ref}/figures/${name}`;

  async function copyOne(raw: unknown): Promise<{ name: string; ok: boolean; error?: string }> {
    const name = String(raw);
    if (!NAME_RE.test(name)) return { name, ok: false, error: "bad name" };
    const r = await fetch(source(name));
    if (!r.ok) return { name, ok: false, error: `source ${r.status}` };
    const buf = new Uint8Array(await r.arrayBuffer());
    const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (!isPng) return { name, ok: false, error: "not a png" };
    const { error } = await sb.storage.from("pyq-figures").upload(`pyq_figures/${name}`, buf, { contentType: "image/png", upsert: true });
    return { name, ok: !error, ...(error ? { error: error.message } : {}) };
  }

  const list = names as unknown[];
  const results: { name: string; ok: boolean; error?: string }[] = [];
  for (let i = 0; i < list.length; i += PARALLEL) {
    results.push(...(await Promise.all(list.slice(i, i + PARALLEL).map(copyOne))));
  }
  return Response.json({ ok: results.every((x) => x.ok), uploaded: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok) });
});
