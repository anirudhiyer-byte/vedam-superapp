"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Reg = {
  created_at: string; user_id: string | null; user_email: string | null; whatsapp: string | null;
  stream: string | null; passout_year: string | null; joined: boolean | null;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  answers: Record<string, unknown> | null; event_id: string | null;
};
type Ev = { id: string; name: string };
type Col = { key: string; label: string; get: (r: Reg) => string };

const PALETTE = ["#8A18FF", "#F97D03", "#12b3a6", "#E80074", "#6E56CF", "#F5A623", "#4BE39B", "#FF6B6B", "#9AA0FF", "#2B135C"];
const cell = (v: unknown) => Array.isArray(v) ? v.join(", ") : v == null || v === "" ? "—" : String(v);
const src = (r: Reg) => r.utm_source || "direct / none";
const med = (r: Reg) => r.utm_medium || "—";

export function Analytics() {
  const [supabase] = useState(() => createClient());
  const [events, setEvents] = useState<Ev[]>([]);
  const [rows, setRows] = useState<Reg[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventId, setEventId] = useState("all");
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [filters, setFilters] = useState<{ key: string; values: string[] }[]>([]);

  useEffect(() => { supabase.from("events").select("id,name").order("created_at", { ascending: false }).then(({ data }) => setEvents((data as Ev[]) ?? [])); }, [supabase]);

  useEffect(() => {
    let active = true; setLoading(true); setFilters([]);
    (async () => {
      let q = supabase.from("event_registrations")
        .select("created_at,user_id,user_email,whatsapp,stream,passout_year,joined,utm_source,utm_medium,utm_campaign,answers,event_id")
        .gte("created_at", from + "T00:00:00Z").lte("created_at", to + "T23:59:59Z");
      if (eventId !== "all") q = q.eq("event_id", eventId);
      const { data } = await q;
      if (active) { setRows((data as Reg[]) ?? []); setLoading(false); }
    })();
    return () => { active = false; };
  }, [supabase, eventId, from, to]);

  const columns = useMemo<Col[]>(() => {
    const base: Col[] = [
      { key: "utm_source", label: "Source", get: src },
      { key: "utm_medium", label: "Medium", get: med },
      { key: "utm_campaign", label: "Campaign", get: (r) => r.utm_campaign || "—" },
      { key: "stream", label: "Stream", get: (r) => cell(r.stream) },
      { key: "passout_year", label: "Passout year", get: (r) => cell(r.passout_year) },
      { key: "joined", label: "Attended", get: (r) => (r.joined ? "Yes" : "No") },
    ];
    const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r.answers ?? {}))));
    return [...base, ...keys.map((k) => ({ key: "a:" + k, label: k, get: (r: Reg) => cell(r.answers?.[k]) }))];
  }, [rows]);
  const colOf = (key: string) => columns.find((c) => c.key === key)!;
  const distinct = (key: string) => Array.from(new Set(rows.map((r) => colOf(key).get(r)))).sort();

  const seg = useMemo(() => rows.filter((r) => filters.every((f) => !f.values.length || f.values.includes(colOf(f.key).get(r)))), [rows, filters, columns]); // eslint-disable-line react-hooks/exhaustive-deps

  const unique = useMemo(() => new Set(seg.map((r) => r.user_id || r.user_email)).size, [seg]);
  const latest = useMemo(() => seg.reduce((m, r) => (r.created_at > m ? r.created_at : m), ""), [seg]);

  const bySource = useMemo(() => {
    const m = new Map<string, number>();
    seg.forEach((r) => m.set(src(r), (m.get(src(r)) || 0) + 1));
    return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] }));
  }, [seg]);
  const utmSources = bySource.length;
  const pie = useMemo(() => {
    let acc = 0; const t = seg.length || 1;
    return bySource.map((s) => { const start = acc; acc += (s.value / t) * 100; return `${s.color} ${start}% ${acc}%`; }).join(", ");
  }, [bySource, seg]);

  // Source × Medium matrix
  const matrix = useMemo(() => {
    const sources = bySource.map((s) => s.label);
    const meds = Array.from(new Set(seg.map(med)));
    const grid = new Map<string, number>();
    seg.forEach((r) => { const k = src(r) + "||" + med(r); grid.set(k, (grid.get(k) || 0) + 1); });
    return { sources, meds, get: (s: string, m: string) => grid.get(s + "||" + m) || 0 };
  }, [seg, bySource]);

  function exportCsv() {
    const headers = ["Registered", "Email", "Source", "Medium", "Campaign", "Stream", "Passout"];
    const lines = [headers, ...seg.map((r) => [new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), r.user_email ?? "", src(r), med(r), r.utm_campaign ?? "", r.stream ?? "", r.passout_year ?? ""])];
    const csv = lines.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "registrations.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  const selCls = "rounded-lg border border-border bg-surface px-3 py-2 font-body text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";
  const addable = columns.filter((c) => !filters.some((f) => f.key === c.key));
  const toggleVal = (key: string, v: string) => setFilters((fs) => fs.map((f) => f.key === key ? { ...f, values: f.values.includes(v) ? f.values.filter((x) => x !== v) : [...f.values, v] } : f));

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// analytics</span>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-heading">Registrations</h1>
          <p className="mt-1 font-body text-sm text-muted">Live registration health across every event.</p>
        </div>
        <button onClick={exportCsv} disabled={!seg.length} className="rounded-xl border border-border-strong px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-surface-warm disabled:opacity-50">↓ Export CSV</button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={selCls}>
          <option value="all">All events</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <label className="flex items-center gap-2 font-mono text-xs text-muted">from<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={selCls} /></label>
        <label className="flex items-center gap-2 font-mono text-xs text-muted">to<input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={selCls} /></label>
      </div>

      {/* segment builder */}
      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-body text-sm font-semibold text-heading">Segment (define your MQL) <span className="font-normal text-muted">— add columns &amp; pick values to narrow the count</span></span>
          <div className="flex items-center gap-2">
            {filters.length > 0 && <button onClick={() => setFilters([])} className="font-mono text-xs text-muted hover:text-foreground">clear</button>}
            <select value="" onChange={(e) => e.target.value && setFilters((fs) => [...fs, { key: e.target.value, values: [] }])} className={selCls}>
              <option value="">+ add filter…</option>
              {addable.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        </div>
        {filters.length > 0 && (
          <div className="mt-3 space-y-2">
            {filters.map((f) => (
              <div key={f.key} className="rounded-xl border border-border bg-background p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-accent">{colOf(f.key).label}</span>
                  <button onClick={() => setFilters((fs) => fs.filter((x) => x.key !== f.key))} className="font-mono text-[11px] text-muted hover:text-foreground">remove</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {distinct(f.key).map((v) => (
                    <button key={v} onClick={() => toggleVal(f.key, v)} className={["rounded-full px-2.5 py-1 font-mono text-[11px]", f.values.includes(v) ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted hover:text-foreground"].join(" ")}>{v}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi value={rows.length} label="Registrations" />
        <Kpi value={seg.length} label="MQL registrations" accent />
        <Kpi value={unique} label="Unique registrants" />
        <Kpi value={utmSources} label="UTM sources" />
        <Kpi text={latest ? new Date(latest).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "—"} label="Latest registration" />
      </div>

      {loading ? (
        <div className="mt-6 h-72 animate-pulse rounded-2xl border border-border bg-surface" />
      ) : seg.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <p className="font-display text-lg font-bold text-heading">No registrations match</p>
          <p className="mt-1 font-body text-sm text-muted">Widen the date range or loosen the segment.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {/* pie */}
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h3 className="font-display text-base font-bold text-heading">Registrations by UTM source</h3>
            <div className="mt-4 flex items-center gap-5">
              <div className="h-40 w-40 shrink-0 rounded-full" style={{ background: `conic-gradient(${pie})` }} />
              <div className="min-w-0 flex-1 space-y-1.5">
                {bySource.map((s) => (
                  <div key={s.label} className="flex items-center gap-2 font-mono text-xs">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                    <span className="flex-1 truncate text-foreground">{s.label}</span>
                    <span className="font-semibold text-heading">{s.value}</span>
                    <span className="w-9 text-right text-muted">{Math.round((s.value / seg.length) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* source x medium matrix */}
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h3 className="font-display text-base font-bold text-heading">Source × Medium matrix</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">Source</th>
                    {matrix.meds.map((m) => <th key={m} className="whitespace-nowrap px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{m}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matrix.sources.map((s) => (
                    <tr key={s} className="border-b border-border last:border-0">
                      <td className="whitespace-nowrap px-2 py-2.5 font-body text-sm font-medium text-heading">{s}</td>
                      {matrix.meds.map((m) => { const n = matrix.get(s, m); return <td key={m} className="px-2 py-2.5 font-mono text-xs text-foreground">{n || <span className="text-muted/30">·</span>}</td>; })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ value, text, label, accent }: { value?: number; text?: string; label: string; accent?: boolean }) {
  return (
    <div className={["rounded-2xl border border-border p-4", accent ? "bg-brand-gradient text-white" : "bg-surface"].join(" ")}>
      <div className={["font-display text-3xl font-extrabold", accent ? "text-white" : "text-heading"].join(" ")}>{text ?? (value ?? 0).toLocaleString("en-IN")}</div>
      <div className={["mt-1 font-body text-xs", accent ? "text-white/80" : "text-muted"].join(" ")}>{label}</div>
    </div>
  );
}
