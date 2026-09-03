import { createClient } from "@supabase/supabase-js";
import { waSendSingle } from "@/lib/whatsapp/client";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Cond = { field: string; op: string; value?: string; value2?: string };
type Branch = { kind: "if" | "elif" | "else"; match?: "all" | "any"; conditions?: Cond[]; template_ref: string; message_type?: string; variable_mapping?: { source: string; value?: string }[] };
type Journey = { id: string; enabled: boolean; channel: string; branches: Branch[] };
type Row = { id: string; name: string; phone: string | null; state: string | null; city: string | null; signup: string;
  events_reg: number; events_attended: number; cs_enrolled: boolean; cs_modules: number; cs_total: number; cp_used: boolean; points: number };

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function fieldVal(r: Row, f: string): number | boolean | string | Date {
  switch (f) {
    case "signup": return new Date(r.signup);
    case "state": return r.state || "";
    case "events_reg": return r.events_reg; case "events_attended": return r.events_attended;
    case "cs_enrolled": return r.cs_enrolled; case "cs_modules": return r.cs_modules;
    case "cs_completed_all": return r.cs_total > 0 && r.cs_modules >= r.cs_total;
    case "cp_used": return r.cp_used; case "points": return Number(r.points);
    default: return "";
  }
}
function condPass(r: Row, c: Cond): boolean {
  const v = fieldVal(r, c.field);
  if (typeof v === "boolean") return c.op === "is_true" ? v === true : v === false;
  if (v instanceof Date) { const t = v.getTime(); const a = c.value ? new Date(c.value).getTime() : 0; const b = c.value2 ? new Date(c.value2 + "T23:59:59").getTime() : 0;
    if (c.op === "before") return t < a; if (c.op === "after") return t > a; if (c.op === "between") return t >= a && t <= b; return false; }
  if (typeof v === "string") { const val = (c.value || "").toLowerCase(); const s = v.toLowerCase();
    if (c.op === "eq") return s === val; if (c.op === "ne") return s !== val; return false; }
  const n = v as number; const a = Number(c.value); const b = Number(c.value2);
  switch (c.op) { case "eq": return n === a; case "ne": return n !== a; case "gt": return n > a; case "lt": return n < a; case "gte": return n >= a; case "lte": return n <= a; case "between": return n >= a && n <= b; default: return false; }
}
function branchMatches(r: Row, br: Branch): boolean {
  if (br.kind === "else") return true;
  const cs = br.conditions || []; if (cs.length === 0) return false;
  return br.match === "any" ? cs.some((c) => condPass(r, c)) : cs.every((c) => condPass(r, c));
}
function sampleFor(mapping: { source: string; value?: string }[] | undefined, r: Row) {
  if (!mapping?.length) return undefined;
  const F: Record<string, string> = { name: r.name, state: r.state || "", city: r.city || "", phone: r.phone || "" };
  return { bodyvar: mapping.map((m) => m.source === "static" ? (m.value || "") : (F[m.source] ?? "")) };
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return new Response("unauthorized", { status: 401 });
  const sb = db();
  const { data: journeys } = await sb.from("comms_journeys").select("*").eq("enabled", true);
  const { data: aud } = await sb.rpc("comms_audience_all");
  const rows = (aud as Row[]) ?? [];
  let fired = 0;

  for (const j of (journeys ?? []) as Journey[]) {
    if ((j.channel || "whatsapp") !== "whatsapp") continue; // email journeys via email path (next stage)
    for (const r of rows) {
      if (!r.phone) continue;
      const idx = (j.branches || []).findIndex((br) => branchMatches(r, br));
      if (idx < 0) continue;
      const br = j.branches[idx];
      if (!br.template_ref) continue;
      // dedup: claim (journey,user,branch); on conflict → already fired
      const { error: claimErr } = await sb.from("comms_journey_runs").insert({ journey_id: j.id, user_id: r.id, branch_index: idx });
      if (claimErr) continue;
      const res = await waSendSingle({ to: r.phone, templateId: br.template_ref, messageType: br.message_type || "media", sample: sampleFor(br.variable_mapping, r) });
      const d = (res.data as { results?: { transaction_id?: string; cost?: number }[] })?.results?.[0];
      await sb.from("whatsapp_sends").insert({ to_number: r.phone, template_id: br.template_ref, message_type: br.message_type || "media", status: res.ok ? "sent" : "failed", http_status: res.status, provider_response: res.data as object, transaction_id: d?.transaction_id ?? null, cost: d?.cost ?? null });
      fired++;
    }
    await sb.from("comms_journeys").update({ last_run_at: new Date().toISOString() }).eq("id", j.id);
  }
  return Response.json({ ok: true, fired });
}
