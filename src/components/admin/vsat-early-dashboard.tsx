"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { d: string; apply_visitors: number; fills: number; signups: number };
type Src = { source: string; medium: string; fills: number; signups: number; conv_pct: number; dropoffs: number };
const istToday = () => { const n = new Date(); const ist = new Date(n.getTime() + (330 + n.getTimezoneOffset()) * 60000); return ist.toISOString().slice(0, 10); };
const daysAgo = (n: number) => { const d = new Date(Date.now() - n * 864e5); const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60000); return ist.toISOString().slice(0, 10); };

export function VsatEarlyDashboard() {
  const [supabase] = useState(() => createClient());
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(istToday());
  const [rows, setRows] = useState<Row[]>([]);
  const [bySrc, setBySrc] = useState<Src[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: d }, { data: s }] = await Promise.all([
      supabase.rpc("vsat_er_daily", { p_from: from, p_to: to }),
      supabase.rpc("vsat_er_by_source", { p_from: from, p_to: to }),
    ]);
    setRows((d as Row[]) ?? []); setBySrc((s as Src[]) ?? []); setLoading(false);
  }, [supabase, from, to]);
  useEffect(() => { void load(); }, [load]);

  const t = useMemo(() => rows.reduce((a, r) => ({ v: a.v + r.apply_visitors, f: a.f + r.fills, s: a.s + r.signups }), { v: 0, f: 0, s: 0 }), [rows]);
  const totalDrop = useMemo(() => bySrc.reduce((a, r) => a + r.dropoffs, 0), [bySrc]);
  const conv = t.f > 0 ? Math.round((t.s / t.f) * 100) : 0;

  const KPI = ({ label, val, sub }: { label: string; val: string | number; sub?: string }) => (
    <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-4"><p className="text-xs text-white/50">{label}</p><p className="mt-1 text-2xl font-bold">{val}</p>{sub && <p className="text-[11px] text-white/40">{sub}</p>}</div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 text-white sm:px-8">
      <h1 className="font-display text-2xl font-bold">VSAT Early Registration</h1>
      <p className="mt-1 text-sm text-white/50">Form fills → registered, where they come from, and where it drops off. IST.</p>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="text-xs text-white/60">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm [color-scheme:dark]" /></label>
        <label className="text-xs text-white/60">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm [color-scheme:dark]" /></label>
        {loading && <span className="pb-2 text-xs text-white/50">loading…</span>}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPI label="Registered (signups)" val={t.s} />
        <KPI label="Form fills" val={t.f} sub="people who started on /apply" />
        <KPI label="Completion" val={`${conv}%`} sub="registered ÷ fills" />
        <KPI label="Drop-offs" val={totalDrop} sub="filled, didn't register" />
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-white/12 bg-white/[0.04]">
        <div className="p-3 text-sm font-bold">By source → medium <span className="font-normal text-white/50">— where early-reg comes from & where it leaks</span></div>
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.05] text-white/60"><tr>{["Source", "Medium", "Fills", "Registered", "Conv %", "Drop-offs"].map((h) => <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{bySrc.map((r, i) => (
            <tr key={i} className="border-t border-white/8">
              <td className="p-2 font-semibold">{r.source}</td><td className="p-2 text-white/70">{r.medium}</td>
              <td className="p-2">{r.fills}</td><td className="p-2 font-semibold text-[#22e06a]">{r.signups}</td>
              <td className="p-2"><div className="flex items-center gap-2"><div className="h-2 w-16 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${r.conv_pct}%`, background: r.conv_pct >= 40 ? "#22e06a" : r.conv_pct >= 15 ? "#f5a623" : "#ff4d6d" }} /></div><span className="text-white/70">{r.conv_pct}%</span></div></td>
              <td className="p-2 text-[#ff9db0]">{r.dropoffs}</td>
            </tr>
          ))}{bySrc.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-white/50">No early-reg data in range.</td></tr>}</tbody>
        </table>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-white/12 bg-white/[0.04]">
        <div className="p-3 text-sm font-bold">By date</div>
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.05] text-white/60"><tr>{["Date", "/apply visitors", "Fills", "Registered", "Conv %"].map((h) => <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{rows.filter((r) => r.apply_visitors || r.fills || r.signups).reverse().map((r) => (
            <tr key={r.d} className="border-t border-white/8">
              <td className="p-2">{r.d}</td><td className="p-2">{r.apply_visitors}</td><td className="p-2">{r.fills}</td><td className="p-2 font-semibold text-[#22e06a]">{r.signups}</td>
              <td className="p-2 text-white/70">{r.fills ? Math.round((r.signups / r.fills) * 100) : 0}%</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
