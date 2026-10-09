import { NextResponse } from "next/server";
import { svc, requireAdmin } from "@/lib/growth/api";

export const dynamic = "force-dynamic";

type EventRow = {
  id: string; kind: "auto" | "manual"; event_id: string | null;
  serial_no: number | null; event_page_link: string; event_name: string | null;
  linked_event: string | null; live_date: string | null; category: string | null; host: string | null;
  registered_count: number; utm_link: string | null;
  ad_spend: number; influencer_spend: number; comms_spend: number; telegram_spend: number;
  host_spend: number; price_spend: number;
  total_spend: number; leads: number; payments: number; enrollments: number;
  status: string | null; notes: string | null; is_trashed: boolean;
};

function num(v: unknown): number { if (v === "" || v === null || v === undefined) return 0; const n = Number(v); return Number.isFinite(n) ? n : 0; }
function numOrNull(v: unknown): number | null { if (v === "" || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
const SPENDS = ["ad_spend", "influencer_spend", "comms_spend", "telegram_spend", "host_spend", "price_spend"] as const;

function summarize(rows: EventRow[]) {
  const live = rows.filter((r) => !r.is_trashed);
  const sum = (f: (r: EventRow) => number) => live.reduce((a, r) => a + (Number(f(r)) || 0), 0);
  const registrations = sum((r) => r.registered_count);
  const leads = sum((r) => r.leads);
  const payments = sum((r) => r.payments);
  const totalSpend = sum((r) => r.total_spend);
  const adSpend = sum((r) => r.ad_spend), inflSpend = sum((r) => r.influencer_spend), tgSpend = sum((r) => r.telegram_spend);
  return {
    uniqueEvents: live.length,
    registrations, leads, payments,
    enrollments: sum((r) => r.enrollments),
    l2p: leads ? Number(((payments / leads) * 100).toFixed(2)) : 0,
    totalSpend,
    cpl: leads ? Math.round(totalSpend / leads) : 0,
    cpp: payments ? Math.round(totalSpend / payments) : 0,
    adSpend, inflSpend, tgSpend,
    commsSpend: sum((r) => r.comms_spend),
    hostSpend: sum((r) => r.host_spend),
    priceSpend: sum((r) => r.price_spend),
    // acquisition spend = (ads + telegram + influencer) / registrations; overall CPL = total spend / registrations
    acquisition: registrations ? Math.round((adSpend + tgSpend + inflSpend) / registrations) : 0,
    overallCpl: registrations ? Math.round(totalSpend / registrations) : 0,
  };
}

// GET ?view=active|trash -> { rows, summary, counts }
export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const view = new URL(req.url).searchParams.get("view") === "trash" ? "trash" : "active";
  const { data, error } = await svc().from("growth_events_view").select("*").order("live_date", { ascending: false, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const all = (data ?? []) as EventRow[];
  const rows = all.filter((r) => (view === "trash" ? r.is_trashed : !r.is_trashed));
  const counts = { active: all.filter((r) => !r.is_trashed).length, trash: all.filter((r) => r.is_trashed).length };
  return NextResponse.json({ rows, summary: summarize(all), counts });
}

// POST { manual bootcamp fields + spends } -> created row (event_id stays null)
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const b = await req.json().catch(() => ({}));
  if (!b.event_name && !b.manual_name) return NextResponse.json({ error: "event name is required" }, { status: 400 });
  const ins: Record<string, unknown> = {
    event_id: null, created_by: gate.userId,
    manual_name: b.event_name ?? b.manual_name ?? null,
    manual_page_link: b.event_page_link ?? b.manual_page_link ?? null,
    manual_date: b.live_date || null,
    manual_category: b.category ?? null,
    manual_host: b.host ?? null,
    linked_event: b.linked_event ?? null,
    utm_link: b.utm_link ?? null,
    notes: b.notes ?? null,
    serial_no: numOrNull(b.serial_no),
  };
  for (const k of SPENDS) ins[k] = num(b[k]);
  const { data, error } = await svc().from("growth_events_rows").insert(ins).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: row } = await svc().from("growth_events_view").select("*").eq("id", data.id).single();
  return NextResponse.json({ row });
}

// PATCH { id, kind, ...fields } -> updated row
export async function PATCH(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const b = await req.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const kind = b.kind === "manual" ? "manual" : "auto";
  const patch: Record<string, unknown> = {};
  for (const k of ["linked_event", "utm_link", "notes", "is_trashed"]) if (k in b) patch[k] = b[k];
  if ("serial_no" in b) patch.serial_no = numOrNull(b.serial_no);
  for (const k of SPENDS) if (k in b) patch[k] = num(b[k]);

  if (kind === "manual") {
    // manual rows own their identity too
    if ("event_name" in b) patch.manual_name = b.event_name ?? null;
    if ("event_page_link" in b) patch.manual_page_link = b.event_page_link ?? null;
    if ("live_date" in b) patch.manual_date = b.live_date || null;
    if ("category" in b) patch.manual_category = b.category ?? null;
    if ("host" in b) patch.manual_host = b.host ?? null;
    const { error } = await svc().from("growth_events_rows").update(patch).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // auto overlay: upsert by event_id (identity comes from the events table, read-only)
    const up = { ...patch, event_id: b.id, created_by: gate.userId };
    const { error } = await svc().from("growth_events_rows").upsert(up, { onConflict: "event_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data: row } = await svc().from("growth_events_view").select("*").eq("id", b.id).single();
  return NextResponse.json({ row });
}

// DELETE ?id=&kind=&hard=1
export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const kind = u.searchParams.get("kind") === "manual" ? "manual" : "auto";
  const hard = u.searchParams.get("hard") === "1";

  if (kind === "manual") {
    const q = hard
      ? svc().from("growth_events_rows").delete().eq("id", id)
      : svc().from("growth_events_rows").update({ is_trashed: true }).eq("id", id);
    const { error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // auto event can't be truly removed — just hide it via the overlay
    const { error } = await svc().from("growth_events_rows").upsert({ event_id: id, is_trashed: true, created_by: gate.userId }, { onConflict: "event_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
