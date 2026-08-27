"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/events";

type DashRow = { day: string; spend: number | null; target: number | null };

const input = "w-28 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";

export function EventDashboard({ id }: { id: string }) {
  const [supabase] = useState(() => createClient());
  const [event, setEvent] = useState<EventRow | null>(null);
  const [rows, setRows] = useState<DashRow[]>([]);
  const [regCount, setRegCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: ev } = await supabase.from("events").select("*").eq("id", id).single();
      if (!active) return;
      setEvent((ev as EventRow) ?? null);
      const code = (ev as EventRow)?.event_code;
      if (code) {
        const { data: dash } = await supabase.from("event_dashboard").select("day, spend, target").eq("event_code", code).order("day");
        if (active) setRows((dash as DashRow[]) ?? []);
        const { count } = await supabase.from("event_registrations").select("id", { count: "exact", head: true }).eq("event_id", id);
        if (active) setRegCount(count ?? 0);
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [id, supabase]);

  const totals = useMemo(() => rows.reduce((a, r) => ({ spend: a.spend + (r.spend || 0), target: a.target + (r.target || 0) }), { spend: 0, target: 0 }), [rows]);
  const cpr = totals.spend && regCount ? (totals.spend / regCount) : 0;

  const upd = (i: number, patch: Partial<DashRow>) => setRows((s) => s.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addDay = () => setRows((s) => [...s, { day: new Date().toISOString().slice(0, 10), spend: null, target: null }]);
  const del = (i: number) => setRows((s) => s.filter((_, j) => j !== i));

  async function save() {
    if (!event) return;
    setSaving(true);
    const payload = rows.filter((r) => r.day).map((r) => ({ event_code: event.event_code, day: r.day, spend: r.spend, target: r.target }));
    if (payload.length) await supabase.from("event_dashboard").upsert(payload, { onConflict: "event_code,day" });
    setSaving(false);
  }

  if (loading) return <div className="mx-auto max-w-4xl px-6 py-10"><div className="h-64 animate-pulse rounded-2xl border border-border bg-surface" /></div>;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Registrations" value={String(regCount)} />
        <Stat label="Total spend" value={`₹${totals.spend.toLocaleString("en-IN")}`} />
        <Stat label="Total target" value={`₹${totals.target.toLocaleString("en-IN")}`} />
        <Stat label="Cost / reg" value={cpr ? `₹${cpr.toFixed(0)}` : "—"} />
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-heading">Daily ad spend vs target</h2>
          <button onClick={addDay} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-warm">+ Add day</button>
        </div>
        {rows.length === 0 ? (
          <p className="font-body text-sm text-muted">No spend rows yet. Add a day to start tracking.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input type="date" className={input + " w-40"} value={r.day} onChange={(e) => upd(i, { day: e.target.value })} />
                <span className="font-body text-xs text-muted">Spend ₹</span>
                <input type="number" className={input} value={r.spend ?? ""} onChange={(e) => upd(i, { spend: e.target.value === "" ? null : Number(e.target.value) })} />
                <span className="font-body text-xs text-muted">Target ₹</span>
                <input type="number" className={input} value={r.target ?? ""} onChange={(e) => upd(i, { target: e.target.value === "" ? null : Number(e.target.value) })} />
                <button onClick={() => del(i)} className="ml-auto rounded-md border border-red-400/40 px-2 py-1 text-xs text-red-500">Remove</button>
              </div>
            ))}
          </div>
        )}
        <button onClick={save} disabled={saving} className="mt-4 rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? "Saving…" : "Save spend"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-xl font-bold text-heading">{value}</div>
    </div>
  );
}
