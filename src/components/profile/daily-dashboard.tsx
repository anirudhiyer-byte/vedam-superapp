"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { day: string; traffic: number; traffic_new: number; traffic_returning: number; attempted: number; partial_reg: number; full_reg: number; bootcamp: number; codesprint: number; dropoff: number };
type Person = { full_name: string | null; email: string | null; phone: string | null; extra: string | null; when_at: string | null };
type Utm = { utm_source: string; cnt: number };
type SrcPage = { source: string; page: string; page_label: string; visitors: number; attempted: number; registered: number; attempt_pct: number; reg_pct: number };
type Click = { label: string; path: string; clicks: number; sessions: number };
type Flow = { page: string; page_label: string; visitors: number; exits: number; exit_pct: number };
type Kind = "new" | "returning" | "attempted" | "partial" | "full" | "bootcamp" | "codesprint" | "dropoff";

const iso = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const fdate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const PIE = ["#00cfe5", "#8A18FF", "#F97D03", "#22e06a", "#ff2fb0", "#f5c542", "#2f9bff", "#9b9b9b"];

export function DailyDashboard() {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 13); return iso(d); });
  const [to, setTo] = useState(() => iso(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [utm, setUtm] = useState<Utm[]>([]);
  const [bySourcePage, setBySourcePage] = useState<SrcPage[]>([]);
  const [expandedSrc, setExpandedSrc] = useState<Set<string>>(new Set());
  const [clicks, setClicks] = useState<Click[]>([]);
  const [flow, setFlow] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(false);
  const [openKpi, setOpenKpi] = useState<Kind | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [pplLoading, setPplLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setOpenKpi(null);
    const sb = createClient();
    const [{ data: d }, { data: u }, { data: bs }, { data: ck }, { data: pf }] = await Promise.all([
      sb.rpc("daily_funnel", { p_from: from, p_to: to }),
      sb.rpc("funnel_utm", { p_from: from, p_to: to }),
      sb.rpc("funnel_by_source_page", { p_from: from, p_to: to }),
      sb.rpc("clicks_summary", { p_from: from, p_to: to }),
      sb.rpc("page_flow", { p_from: from, p_to: to }),
    ]);
    setRows((d as Row[]) ?? []); setUtm((u as Utm[]) ?? []); setBySourcePage((bs as SrcPage[]) ?? []); setExpandedSrc(new Set()); setClicks((ck as Click[]) ?? []); setFlow((pf as Flow[]) ?? []); setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const t = useMemo(() => rows.reduce((a, r) => ({
    traffic: a.traffic + r.traffic, tnew: a.tnew + r.traffic_new, tret: a.tret + r.traffic_returning, attempted: a.attempted + r.attempted, partial: a.partial + r.partial_reg,
    full: a.full + r.full_reg, bootcamp: a.bootcamp + r.bootcamp, codesprint: a.codesprint + r.codesprint, dropoff: a.dropoff + r.dropoff,
  }), { traffic: 0, tnew: 0, tret: 0, attempted: 0, partial: 0, full: 0, bootcamp: 0, codesprint: 0, dropoff: 0 }), [rows]);
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

  const srcParents = useMemo(() => {
    const m = new Map<string, { source: string; visitors: number; attempted: number; registered: number }>();
    bySourcePage.forEach((r) => { const q = m.get(r.source) ?? { source: r.source, visitors: 0, attempted: 0, registered: 0 }; q.visitors += r.visitors; q.attempted += r.attempted; q.registered += r.registered; m.set(r.source, q); });
    return Array.from(m.values()).sort((a, b) => b.visitors - a.visitors);
  }, [bySourcePage]);
  const toggleSrc = (src: string) => setExpandedSrc((s0) => { const n = new Set(s0); n.has(src) ? n.delete(src) : n.add(src); return n; });

  async function openDetail(k: Kind) {
    if (openKpi === k) { setOpenKpi(null); return; }
    setOpenKpi(k); setPplLoading(true);
    const { data } = await createClient().rpc("funnel_people", { p_from: from, p_to: to, p_kind: k });
    setPeople((data as Person[]) ?? []); setPplLoading(false);
  }

  const utmTotal = utm.reduce((s, u) => s + u.cnt, 0);
  let acc = 0;
  const slices = utm.map((u, i) => {
    const a0 = (acc / (utmTotal || 1)) * 2 * Math.PI; acc += u.cnt;
    const a1 = (acc / (utmTotal || 1)) * 2 * Math.PI;
    const x0 = 80 + 74 * Math.sin(a0), y0 = 80 - 74 * Math.cos(a0);
    const x1 = 80 + 74 * Math.sin(a1), y1 = 80 - 74 * Math.cos(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return { d: `M80 80 L${x0.toFixed(1)} ${y0.toFixed(1)} A74 74 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`, c: PIE[i % PIE.length], u };
  });

  return (
    <div className="text-white">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="text-xs text-white/60">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white [color-scheme:dark]" /></label>
        <label className="text-xs text-white/60">To<input type="date" value={to} min={from} max={iso(new Date())} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white [color-scheme:dark]" /></label>
        {loading && <span className="pb-2 text-xs text-white/50">loading…</span>}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="New visitors" value={t.tnew} onClick={() => openDetail("new")} active={openKpi === "new"} />
        <Kpi label="Returning visitors" value={t.tret} onClick={() => openDetail("returning")} active={openKpi === "returning"} />
        <Kpi label="Attempted reg." value={t.attempted} sub={`${pct(t.attempted, t.traffic)}% of traffic`} onClick={() => openDetail("attempted")} active={openKpi === "attempted"} />
        <Kpi label="Registered partial" value={t.partial} onClick={() => openDetail("partial")} active={openKpi === "partial"} />
        <Kpi label="Registered full" value={t.full} accent onClick={() => openDetail("full")} active={openKpi === "full"} />
        <Kpi label="Drop-off" value={t.dropoff} sub={`${pct(t.dropoff, t.attempted)}% of attempts`} onClick={() => openDetail("dropoff")} active={openKpi === "dropoff"} />
        <Kpi label="Bootcamp regs" value={t.bootcamp} onClick={() => openDetail("bootcamp")} active={openKpi === "bootcamp"} />
        <Kpi label="CodeSprint enrols" value={t.codesprint} onClick={() => openDetail("codesprint")} active={openKpi === "codesprint"} />
      </div>

      {openKpi && (
        <div className="mb-6 overflow-x-auto rounded-2xl border border-white/12 bg-white/[0.04]">
          <div className="flex items-center justify-between p-3"><span className="text-sm font-bold capitalize">{openKpi} · {people.length}</span><button onClick={() => setOpenKpi(null)} className="text-xs font-semibold text-[#00cfe5]">close ✕</button></div>
          {pplLoading ? <div className="p-6 text-center text-white/50">Loading…</div> : (
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.05] text-white/60"><tr>{["Name", "Email", "Phone", "Detail", "When"].map((h) => <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{people.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-white/50">No rows.</td></tr> : people.map((p, i) => (
                <tr key={i} className="border-t border-white/8"><td className="whitespace-nowrap p-2">{p.full_name ?? "—"}</td><td className="whitespace-nowrap p-2 text-white/80">{p.email ?? "—"}</td><td className="whitespace-nowrap p-2 text-white/80">{p.phone ?? "—"}</td><td className="whitespace-nowrap p-2 text-white/70">{p.extra ?? "—"}</td><td className="whitespace-nowrap p-2 text-white/60">{p.when_at ? new Date(p.when_at).toLocaleDateString("en-IN") : "—"}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="overflow-x-auto rounded-2xl border border-white/12 bg-white/[0.04]">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.05] text-white/60"><tr>{["Date", "New", "Returning", "Attempted", "→Reg %", "Partial", "Full", "Drop-off", "Drop %", "Bootcamp", "CodeSprint"].map((h) => <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.day} className="border-t border-white/8">
                <td className="whitespace-nowrap p-2 font-semibold">{fdate(r.day)}</td>
                <td className="p-2">{r.traffic_new}</td><td className="p-2">{r.traffic_returning}</td><td className="p-2">{r.attempted}</td><td className="p-2 text-white/70">{pct(r.attempted, r.traffic)}%</td>
                <td className="p-2">{r.partial_reg}</td><td className="p-2 font-semibold text-[#22e06a]">{r.full_reg}</td>
                <td className="p-2">{r.dropoff}</td><td className="p-2 text-white/70">{pct(r.dropoff, r.attempted)}%</td>
                <td className="p-2">{r.bootcamp}</td><td className="p-2">{r.codesprint}</td>
              </tr>
            ))}{rows.length === 0 && <tr><td colSpan={11} className="p-6 text-center text-white/50">No data in range.</td></tr>}</tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-4">
          <p className="mb-3 text-sm font-bold">UTM sources <span className="font-normal text-white/50">(registrations)</span></p>
          {utmTotal === 0 ? <p className="text-xs text-white/50">No registrations in range.</p> : (
            <div className="flex flex-col items-center gap-3">
              <svg viewBox="0 0 160 160" className="h-40 w-40">{slices.map((s, i) => <path key={i} d={s.d} fill={s.c} />)}</svg>
              <div className="w-full space-y-1">{utm.map((u, i) => (
                <div key={u.utm_source} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PIE[i % PIE.length] }} />{u.utm_source}</span><span className="text-white/70">{u.cnt} · {pct(u.cnt, utmTotal)}%</span></div>
              ))}</div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-white/12 bg-white/[0.04]">
        <div className="p-3 text-sm font-bold">Funnel by source → landing page <span className="font-normal text-white/50">— click a source to split by the page they landed on</span></div>
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.05] text-white/60"><tr>{["Source / Landing page", "Visitors", "Attempted", "→Attempt %", "Registered", "→Reg %"].map((h) => <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{srcParents.map((p0) => (
            <Fragment key={p0.source}>
              <tr onClick={() => toggleSrc(p0.source)} className="cursor-pointer border-t border-white/10 hover:bg-white/[0.04]">
                <td className="whitespace-nowrap p-2 font-semibold">{expandedSrc.has(p0.source) ? "▾" : "▸"} {p0.source}</td>
                <td className="p-2">{p0.visitors}</td>
                <td className="p-2">{p0.attempted}</td>
                <td className="p-2 text-white/70">{p0.visitors ? Math.round((p0.attempted / p0.visitors) * 100) : 0}%</td>
                <td className="p-2 font-semibold text-[#22e06a]">{p0.registered}</td>
                <td className="p-2 text-white/70">{p0.attempted ? Math.round((p0.registered / p0.attempted) * 100) : 0}%</td>
              </tr>
              {expandedSrc.has(p0.source) && bySourcePage.filter((r) => r.source === p0.source).map((r) => (
                <tr key={r.source + r.page} className="bg-white/[0.02]">
                  <td className="whitespace-nowrap p-2 pl-6 text-white/75">└ {r.page_label}</td>
                  <td className="p-2 text-white/75">{r.visitors}</td>
                  <td className="p-2 text-white/75">{r.attempted}</td>
                  <td className="p-2 text-white/60">{r.attempt_pct}%</td>
                  <td className="p-2 text-[#22e06a]/85">{r.registered}</td>
                  <td className="p-2 text-white/60">{r.reg_pct}%</td>
                </tr>
              ))}
            </Fragment>
          ))}{srcParents.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-white/50">No source data in range.</td></tr>}</tbody>
        </table>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-white/12 bg-white/[0.04]">
        <div className="p-3 text-sm font-bold">Where visitors exit <span className="font-normal text-white/50">— which page they leave the site from (highest first)</span></div>
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.05] text-white/60"><tr>{["Page", "Visitors", "Exited here", "Exit rate"].map((h) => <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{flow.map((r) => (
            <tr key={r.page} className="border-t border-white/8">
              <td className="max-w-[240px] truncate p-2 font-semibold">{r.page_label}</td>
              <td className="p-2">{r.visitors}</td>
              <td className="p-2">{r.exits}</td>
              <td className="p-2">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${r.exit_pct}%`, background: r.exit_pct >= 70 ? "#ff4d6d" : r.exit_pct >= 40 ? "#f5a623" : "#22e06a" }} /></div>
                  <span className="text-white/70">{r.exit_pct}%</span>
                </div>
              </td>
            </tr>
          ))}{flow.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-white/50">No page data in range.</td></tr>}</tbody>
        </table>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-white/12 bg-white/[0.04]">
        <div className="p-3 text-sm font-bold">Top button clicks <span className="font-normal text-white/50">— which CTAs get engaged (autocaptured)</span></div>
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.05] text-white/60"><tr>{["Button / link", "Page", "Clicks", "Unique sessions"].map((h) => <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{clicks.map((c, i) => (
            <tr key={i} className="border-t border-white/8">
              <td className="max-w-[260px] truncate p-2 font-semibold">{c.label}</td>
              <td className="whitespace-nowrap p-2 text-white/70">{c.path}</td>
              <td className="p-2">{c.clicks}</td>
              <td className="p-2 text-white/70">{c.sessions}</td>
            </tr>
          ))}{clicks.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-white/50">No clicks yet — autocapture starts logging from deploy.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent, onClick, active }: { label: string; value: number; sub?: string; accent?: boolean; onClick?: () => void; active?: boolean }) {
  return (
    <div onClick={onClick} className={["rounded-2xl border p-4 transition-colors", onClick ? "cursor-pointer hover:border-[#00cfe5]" : "", active ? "border-[#00cfe5] ring-1 ring-[#00cfe5]" : "border-white/12", accent ? "bg-gradient-to-br from-[#00cfe5]/20 to-[#8A18FF]/20" : "bg-white/[0.04]"].join(" ")}>
      <p className="text-[11px] uppercase tracking-wide text-white/55">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{value.toLocaleString("en-IN")}</p>
      {sub && <p className="mt-0.5 text-[11px] text-white/50">{sub}</p>}
    </div>
  );
}
