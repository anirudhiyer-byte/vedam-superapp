/**
 * Calling CRM · TeleCMI webhook — call detail records (CDR) and live events.
 *
 * TeleCMI POSTs a JSON CDR when a call completes (and live events during a call) to the
 * URL we register in the TeleCMI dashboard. There is no signature, so the shared secret
 * lives in the PATH and must equal TELECMI_WEBHOOK_SECRET:
 *     POST|GET  https://<us>/api/telecmi/webhook/<secret>
 *
 * Each record is handed to calling_telecmi_ingest (migration 0147) via the service role —
 * the only caller allowed, so a browser can never fabricate a call record. Ingest matches
 * the call to a lead by phone and to the caller by TeleCMI agent id, and is tolerant:
 * an unmatched call is still stored. We accept a single object, a `cdr` array, or an array.
 */
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const preferredRegion = "bom1";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

type Rec = Record<string, unknown>;

/** Pull the call records out of whatever shape TeleCMI sent (single object, {cdr:[…]}, or an array). */
function records(payload: unknown): Rec[] {
  if (Array.isArray(payload)) return payload.filter((x): x is Rec => !!x && typeof x === "object");
  if (payload && typeof payload === "object") {
    const o = payload as Rec;
    if (Array.isArray(o.cdr)) return (o.cdr as unknown[]).filter((x): x is Rec => !!x && typeof x === "object");
    if (o.cmiuid || o.to || o.agent || o.status) return [o];
  }
  return [];
}

type Params = { params: Promise<{ secret: string }> };

async function handle(req: Request, { params }: Params): Promise<NextResponse> {
  const secret = process.env.TELECMI_WEBHOOK_SECRET;
  if (!secret) return json({ ok: false, code: "NOT_CONFIGURED" }, 503);
  const { secret: urlSecret } = await params;
  if (!timingSafeEq(urlSecret ?? "", secret)) return json({ ok: false, code: "FORBIDDEN" }, 403);

  // Accept the record(s) from the JSON body, a form field, or ?payload= / the query itself.
  let payload: unknown = null;
  const url = new URL(req.url);
  if (req.method === "POST") {
    const ctype = (req.headers.get("content-type") ?? "").toLowerCase();
    try {
      if (ctype.includes("application/json")) payload = await req.json();
      else {
        const form = await req.formData();
        const p = form.get("payload") ?? form.get("cdr") ?? form.get("data");
        payload = typeof p === "string" ? JSON.parse(p) : Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
      }
    } catch { /* fall through to query */ }
  }
  if (!payload) {
    const q = url.searchParams.get("payload") ?? url.searchParams.get("cdr");
    if (q) { try { payload = JSON.parse(q); } catch { /* ignore */ } }
    else if ([...url.searchParams.keys()].length) payload = Object.fromEntries(url.searchParams.entries());
  }

  const recs = records(payload);
  if (recs.length === 0) return json({ ok: true, ingested: 0 });

  const admin = adminDb();
  let ingested = 0;
  for (const rec of recs.slice(0, 200)) {
    const { data } = await admin.rpc("calling_telecmi_ingest", { p: rec });
    if ((data as { ok?: boolean } | null)?.ok) ingested += 1;
  }
  return json({ ok: true, ingested });
}

export async function POST(req: Request, ctx: Params) { return handle(req, ctx); }
export async function GET(req: Request, ctx: Params) { return handle(req, ctx); }
