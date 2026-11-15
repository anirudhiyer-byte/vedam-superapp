import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * VSAT application file answers — private `vsat-app-files` bucket.
 *
 * POST  (multipart: accessToken, category, question, file)
 *   Upload one file for a 'file' question on the ACTIVE form. Gated to the paid
 *   applicant (their own) or an admin. Allowed types + max size are read from the
 *   form schema server-side (the client cannot widen them). Returns the stored ref
 *   { path, name, size, type } to put into the answer.
 *
 * GET   (?path=…  with Authorization: Bearer <token> or ?token=…)
 *   Returns a short-lived signed URL for a stored object, to the owner (path under
 *   their own id) or an admin. Browsers can never read the bucket directly.
 */

const BUCKET = "vsat-app-files";
const HARD_CAP = 25 * 1024 * 1024; // 25 MiB backstop (matches the bucket limit)

type Q = { key?: string; type?: string; accept?: unknown; maxSizeMb?: unknown };

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && anon && svcKey ? { url, anon, svcKey } : null;
}

async function whoAmI(url: string, anon: string, token: string) {
  const asUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: u, error } = await asUser.auth.getUser(token);
  if (error || !u?.user?.id) return null;
  let isAdmin = (u.user.email ?? "").toLowerCase().endsWith("@vedam.org") && !!u.user.email_confirmed_at;
  if (!isAdmin) { const { data } = await asUser.rpc("is_admin"); isAdmin = !!data; }
  return { id: u.user.id, isAdmin };
}

// does `name`/`type` satisfy one of the accept patterns?  '' / [] => accept anything.
function okType(accept: string[], name: string, type: string): boolean {
  if (accept.length === 0) return true;
  const n = name.toLowerCase(), t = (type || "").toLowerCase();
  return accept.some((raw) => {
    const a = raw.trim().toLowerCase();
    if (!a) return false;
    if (a.startsWith(".")) return n.endsWith(a);           // extension, e.g. ".pdf"
    if (a.endsWith("/*")) return t.startsWith(a.slice(0, -1)); // family, e.g. "image/*"
    return t === a;                                        // exact mime
  });
}

function safeName(raw: string): string {
  const base = (raw || "file").split(/[\\/]/).pop() || "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

function findFileQuestion(schema: unknown, category: string, question: string): Q | null {
  const cats = (schema as { categories?: Array<Record<string, unknown>> } | null)?.categories ?? [];
  const cat = cats.find((c) => c.key === category);
  if (!cat) return null;
  const direct = (cat.questions as Q[] | undefined) ?? [];
  const subs = (cat.subcategories as Array<{ questions?: Q[] }> | undefined) ?? [];
  const all = [...direct, ...subs.flatMap((s) => s.questions ?? [])];
  const q = all.find((x) => x.key === question);
  return q && q.type === "file" ? q : null;
}

export async function POST(req: Request) {
  const e = env();
  if (!e) return Response.json({ ok: false, error: "not configured" }, { status: 500 });

  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ ok: false, error: "bad form" }, { status: 400 }); }
  const token = String(form.get("accessToken") || "");
  const category = String(form.get("category") || "");
  const question = String(form.get("question") || "");
  const file = form.get("file");
  if (!token) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });
  if (!category || !question) return Response.json({ ok: false, error: "missing target" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ ok: false, error: "no_file" }, { status: 400 });
  if (file.size <= 0) return Response.json({ ok: false, error: "empty_file" }, { status: 400 });
  if (file.size > HARD_CAP) return Response.json({ ok: false, error: "too_large" }, { status: 413 });

  const me = await whoAmI(e.url, e.anon, token);
  if (!me) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });

  const svc = createClient(e.url, e.svcKey);

  // paid applicant OR admin
  if (!me.isAdmin) {
    const { data: paid } = await svc.from("vsat_payments").select("lead_id").eq("lead_id", me.id).maybeSingle();
    if (!paid) return Response.json({ ok: false, error: "not_paid" }, { status: 403 });
  }

  // find the file question on the active form, read its rules
  const { data: active } = await svc.from("vsat_forms").select("schema").eq("status", "active").maybeSingle();
  const q = findFileQuestion(active?.schema, category, question);
  if (!q) return Response.json({ ok: false, error: "unknown_question" }, { status: 400 });

  const accept = Array.isArray(q.accept) ? (q.accept as unknown[]).map(String) : [];
  const maxMb = Number(q.maxSizeMb);
  const maxBytes = Number.isFinite(maxMb) && maxMb > 0 ? Math.min(maxMb * 1024 * 1024, HARD_CAP) : HARD_CAP;
  if (file.size > maxBytes) return Response.json({ ok: false, error: "too_large", maxMb: maxBytes / 1024 / 1024 }, { status: 413 });
  if (!okType(accept, file.name, file.type)) return Response.json({ ok: false, error: "bad_type", accept }, { status: 415 });

  const name = safeName(file.name);
  const path = `applications/${me.id}/${category}/${question}/${crypto.randomUUID()}-${name}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await svc.storage.from(BUCKET).upload(path, buf, {
    upsert: false, contentType: file.type || "application/octet-stream",
  });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, file: { path, name: file.name.slice(0, 160), size: file.size, type: file.type || "" } });
}

export async function GET(req: Request) {
  const e = env();
  if (!e) return Response.json({ ok: false, error: "not configured" }, { status: 500 });

  const u = new URL(req.url);
  const path = u.searchParams.get("path") || "";
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || u.searchParams.get("token") || "";
  if (!token) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });
  if (!path.startsWith("applications/")) return Response.json({ ok: false, error: "bad_path" }, { status: 400 });

  const me = await whoAmI(e.url, e.anon, token);
  if (!me) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });
  // owner (path under their own id) or admin
  if (!me.isAdmin && !path.startsWith(`applications/${me.id}/`)) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const svc = createClient(e.url, e.svcKey);
  const { data, error } = await svc.storage.from(BUCKET).createSignedUrl(path, 120);
  if (error || !data?.signedUrl) return Response.json({ ok: false, error: error?.message || "not_found" }, { status: 404 });
  return Response.json({ ok: true, url: data.signedUrl });
}
