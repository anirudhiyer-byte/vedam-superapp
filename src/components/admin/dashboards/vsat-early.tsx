"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const IST = 5.5 * 60 * 60 * 1000;
const istNow = () => new Date(Date.now() + IST);
const toUtc = (d: Date) => new Date(d.getTime() - IST).toISOString();
const sod = (d: Date) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };
const addD = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const sow = (d: Date) => { const x = sod(d); return addD(x, -((x.getUTCDay() + 6) % 7)); };
const som = (d: Date) => { const x = sod(d); x.setUTCDate(1); return x; };
const addM = (d: Date, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const EPOCH = new Date("2000-01-01T00:00:00Z");
const shortD = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
const monLbl = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "UTC", month: "short", year: "2-digit" });

type Vsat = { landings: number; leads: number; new_acc: number; existing_acc: number };
const ZERO: Vsat = { landings: 0, leads: 0, new_acc: 0, existing_acc: 0 };
type Range = { from: Date; to: Date };
const asRpc = (r: Range) => ({ p_from: toUtc(r.from), p_to: toUtc(r.to) });
const fmt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-IN"));

const ROWS: { key: keyof Vsat; label: string; sub?: string }[] = [
  { key: "landings", label: "Page Landings", sub: "unique sessions on /vsat" },
  { key: "leads", label: "Leads", sub: "clicked register & registered" },
  { key: "new_acc", label: "New Account", sub: "made account on /vsat" },
  { key: "existing_acc", label: "Existing Account", sub: "already had an account" },
];

const PIE = ["#8A18FF", "#00cfe5", "#F97D03", "#22e06a", "#ff6b6b", "#ffd166", "#c200db", "#7ad7ff"];

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return <span className="text-white/30">—</span>;
  const pct = prev === 0 ? 100 : ((cur - prev) / prev) * 100;
  const up = cur >= prev;
  return <span className={up ? "text-[#22e06a]" : "text-[#ff6b6b]"} title={`vs ${fmt(prev)}`}>{up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%</span>;
}

type Col =
  | { id: string; label: string; sublabel?: string; type: "period"; data: Vsat; prevData?: Vsat; prevTag?: string; clickable?: () => void; open?: boolean }
  | { id: string; label: string; type: "manual"; year: string };

function Donut({ data }: { data: { source: string; n: number }[] }) {
  const total = data.reduce((s, d) => s + d.n, 0);
  if (total === 0) return <div className="flex h-44 items-center justify-center text-[13px] text-white/40">No registrations yet</div>;
  const R = 70, r = 42, C = 90;
  let acc = 0;
  const segs = data.map((d, i) => {
    const frac = d.n / total;
    const a0 = acc * 2 * Math.PI - Math.PI / 2; acc += frac; const a1 = acc * 2 * Math.PI - Math.PI / 2;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0);
    const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
    const ix0 = C + r * Math.cos(a1), iy0 = C + r * Math.sin(a1);
    const ix1 = C + r * Math.cos(a0), iy1 = C + r * Math.sin(a0);
    const path = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${ix0} ${iy0} A ${r} ${r} 0 ${large} 0 ${ix1} ${iy1} Z`;
    return { path, color: PIE[i % PIE.length], source: d.source, n: d.n, pct: frac * 100 };
  });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 180 180" className="h-44 w-44 shrink-0">
        {segs.map((s, i) => <path key={i} d={s.path} fill={s.color} stroke="#0b0618" strokeWidth={1.5} />)}
        <text x={C} y={C - 4} textAnchor="middle" className="fill-white font-bold" fontSize={22}>{total}</text>
        <text x={C} y={C + 14} textAnchor="middle" className="fill-white/50" fontSize={10}>Leads</text>
      </svg>
      <ul className="min-w-[180px] flex-1 space-y-1.5">
        {segs.map((s, i) => (
          <li key={i} className="flex items-center gap-2 font-[family-name:var(--font-inter)] text-[13px] text-white/80">
            <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="flex-1 truncate">{s.source}</span>
            <span className="tabular-nums text-white/90">{s.n}</span>
            <span className="w-12 text-right tabular-nums text-white/40">{s.pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VsatEarly() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [base, setBase] = useState<{ ftd: Vsat; wtd: Vsat; mtd: Vsat; all: Vsat; lw: Vsat; lm: Vsat }>({ ftd: ZERO, wtd: ZERO, mtd: ZERO, all: ZERO, lw: ZERO, lm: ZERO });
  const [prevWeeks, setPrevWeeks] = useState<{ label: string; data: Vsat }[] | null>(null);
  const [prevMonths, setPrevMonths] = useState<{ label: string; data: Vsat }[] | null>(null);
  const [weeksOpen, setWeeksOpen] = useState(false);
  const [monthsOpen, setMonthsOpen] = useState(false);
  const [manual, setManual] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<{ source: string; n: number }[]>([]);
  const dashKey = "vsat_early";
  const todayLabel = useMemo(() => istNow().toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }), []);

  const fetchOne = useCallback(async (r: Range): Promise<Vsat> => {
    const { data } = await supabase.rpc("dash_vsat", asRpc(r));
    const row = (Array.isArray(data) ? data[0] : data) as Vsat | undefined;
    return row ? { landings: Number(row.landings), leads: Number(row.leads), new_acc: Number(row.new_acc), existing_acc: Number(row.existing_acc) } : ZERO;
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const now = istNow();
      const [ftd, wtd, mtd, all, lw, lm] = await Promise.all([
        fetchOne({ from: sod(now), to: now }),
        fetchOne({ from: sow(now), to: now }),
        fetchOne({ from: som(now), to: now }),
        fetchOne({ from: EPOCH, to: now }),
        fetchOne({ from: addD(sow(now), -7), to: addD(now, -7) }),
        fetchOne({ from: addM(som(now), -1), to: addM(now, -1) }),
      ]);
      if (!active) return;
      setBase({ ftd, wtd, mtd, all, lw, lm });
      const { data: src } = await supabase.rpc("dash_vsat_sources", asRpc({ from: EPOCH, to: now }));
      if (active && Array.isArray(src)) setSources((src as { source: string; n: number }[]).map((x) => ({ source: x.source, n: Number(x.n) })));
      const { data: man } = await supabase.from("dash_manual").select("metric, period, value").eq("dashboard", dashKey);
      if (active && man) {
        const m: Record<string, number> = {};
        (man as { metric: string; period: string; value: number }[]).forEach((x) => { m[`${x.metric}:${x.period}`] = Number(x.value); });
        setManual(m);
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [fetchOne, supabase]);

  const toggleWeeks = useCallback(async () => {
    if (weeksOpen) { setWeeksOpen(false); return; }
    if (!prevWeeks) {
      const now = istNow(); const cur = sow(now); const out: { label: string; data: Vsat }[] = [];
      for (let i = 1; i <= 4; i++) { const from = addD(cur, -7 * i); const to = addD(cur, -7 * (i - 1)); /* eslint-disable-next-line no-await-in-loop */ out.push({ label: `${shortD(from)}–${shortD(addD(to, -1))}`, data: await fetchOne({ from, to }) }); }
      setPrevWeeks(out);
    }
    setWeeksOpen(true);
  }, [weeksOpen, prevWeeks, fetchOne]);

  const toggleMonths = useCallback(async () => {
    if (monthsOpen) { setMonthsOpen(false); return; }
    if (!prevMonths) {
      const now = istNow(); const cur = som(now); const out: { label: string; data: Vsat }[] = [];
      for (let i = 1; i <= 4; i++) { const from = addM(cur, -i); const to = addM(cur, -(i - 1)); /* eslint-disable-next-line no-await-in-loop */ out.push({ label: monLbl(from), data: await fetchOne({ from, to }) }); }
      setPrevMonths(out);
    }
    setMonthsOpen(true);
  }, [monthsOpen, prevMonths, fetchOne]);

  const saveManual = useCallback(async (metric: string, year: string, raw: string) => {
    const value = raw.trim() === "" ? null : Number(raw);
    setManual((m) => ({ ...m, [`${metric}:${year}`]: value as number }));
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("dash_manual").upsert({ dashboard: dashKey, metric, period: year, value, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: "dashboard,metric,period" });
  }, [supabase]);

  const columns: Col[] = useMemo(() => {
    const cols: Col[] = [
      { id: "ftd", label: "FTD", sublabel: todayLabel, type: "period", data: base.ftd },
      { id: "wtd", label: "WTD ⤢", type: "period", data: base.wtd, prevData: base.lw, prevTag: "wk", clickable: toggleWeeks, open: weeksOpen },
    ];
    if (weeksOpen && prevWeeks) prevWeeks.forEach((w, i) => cols.push({ id: `w${i}`, label: w.label, type: "period", data: w.data, prevData: prevWeeks[i + 1]?.data, prevTag: "vs prev wk" }));
    cols.push({ id: "mtd", label: "MTD ⤢", type: "period", data: base.mtd, prevData: base.lm, prevTag: "mo", clickable: toggleMonths, open: monthsOpen });
    if (monthsOpen && prevMonths) prevMonths.forEach((m, i) => cols.push({ id: `m${i}`, label: m.label, type: "period", data: m.data, prevData: prevMonths[i + 1]?.data, prevTag: "vs prev mo" }));
    cols.push({ id: "all", label: "YTD", sublabel: "all-time", type: "period", data: base.all });
    cols.push({ id: "2026", label: "2026", type: "manual", year: "2026" });
    cols.push({ id: "2025", label: "2025", type: "manual", year: "2025" });
    return cols;
  }, [base, prevWeeks, prevMonths, weeksOpen, monthsOpen, todayLabel, toggleWeeks, toggleMonths]);

  const head = "px-3 py-2 text-center font-[family-name:var(--font-inter)] text-[12px] font-bold uppercase tracking-wide";
  const cell = "px-3 py-3 text-center font-[family-name:var(--font-inter)] text-[15px] tabular-nums";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-inter)] text-lg font-bold text-white">VSAT — Early Registrations</h2>
        <span className="font-[family-name:var(--font-inter)] text-[12px] text-white/40">2026/2025 editable</span>
      </div>
      {loading ? (
        <div className="h-56 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-3 py-2 text-left font-[family-name:var(--font-inter)] text-[12px] font-bold uppercase tracking-wide text-white/50">Metric</th>
                  {columns.map((c) => (
                    <th key={c.id} onClick={c.type === "period" ? c.clickable : undefined}
                      className={[head, c.type === "period" && c.clickable ? "cursor-pointer text-white/70 hover:text-white" : "text-white/50", c.type === "period" && c.open ? "text-[#8fe9f5]" : ""].join(" ")}>
                      {c.label}{c.type === "period" && c.sublabel && <div className="font-normal normal-case text-white/35">{c.sublabel}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.key} className="border-b border-white/[0.06] hover:bg-white/[0.02]">
                    <td className="px-3 py-3 text-left font-[family-name:var(--font-inter)] text-[15px] font-medium text-white">{r.label}{r.sub && <span className="ml-2 font-[family-name:var(--font-inter)] text-[12px] text-white/40">{r.sub}</span>}</td>
                    {columns.map((c) => {
                      if (c.type === "manual") return (
                        <td key={c.id} className={cell}>
                          <input defaultValue={manual[`${r.key}:${c.year}`] ?? ""} onBlur={(e) => saveManual(r.key, c.year, e.target.value)} inputMode="numeric"
                            className="w-20 rounded-md border border-white/15 bg-white/[0.05] px-2 py-1 text-center font-[family-name:var(--font-inter)] text-[15px] text-white outline-none focus:border-[#8A18FF]" placeholder="—" />
                        </td>
                      );
                      const v = c.data[r.key];
                      return (
                        <td key={c.id} className={cell + " text-white"}>
                          {fmt(v)}
                          {c.prevData && <div className="text-[11px]"><Delta cur={v} prev={c.prevData[r.key]} /> <span className="text-white/30">{c.prevTag}</span></div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h3 className="mb-3 font-[family-name:var(--font-inter)] text-[13px] font-bold uppercase tracking-wide text-white/60">Registrations by Source <span className="font-normal normal-case text-white/35">· all-time</span></h3>
            <Donut data={sources} />
          </div>
          <p className="mt-3 font-[family-name:var(--font-inter)] text-[12px] leading-relaxed text-white/45">
            Page Landings = unique sessions that viewed /vsat. Leads = users who clicked register on /vsat and completed VSAT registration. New Account = their account was created during a /vsat visit (same session); Existing Account = they already had an account. Source pie = VSAT registrations grouped by UTM source (all-time). Click WTD/MTD to unfurl previous weeks/months.
          </p>
        </>
      )}
    </section>
  );
}
