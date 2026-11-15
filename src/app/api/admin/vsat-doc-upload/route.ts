import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only upload of a VSAT landing document into the public `vsat-docs` bucket
 * (brochures, sample paper, prep kit). The browser sends the picked file as
 * multipart form-data with the admin's access token; the file is written with the
 * service role. Only a fixed set of target filenames is allowed (no arbitrary paths).
 */
const ALLOWED = new Set([
  "adypu-pune-brochure.pdf",
  "sushant-gurugram-brochure.pdf",
  "vsat-sample-paper.pdf",
  "vsat-prep-kit.pdf",
]);
const MAX_BYTES = 60 * 1024 * 1024; // 60 MB

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svcKey) return Response.json({ ok: false, error: "not configured" }, { status: 500 });

  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ ok: false, error: "bad form" }, { status: 400 }); }
  const token = String(form.get("accessToken") || "");
  const path = String(form.get("path") || "");
  const file = form.get("file");
  if (!token) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });
  if (!ALLOWED.has(path)) return Response.json({ ok: false, error: "bad_path" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ ok: false, error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ ok: false, error: "too_large" }, { status: 413 });

  // verify the caller is an admin
  const asUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: u, error: uErr } = await asUser.auth.getUser(token);
  if (uErr || !u?.user?.id) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });
  let isAdmin = (u.user.email ?? "").toLowerCase().endsWith("@vedam.org") && !!u.user.email_confirmed_at;
  if (!isAdmin) { const { data } = await asUser.rpc("is_admin"); isAdmin = !!data; }
  if (!isAdmin) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });

  const svc = createClient(url, svcKey);
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await svc.storage.from("vsat-docs").upload(path, buf, {
    upsert: true, contentType: file.type || "application/pdf",
  });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, url: `${url}/storage/v1/object/public/vsat-docs/${path}`, bytes: file.size });
}
