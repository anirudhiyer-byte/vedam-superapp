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

const PALETTE = ["#8A18FF", "#F97D03", "#E80074", "#12b3a6", "#6E56CF", "#F5A623", "#4BE39B", "#FF6B6B", "#9AA0FF", "#2B135C"];
const istDay = (s: string) => new Date(s).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const dLabel = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const cell = (v: unknown) => Array.isArray(v) ? v.join(", ") : v == null || v === "" ? "—" : String(v);

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

  // Filterable columns = fixed fields + any custom registration question (answers keys)
  const columns = useMemo<Col[]>(() => {
    const base: Col[] = [
      { key: "utm_source", label: "Source", get: (r) => r.utm_source || "organic" },
      { key: "utm_medium", label: "Medium", get: (r) => r.utm_medium || "—" },
      { key: "utm_campaign", label: "Campaign", get: (r) => r.utm_campaign || "—" },
      { key: "stream", label: "Stream", get: (r) => cell(r.stream) },
      { key: "passout_year", label: "Passout year", get: (r) => cell(r.passout_year) },
      { key: "joined", label: "Attended", get: (r) => (r.joined ? "Yes" : "No") },
    ];
    const answerKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r.answers ?? {}))));
    const custom: Col[] = answerKeys.map((k) => ({ key: "a:" + k, label: k, get: (r) => cell(r.answers?.[k]) }));
    return [...base, ...custom];
  }, [rows]);

  const colOf = (key: string) => columns.find((c) => c.key === key)!;
  const distinct = (key: string) => Array.from(new Set(rows.map((r) => colOf(key).get(r)))).sort();

  // Segment = rows matching every active filter (AND across columns, OR within a column)
  const seg = useMemo(() => rows.filter((r) =>
    filters.every((f) => !f.values.length || f.values.includes(colOf(f.key).get(r)))
  ), [rows, filters, columns]); // eslint-disable-line react-hooks/exhaustive-deps

  const segTotal = seg.length;
  const unique = useMemo(() => new Set(seg.map((r) => r.user_id || r.user_email)).size, [seg]);
  const latest = useMemo(() => seg.reduce((m, r) => (r.created_at > m ? r.created_at : m), ""), [seg]);

  const bySource = useMemo(() => {
    const m = new Map<string, number>();
    seg.forEach((r) => { const k = r.utm_source || "organic"; m.set(k, (m.get(k) || 0) + 1); });
    return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
      .map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] }));
  }, [seg]);

  const cohort = useMemo(() => {
    const m = new Map<string, number>();
    seg.forEach((r) => { const d = istDay(r.created_at); m.set(d, (m.get(d) || 0) + 1); });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [seg]);
  const cohortMax = Math.max(1, ...cohort.map(([, v]) => v));

  const selCls = "rounded-lg border border-border bg-surface px-3 py-2 font-body text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";
  const addable = columns.filter((c) => !filters.some((f) => f.key === c.key));
  const toggleVal = (key: string, v: string) => setFilters((fs) => fs.map((f) => f.key === key
    ? { ...f, values: f.values.includes(v) ? f.values.filter((x) => x !== v) : [...f.values, v] } : f));

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// analytics</span>
      <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-heading">Registrations</h1>
      <p className="mt-1 font-body text-sm text-muted">Pick an event and date range, then build a segment to define exactly who you&apos;re counting.</p>

      {/* scope */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={selCls}>
          <option value="all">All events</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <label className="flex items-center gap-2 font-mono text-xs text-muted">from<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={selCls} /></label>
        <label className="flex items-center gap-2 font-mono text-xs text-muted">to<input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={selCls} /></label>
      </div>

      {/* segment builder */}
      <div className="mt-5 rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-heading">Segment {filters.length > 0 && <span className="font-mono text-xs font-normal text-muted">(your MQL)</span>}</h3>
            <p className="mt-0.5 font-body text-xs text-muted">Add columns and pick values. Multiple values in a column = any of them; across columns = all must match.</p>
          </div>
          <div className="flex items-center gap-2">
            {filters.length > 0 && <button onClick={() => setFilters([])} className="font-mono text-xs text-muted hover:text-foreground">clear</button>}
            <select value="" onChange={(e) => e.target.value && setFilters((fs) => [...fs, { key: e.target.value, values: [] }])} className={selCls}>
              <option value="">+ add filter…</option>
              {addable.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {filters.length > 0 && (
          <div className="mt-4 space-y-3">
            {filters.map((f) => (
              <div key={f.key} className="rounded-xl border border-border bg-background p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wide text-accent">{colOf(f.key).label}</span>
                  <button onClick={() => setFilters((fs) => fs.filter((x) => x.key !== f.key))} className="font-mono text-xs text-muted hover:text-foreground">remove</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {distinct(f.key).map((v) => (
                    <button key={v} onClick={() => toggleVal(f.key, v)}
                      className={["rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors",
                        f.values.includes(v) ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted hover:text-foreground"].join(" ")}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="MQL — matching registrations" value={segTotal} accent />
        <Kpi label="Unique registrants" value={unique} />
        <Kpi label="Share of date range" text={rows.length ? `${Math.round((segTotal / rows.length) * 100)}%` : "—"} />
        <Kpi label="Latest registration" text={latest ? new Date(latest).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }) : "—"} />
      </div>

      {loading ? (
        <div className="mt-6 h-72 animate-pulse rounded-2xl border border-border bg-surface" />
      ) : segTotal === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <p className="font-display text-lg font-bold text-heading">No registrations match</p>
          <p className="mt-1 font-body text-sm text-muted">Widen the date range or loosen the segment filters.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[320px_1fr]">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h3 className="font-display text-base font-bold text-heading">By source</h3>
            <div className="mt-3 flex items-center justify-center"><Donut segments={bySource} total={segTotal} /></div>
            <div className="mt-4 space-y-1.5">
              {bySource.map((s) => (
                <div key={s.label} className="flex items-center gap-2 font-mono text-xs">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  <span className="flex-1 truncate text-foreground">{s.label}</span>
                  <span className="text-muted">{s.value}</span>
                  <span className="w-10 text-right text-muted">{Math.round((s.value / segTotal) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-base font-bold text-heading">Registrations per day</h3>
              <span className="font-mono text-xs text-muted">{cohort.length} day{cohort.length === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-4 flex h-56 items-end gap-1 overflow-x-auto pb-1">
              {cohort.map(([d, v]) => (
                <div key={d} className="flex min-w-[26px] flex-1 flex-col items-center gap-1">
                  <span className="font-mono text-[10px] text-muted">{v}</span>
                  <div className="w-full rounded-t bg-brand-gradient" style={{ height: `${(v / cohortMax) * 180}px` }} title={`${d}: ${v}`} />
                  <span className="font-mono text-[9px] text-muted" style={{ writingMode: cohort.length > 16 ? "vertical-rl" : undefined }}>{dLabel(d)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, text, accent }: { label: string; value?: number; text?: string; accent?: boolean }) {
  return (
    <div className={["rounded-2xl border border-border p-4", accent ? "bg-brand-gradient text-white" : "bg-surface"].join(" ")}>
      <div className={["font-mono text-[10px] font-semibold uppercase tracking-wide", accent ? "text-white/80" : "text-muted"].join(" ")}>{label}</div>
      <div className={["mt-1 font-display text-2xl font-extrabold", accent ? "text-white" : "text-heading"].join(" ")}>{text ?? (value ?? 0).toLocaleString("en-IN")}</div>
    </div>
  );
}

function Donut({ segments, total }: { segments: { label: string; value: number; color: string }[]; total: number }) {
  const r = 54, C = 2 * Math.PI * r; let acc = 0;
  return (
    <svg viewBox="0 0 140 140" width="160" height="160">
      <g transform="rotate(-90 70 70)">
        <circle cx="70" cy="70" r={r} fill="none" stroke="rgb(var(--surface-warm))" strokeWidth="20" />
        {segments.map((s) => {
          const len = (s.value / total) * C;
          const el = <circle key={s.label} cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth="20" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />;
          acc += len; return el;
        })}
      </g>
      <text x="70" y="66" textAnchor="middle" className="fill-[rgb(var(--heading))]" style={{ font: "800 22px Outfit, sans-serif" }}>{total}</text>
      <text x="70" y="84" textAnchor="middle" className="fill-[rgb(var(--muted))]" style={{ font: "600 10px 'JetBrains Mono', monospace" }}>regs</text>
    </svg>
  );
}
