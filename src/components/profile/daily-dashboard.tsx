"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { day: string; new_visitors: number; returning_visitors: number; attempted_new: number; converted_new: number; dropoff_new: number; attempted_returning: number; partial_reg: number; full_reg: number; bootcamp: number; bootcamp_mql?: number; codesprint: number; codesprint_mql?: number };
type Totals = { new_visitors: number; returning_visitors: number; attempted_new: number; converted_new: number; dropoff_new: number; attempted_returning: number; accounts_created: number; registered_partial: number; registered_full: number; bootcamp: number; codesprint: number };
const ZERO_T: Totals = { new_visitors: 0, returning_visitors: 0, attempted_new: 0, converted_new: 0, dropoff_new: 0, attempted_returning: 0, accounts_created: 0, registered_partial: 0, registered_full: 0, bootcamp: 0, codesprint: 0 };
type Person = { full_name: string | null; email: string | null; phone: string | null; extra: string | null; when_at: string | null };
type Utm = { utm_source: string; cnt: number };
type SrcPage = { source: string; page: string; page_label: string; visitors: number; attempted: number; registered: number; attempt_pct: number; reg_pct: number };
type Click = { label: string; path: string; clicks: number; sessions: number };
type Flow = { page: string; page_label: string; visitors: number; exits_noreg: number; exits_reg: number; dropoff_exit_pct: number };
type Kind = "new" | "returning" | "attempted" | "converted" | "dropoff" | "attempted_returning" | "partial" | "full" | "bootcamp" | "codesprint";

const iso = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const fdate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const PIE = ["#00cfe5", "#8A18FF", "#F97D03", "#22e06a", "#ff2fb0", "#f5c542", "#2f9bff", "#9b9b9b"];

export function DailyDashboard() {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 13); return iso(d); });
  const [to, setTo] = useState(() => iso(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [tt, setTt] = useState<Totals | null>(null);
  const [utm, setUtm] = useState<Utm[]>([]);
  const [bySourcePage, setBySourcePage] = useState<SrcPage[]>([]);
  const [expandedSrc, setExpandedSrc] = useState<Set<string>>(new Set());
  const [clicks, setClicks] = useState<Click[]>([]);
  const [flow, setFlow] = useState<Flow[]>([]);
  const [showAllDates, setShowAllDates] = useState(false);
  const [insights, setInsights] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [openKpi, setOpenKpi] = useState<Kind | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [pplLoading, setPplLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setOpenKpi(null);
    const sb = createClient();
    const [{ data: d }, { data: tot }, { data: u }, { data: bs }, { data: ck }, { data: pf }] = await Promise.all([
      sb.rpc("daily_funnel", { p_from: from, p_to: to }),
      sb.rpc("funnel_totals", { p_from: from, p_to: to }),
      sb.rpc("funnel_utm", { p_from: from, p_to: to }),
      sb.rpc("funnel_by_source_page", { p_from: from, p_to: to }),
      sb.rpc("clicks_summary", { p_from: from, p_to: to }),
      sb.rpc("page_flow", { p_from: from, p_to: to }),
    ]);
    setRows((d as Row[]) ?? []); setTt(((tot as Totals[]) ?? [])[0] ?? null); setUtm((u as Utm[]) ?? []); setBySourcePage((bs as SrcPage[]) ?? []); setExpandedSrc(new Set()); setClicks((ck as Click[]) ?? []); setFlow((pf as Flow[]) ?? []); setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  // KPI totals come from funnel_totals (whole-range DISTINCT, correct cohort) — not summed per-day rows.
  const T = tt ?? ZERO_T;
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

  async function generateInsights() {
    if (aiLoading || cooldown > 0) return;
    setAiLoading(true); setAiErr(""); setInsights("");
    try {
      const res = await fetch("/api/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to }) });
      const j = await res.json();
      if (j.insights) setInsights(j.insights);
      else setAiErr((j.error || "Failed.") + (j.debug ? "  —  " + JSON.stringify(j.debug) : ""));
    } catch { setAiErr("Request failed."); }
    setAiLoading(false);
    setCooldown(30);
    const iv = setInterval(() => setCooldown((c) => { if (c <= 1) { clearInterval(iv); return 0; } return c - 1; }), 1000);
  }

  const utmTotal = utm.reduce((s, u) => s + u.cnt, 0);
  const visibleRows = showAllDates ? rows : rows.slice(0, 7);
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

      <div className="mb-6 rounded-2xl border border-[#8A18FF]/30 bg-gradient-to-br from-[#8A18FF]/10 to-[#00cfe5]/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-bold text-white">✨ AI insights</p><p className="text-[11px] text-white/55">Claude reads this range&apos;s funnel, sources, exits & clicks and returns prioritized fixes. On-demand only.</p></div>
          <button onClick={generateInsights} disabled={aiLoading || cooldown > 0} className="shrink-0 rounded-full bg-gradient-to-r from-[#8A18FF] to-[#00cfe5] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {aiLoading ? "Analyzing…" : cooldown > 0 ? `Wait ${cooldown}s` : "Generate insights"}
          </button>
        </div>
        {aiErr && <p className="mt-3 rounded-lg bg-[#ff4d6d]/15 p-2 text-xs text-[#ff9db0]">{aiErr}</p>}
        {insights && <div className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-4 text-[13px] leading-relaxed text-white/85">{insights}</div>}
      </div>

      {/* New-visitor web funnel: New → Attempted → Converted / Drop-off, all on the new-visitor base */}
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">New-visitor funnel <span className="font-normal normal-case text-white/35">· web visits tracked from 1 Oct</span></p>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="New visitors" value={T.new_visitors} onClick={() => openDetail("new")} active={openKpi === "new"} />
        <Kpi label="Attempted (new)" value={T.attempted_new} sub={`${pct(T.attempted_new, T.new_visitors)}% of new visitors`} onClick={() => openDetail("attempted")} active={openKpi === "attempted"} />
        <Kpi label="Converted (new)" value={T.converted_new} sub={`${pct(T.converted_new, T.attempted_new)}% of attempts`} accent onClick={() => openDetail("converted")} active={openKpi === "converted"} />
        <Kpi label="Drop-off (new)" value={T.dropoff_new} sub={`${pct(T.dropoff_new, T.attempted_new)}% of new attempts`} onClick={() => openDetail("dropoff")} active={openKpi === "dropoff"} />
      </div>
      {/* Returning + registrations (people-based) shown separately so nothing is mixed into the funnel above */}
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Returning & registrations</p>
      <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Returning visitors" value={T.returning_visitors} onClick={() => openDetail("returning")} active={openKpi === "returning"} />
        <Kpi label="Returning → opened register" value={T.attempted_returning} sub="existing accounts" onClick={() => openDetail("attempted_returning")} active={openKpi === "attempted_returning"} />
        <Kpi label="Registered partial" value={T.registered_partial} onClick={() => openDetail("partial")} active={openKpi === "partial"} />
        <Kpi label="Registered full" value={T.registered_full} onClick={() => openDetail("full")} active={openKpi === "full"} />
        <Kpi label="Accounts created (all paths)" value={T.accounts_created} sub="incl. VSAT / events / pre-tracking" />
        <Kpi label="Bootcamp regs" value={T.bootcamp} onClick={() => openDetail("bootcamp")} active={openKpi === "bootcamp"} />
        <Kpi label="CodeSprint enrols" value={T.codesprint} onClick={() => openDetail("codesprint")} active={openKpi === "codesprint"} />
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
            <thead className="bg-white/[0.05] text-white/60"><tr>{["Date", "New", "Returning", "Attempted (new)", "→Att %", "Converted", "Drop-off", "Drop %", "Ret→reg", "Partial", "Full", "Bootcamp", "Bootcamp MQL", "CodeSprint", "CodeSprint MQL"].map((h) => <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{visibleRows.map((r) => (
              <tr key={r.day} className="border-t border-white/8">
                <td className="whitespace-nowrap p-2 font-semibold">{fdate(r.day)}</td>
                <td className="p-2">{r.new_visitors}</td><td className="p-2">{r.returning_visitors}</td><td className="p-2">{r.attempted_new}</td><td className="p-2 text-white/70">{pct(r.attempted_new, r.new_visitors)}%</td>
                <td className="p-2 font-semibold text-[#22e06a]">{r.converted_new}</td>
                <td className="p-2">{r.dropoff_new}</td><td className="p-2 text-white/70">{pct(r.dropoff_new, r.attempted_new)}%</td>
                <td className="p-2 text-white/60">{r.attempted_returning}</td>
                <td className="p-2">{r.partial_reg}</td><td className="p-2 font-semibold text-[#22e06a]">{r.full_reg}</td>
                <td className="p-2">{r.bootcamp}</td><td className="p-2 text-[#22e06a]/80">{r.bootcamp_mql ?? 0}</td><td className="p-2">{r.codesprint}</td><td className="p-2 text-[#22e06a]/80">{r.codesprint_mql ?? 0}</td>
              </tr>
            ))}{rows.length === 0 && <tr><td colSpan={15} className="p-6 text-center text-white/50">No data in range.</td></tr>}</tbody>
          </table>
          {rows.length > 7 && (
            <button onClick={() => setShowAllDates((v) => !v)} className="w-full border-t border-white/8 py-2 text-center text-xs text-[#00cfe5] hover:bg-white/[0.03]">
              {showAllDates ? "Show last 7 days ↑" : `Show all ${rows.length} days ↓`}
            </button>
          )}
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
        <div className="p-3 text-sm font-bold">Where visitors drop off <span className="font-normal text-white/50">— left the site here WITHOUT registering (the real leak), ranked</span></div>
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.05] text-white/60"><tr>{["Page", "Visitors", "Exited without registering", "Exited after registering", "Drop-off exit %"].map((h) => <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{flow.map((r) => (
            <tr key={r.page} className="border-t border-white/8">
              <td className="max-w-[240px] truncate p-2 font-semibold">{r.page_label}</td>
              <td className="p-2">{r.visitors}</td>
              <td className="p-2 font-semibold text-[#ff9db0]">{r.exits_noreg}</td>
              <td className="p-2 text-white/50">{r.exits_reg}</td>
              <td className="p-2">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${r.dropoff_exit_pct}%`, background: r.dropoff_exit_pct >= 70 ? "#ff4d6d" : r.dropoff_exit_pct >= 40 ? "#f5a623" : "#22e06a" }} /></div>
                  <span className="text-white/70">{r.dropoff_exit_pct}%</span>
                </div>
              </td>
            </tr>
          ))}{flow.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-white/50">No page data in range.</td></tr>}</tbody>
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
