"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* ---------- IST date-range helpers (UTC+5:30) ---------- */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
// "now" as an IST wall-clock Date (its UTC fields read as IST values)
const istNow = () => new Date(Date.now() + IST_OFFSET_MS);
// convert an IST wall-clock Date back to a real UTC ISO string
const istToUtcIso = (d: Date) => new Date(d.getTime() - IST_OFFSET_MS).toISOString();
const startOfDayIst = (d: Date) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
// Monday-based week start
const startOfWeekIst = (d: Date) => { const x = startOfDayIst(d); const dow = (x.getUTCDay() + 6) % 7; return addDays(x, -dow); };
const startOfMonthIst = (d: Date) => { const x = startOfDayIst(d); x.setUTCDate(1); return x; };
const startOfYearIst = (d: Date) => { const x = startOfDayIst(d); x.setUTCMonth(0, 1); return x; };

type Range = { from: Date; to: Date };
const asRpc = (r: Range) => ({ p_from: istToUtcIso(r.from), p_to: istToUtcIso(r.to) });

type Funnel = {
  new_visitors: number; attempted: number; registered: number;
  registered_partial: number; registered_full: number; drop_off: number; mql: number;
};
const ZERO: Funnel = { new_visitors: 0, attempted: 0, registered: 0, registered_partial: 0, registered_full: 0, drop_off: 0, mql: 0 };

const ROWS: { key: keyof Funnel; label: string; sub?: boolean }[] = [
  { key: "new_visitors", label: "New Visitors" },
  { key: "attempted", label: "Attempted Registration" },
  { key: "registered", label: "Registered (partial + full)" },
  { key: "drop_off", label: "Drop off" },
  { key: "mql", label: "MQL" },
];

const fmt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-IN"));

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return <span className="text-white/30">—</span>;
  const pct = prev === 0 ? 100 : ((cur - prev) / prev) * 100;
  const up = cur >= prev;
  return (
    <span className={up ? "text-[#22e06a]" : "text-[#ff6b6b]"} title={`vs ${fmt(prev)} previous`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export function RegistrationFunnel() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [cols, setCols] = useState<Record<string, Funnel>>({});
  const [prev, setPrev] = useState<{ week: Funnel; month: Funnel }>({ week: ZERO, month: ZERO });
  const [weeks, setWeeks] = useState<{ label: string; data: Funnel }[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [manual, setManual] = useState<Record<string, number>>({}); // `${metric}:${year}` -> value

  const todayLabel = useMemo(
    () => istNow().toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }),
    []
  );

  const fetchOne = useCallback(async (r: Range): Promise<Funnel> => {
    const { data } = await supabase.rpc("dash_registration_funnel", asRpc(r));
    const row = (Array.isArray(data) ? data[0] : data) as Funnel | undefined;
    return row ?? ZERO;
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const now = istNow();
      const ftd: Range = { from: startOfDayIst(now), to: now };
      const wtd: Range = { from: startOfWeekIst(now), to: now };
      const mtd: Range = { from: startOfMonthIst(now), to: now };
      const ytd: Range = { from: startOfYearIst(now), to: now };
      // prior week / month, same-length-to-date (for WoW / MoM deltas)
      const lastWeek: Range = { from: addDays(wtd.from, -7), to: addDays(now, -7) };
      const lastMonth: Range = (() => {
        const f = new Date(mtd.from); f.setUTCMonth(f.getUTCMonth() - 1);
        const t = new Date(now); t.setUTCMonth(t.getUTCMonth() - 1);
        return { from: f, to: t };
      })();

      const [vFtd, vWtd, vMtd, vYtd, vLw, vLm] = await Promise.all([
        fetchOne(ftd), fetchOne(wtd), fetchOne(mtd), fetchOne(ytd), fetchOne(lastWeek), fetchOne(lastMonth),
      ]);
      if (!active) return;
      setCols({ FTD: vFtd, WTD: vWtd, MTD: vMtd, YTD: vYtd });
      setPrev({ week: vLw, month: vLm });

      // manual 2026/2025
      const { data: man } = await supabase.from("dash_manual").select("metric, period, value").eq("dashboard", "reg_funnel");
      if (active && man) {
        const m: Record<string, number> = {};
        (man as { metric: string; period: string; value: number }[]).forEach((x) => { m[`${x.metric}:${x.period}`] = Number(x.value); });
        setManual(m);
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [fetchOne, supabase]);

  // unfurl: weeks of the current month
  const loadWeeks = useCallback(async () => {
    if (expanded) { setExpanded(false); return; }
    const now = istNow();
    const mStart = startOfMonthIst(now);
    const out: { label: string; data: Funnel }[] = [];
    // iterate week buckets from the month start to now
    let cursor = mStart;
    let i = 1;
    while (cursor < now) {
      const wEnd = addDays(startOfWeekIst(cursor), 7);
      const from = cursor;
      const to = wEnd < now ? wEnd : now;
      // eslint-disable-next-line no-await-in-loop
      const data = await fetchOne({ from, to });
      out.push({ label: `W${i}`, data });
      cursor = to >= now ? now : wEnd;
      i++;
      if (i > 6) break;
    }
    setWeeks(out);
    setExpanded(true);
  }, [expanded, fetchOne]);

  const saveManual = useCallback(async (metric: string, year: string, raw: string) => {
    const value = raw.trim() === "" ? null : Number(raw);
    setManual((m) => ({ ...m, [`${metric}:${year}`]: value as number }));
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("dash_manual").upsert(
      { dashboard: "reg_funnel", metric, period: year, value, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString() },
      { onConflict: "dashboard,metric,period" }
    );
  }, [supabase]);

  const cell = "px-3 py-2.5 text-right font-mono text-sm tabular-nums";
  const head = "px-3 py-2 text-right font-body text-[11px] font-bold uppercase tracking-wide text-white/50";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-white">Registration Funnel</h2>
        <span className="font-mono text-[11px] text-white/40">live · all values auto except 2026/2025</span>
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 text-left font-body text-[11px] font-bold uppercase tracking-wide text-white/50">Metric</th>
                <th className={head}>FTD<div className="font-normal normal-case text-white/35">{todayLabel}</div></th>
                <th className={head + " cursor-pointer hover:text-white"} onClick={loadWeeks} title="Click to unfurl weeks">WTD ⤢</th>
                <th className={head + " cursor-pointer hover:text-white"} onClick={loadWeeks} title="Click to unfurl weeks">MTD ⤢</th>
                <th className={head}>YTD</th>
                <th className={head}>2026</th>
                <th className={head}>2025</th>
                {expanded && weeks.map((w) => <th key={w.label} className={head}>{w.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const ftd = cols.FTD?.[r.key] ?? 0;
                const wtd = cols.WTD?.[r.key] ?? 0;
                const mtd = cols.MTD?.[r.key] ?? 0;
                const ytd = cols.YTD?.[r.key] ?? 0;
                return (
                  <tr key={r.key} className="border-b border-white/[0.06] hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 text-left font-body text-sm font-medium text-white">
                      {r.label}
                      {r.key === "registered" && (
                        <span className="ml-2 font-mono text-[11px] text-white/40">
                          ({fmt(cols.MTD?.registered_partial)} partial · {fmt(cols.MTD?.registered_full)} full, MTD)
                        </span>
                      )}
                    </td>
                    <td className={cell + " text-white"}>{fmt(ftd)}</td>
                    <td className={cell + " text-white"}>
                      {fmt(wtd)}
                      <div className="text-[10px]"><Delta cur={wtd} prev={prev.week[r.key] as number} /> <span className="text-white/30">wk</span></div>
                    </td>
                    <td className={cell + " text-white"}>
                      {fmt(mtd)}
                      <div className="text-[10px]"><Delta cur={mtd} prev={prev.month[r.key] as number} /> <span className="text-white/30">mo</span></div>
                    </td>
                    <td className={cell + " text-white"}>{fmt(ytd)}</td>
                    <td className={cell}>
                      <input
                        defaultValue={manual[`${r.key}:2026`] ?? ""}
                        onBlur={(e) => saveManual(r.key, "2026", e.target.value)}
                        inputMode="numeric"
                        className="w-20 rounded-md border border-white/15 bg-white/[0.05] px-2 py-1 text-right font-mono text-sm text-white outline-none focus:border-[#8A18FF]"
                        placeholder="—"
                      />
                    </td>
                    <td className={cell}>
                      <input
                        defaultValue={manual[`${r.key}:2025`] ?? ""}
                        onBlur={(e) => saveManual(r.key, "2025", e.target.value)}
                        inputMode="numeric"
                        className="w-20 rounded-md border border-white/15 bg-white/[0.05] px-2 py-1 text-right font-mono text-sm text-white outline-none focus:border-[#8A18FF]"
                        placeholder="—"
                      />
                    </td>
                    {expanded && weeks.map((w) => {
                      const v = w.data[r.key] as number;
                      const share = mtd > 0 ? (v / mtd) * 100 : 0;
                      return (
                        <td key={w.label} className={cell + " text-white/80"}>
                          {fmt(v)}
                          <div className="text-[10px] text-white/35">{share.toFixed(0)}%</div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 font-body text-[11px] leading-relaxed text-white/40">
            FTD = today · WTD = week-to-date (Mon) · MTD = month-to-date · YTD = year-to-date (IST). ▲▼ compares WTD vs last week and MTD vs last month, same days-to-date. Click WTD/MTD to unfurl this month&apos;s weeks (value + share of month). 2026/2025 are your editable hard-data columns.
          </p>
        </div>
      )}
    </section>
  );
}
