import { NextResponse } from "next/server";
import { svc, requireAdmin } from "@/lib/growth/api";

export const dynamic = "force-dynamic";

type CostRow = {
  id: string; platform: string; name: string | null; utm_link: string | null;
  leads: number; mql: number; cpl_spend: number; total_cost: number; cpl: number | null;
  notes: string | null; sort_order: number; is_trashed: boolean;
  leads_override: number | null; mql_override: number | null; cpl_override: number | null;
  leads_auto: number | null; mql_auto: number | null;
};

/** "" / null / undefined -> null (auto-pull); anything else -> Number. */
function numOrNull(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function summarize(rows: CostRow[]) {
  const live = rows.filter((r) => !r.is_trashed);
  const total_leads = live.reduce((a, r) => a + (r.leads || 0), 0);
  const total_cost = live.reduce((a, r) => a + Number(r.total_cost || 0), 0);
  return {
    total_leads,
    total_mql: live.reduce((a, r) => a + (r.mql || 0), 0),
    total_cpl_spend: live.reduce((a, r) => a + Number(r.cpl_spend || 0), 0),
    total_cost,
    // Blended CPL = total cost / total leads (not an average of per-row CPLs)
    blended_cpl: total_leads > 0 ? Number((total_cost / total_leads).toFixed(2)) : 0,
    rows_count: live.length,
  };
}

// GET ?view=active|trash  -> { rows, summary }
export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const view = new URL(req.url).searchParams.get("view") === "trash" ? "trash" : "active";
  const { data, error } = await svc().from("growth_cs_cost_view").select("*").order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const all = (data ?? []) as CostRow[];
  const rows = all.filter((r) => (view === "trash" ? r.is_trashed : !r.is_trashed));
  const counts = { active: all.filter((r) => !r.is_trashed).length, trash: all.filter((r) => r.is_trashed).length };
  return NextResponse.json({ rows, summary: summarize(all), counts });
}

// POST { platform, name, utm_link, cpl_spend, total_cost, notes } -> created row (enriched)
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const b = await req.json().catch(() => ({}));
  if (!b.platform) return NextResponse.json({ error: "platform is required" }, { status: 400 });
  const ins = {
    platform: b.platform, name: b.name ?? null, utm_link: b.utm_link ?? null,
    cpl_spend: Number(b.cpl_spend) || 0, total_cost: Number(b.total_cost) || 0,
    leads_override: numOrNull(b.leads_override), mql_override: numOrNull(b.mql_override),
    cpl_override: numOrNull(b.cpl_override),
    notes: b.notes ?? null, created_by: gate.userId,
  };
  const { data, error } = await svc().from("growth_cs_cost_rows").insert(ins).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: row } = await svc().from("growth_cs_cost_view").select("*").eq("id", data.id).single();
  return NextResponse.json({ row });
}

// PATCH { id, ...fields }  -> updated row (enriched). Also used to restore (is_trashed:false).
export async function PATCH(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  for (const k of ["platform", "name", "utm_link", "notes", "sort_order", "is_trashed"]) if (k in b) patch[k] = b[k];
  for (const k of ["cpl_spend", "total_cost"]) if (k in b) patch[k] = Number(b[k]) || 0;
  for (const k of ["leads_override", "mql_override", "cpl_override"]) if (k in b) patch[k] = numOrNull(b[k]);
  const { error } = await svc().from("growth_cs_cost_rows").update(patch).eq("id", b.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: row } = await svc().from("growth_cs_cost_view").select("*").eq("id", b.id).single();
  return NextResponse.json({ row });
}

// DELETE ?id=...&hard=1  -> soft-trash (default) or hard delete
export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const hard = u.searchParams.get("hard") === "1";
  const q = hard
    ? svc().from("growth_cs_cost_rows").delete().eq("id", id)
    : svc().from("growth_cs_cost_rows").update({ is_trashed: true }).eq("id", id);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
