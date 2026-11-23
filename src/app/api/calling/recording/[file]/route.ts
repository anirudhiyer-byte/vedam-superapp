/**
 * Calling CRM · stream a TeleCMI call recording (callers + admins, own leads only).
 *
 * calling_call_events stores the recording's TeleCMI file name; its recording_url points
 * here. This route confirms the signed-in caller may hear it (calling_recording_ok, 0147 —
 * their own lead's call, or admin) and then proxies the audio from TeleCMI.
 *
 * The recording endpoint + credentials live in env (TELECMI_RECORDING_URL, a template with
 * a `{file}` placeholder). Until that is set the route returns NOT_CONFIGURED — nothing is
 * exposed and no URL is fabricated.
 */
import { NextResponse } from "next/server";
import { createClient as createCookieClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const preferredRegion = "bom1";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
const FILE_RE = /^[A-Za-z0-9._-]{1,128}$/;

type Params = { params: Promise<{ file: string }> };

export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const { file } = await params;
  if (!file || !FILE_RE.test(file)) return json({ ok: false, code: "INVALID" }, 400);

  const sb = await createCookieClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return json({ ok: false, code: "NOT_LOGGED_IN" }, 401);

  const { data, error } = await sb.rpc("calling_recording_ok", { p: { file } });
  if (error) return json({ ok: false, code: "FORBIDDEN" }, 403);
  if (!(data as { ok?: boolean } | null)?.ok) return json({ ok: false, code: "NOT_FOUND" }, 404);

  const tmpl = process.env.TELECMI_RECORDING_URL;
  if (!tmpl || !tmpl.includes("{file}")) return json({ ok: false, code: "NOT_CONFIGURED" }, 503);

  try {
    const upstream = await fetch(tmpl.replace("{file}", encodeURIComponent(file)), { signal: AbortSignal.timeout(20000) });
    if (!upstream.ok || !upstream.body) return json({ ok: false, code: "UPSTREAM_ERROR" }, 502);
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
        "cache-control": "private, max-age=3600",
        "content-disposition": `inline; filename="${file}"`,
      },
    });
  } catch {
    return json({ ok: false, code: "UPSTREAM_UNREACHABLE" }, 502);
  }
}
