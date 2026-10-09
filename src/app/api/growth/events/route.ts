import { NextResponse } from "next/server";
import { svc, requireAdmin } from "@/lib/growth/api";

export const dynamic = "force-dynamic";

type EventRow = {
  event_id: string; serial_no: number | null; event_page_link: string; event_name: string;
  linked_event: string | null; live_date: string | null; category: string | null; host: string | null;
  registered_count: number; utm_link: string | null;
  ad_spend: number; influencer_spend: number; comms_spend: number; telegram_spend: number; host_spend: number;
  total_spend: number; leads: number; payments: number; enrollments: number;
  status: string | null; notes: string | null; is_trashed: boolean;
};

function summarize(rows: EventRow[]) {
  const live = rows.filter((r) => !r.is_trashed);
  const sum = (f: (r: EventRow) => number) => live.reduce((a, r) => a + (Number(f(r)) || 0), 0);
  const registrations = sum((r) => r.registered_count);
  const leads = sum((r) => r.leads);
  const payments = sum((r) => r.payments);
  const totalSpend = sum((r) => r.total_spend);
  return {
    uniqueEvents: live.length,
    registrations, leads, payments,
    enrollments: sum((r) => r.enrollments),
    l2p: leads ? Number(((payments / leads) * 100).toFixed(2)) : 0,
    totalSpend,
    cpl: leads ? Math.round(totalSpend / leads) : 0,
    cpp: payments ? Math.round(totalSpend / payments) : 0,
    adSpend: sum((r) => r.ad_spend),
    inflSpend: sum((r) => r.influencer_spend),
    commsSpend: sum((r) => r.comms_spend),
    tgSpend: sum((r) => r.telegram_spend),
    hostSpend: sum((r) => r.host_spend),
  };
}

// GET ?view=active|trash -> { rows, summary }  (events auto-listed from the events table)
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

// PATCH { event_id, ...overlay fields } -> upsert the admin overlay, return enriched row.
export async function PATCH(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const b = await req.json().catch(() => ({}));
  if (!b.event_id) return NextResponse.json({ error: "event_id is required" }, { status: 400 });
  const up: Record<string, unknown> = { event_id: b.event_id, created_by: gate.userId };
  for (const k of ["linked_event", "utm_link", "notes", "is_trashed"]) if (k in b) up[k] = b[k];
  if ("serial_no" in b) up.serial_no = b.serial_no === "" || b.serial_no == null ? null : Number(b.serial_no);
  for (const k of ["ad_spend", "influencer_spend", "comms_spend", "telegram_spend", "host_spend"]) if (k in b) up[k] = Number(b[k]) || 0;
  const { error } = await svc().from("growth_events_rows").upsert(up, { onConflict: "event_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: row } = await svc().from("growth_events_view").select("*").eq("event_id", b.event_id).single();
  return NextResponse.json({ row });
}

// DELETE ?event_id=... -> trash from Growth only (does not touch the real event)
export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const eventId = new URL(req.url).searchParams.get("event_id");
  if (!eventId) return NextResponse.json({ error: "event_id is required" }, { status: 400 });
  const { error } = await svc().from("growth_events_rows").upsert({ event_id: eventId, is_trashed: true, created_by: gate.userId }, { onConflict: "event_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
