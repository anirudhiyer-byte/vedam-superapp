"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* ---------- IST date-range helpers (UTC+5:30) ---------- */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istNow = () => new Date(Date.now() + IST_OFFSET_MS);
const istToUtcIso = (d: Date) => new Date(d.getTime() - IST_OFFSET_MS).toISOString();
const startOfDayIst = (d: Date) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const startOfWeekIst = (d: Date) => { const x = startOfDayIst(d); const dow = (x.getUTCDay() + 6) % 7; return addDays(x, -dow); };
const startOfMonthIst = (d: Date) => { const x = startOfDayIst(d); x.setUTCDate(1); return x; };
const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const EPOCH = new Date("2000-01-01T00:00:00Z"); // "all-time" lower bound

type Range = { from: Date; to: Date };
const asRpc = (r: Range) => ({ p_from: istToUtcIso(r.from), p_to: istToUtcIso(r.to) });

type Funnel = {
  new_visitors: number; attempted: number; registered: number;
  registered_partial: number; registered_full: number; drop_off: number; mql: number;
};
const ZERO: Funnel = { new_visitors: 0, attempted: 0, registered: 0, registered_partial: 0, registered_full: 0, drop_off: 0, mql: 0 };

const ROWS: { key: keyof Funnel; label: string }[] = [
  { key: "new_visitors", label: "New Visitors" },
  { key: "attempted", label: "Attempted Registration" },
  { key: "registered", label: "Registered (partial + full)" },
  { key: "drop_off", label: "Drop off" },
  { key: "mql", label: "MQL" },
];

const fmt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-IN"));
const shortDate = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
const monthLabel = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "UTC", month: "short", year: "2-digit" });

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return <span className="text-white/30">—</span>;
  const pct = prev === 0 ? 100 : ((cur - prev) / prev) * 100;
  const up = cur >= prev;
  return (
    <span className={up ? "text-[#22e06a]" : "text-[#ff6b6b]"} title={`vs ${fmt(prev)}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

/* A rendered column: either a live period or an editable manual year */
type Col =
  | { id: string; label: string; sublabel?: string; type: "period"; data: Funnel; prevData?: Funnel; prevTag?: string; clickable?: () => void; open?: boolean }
  | { id: string; label: string; type: "manual"; year: string };

export function RegistrationFunnel() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [base, setBase] = useState<{ ftd: Funnel; wtd: Funnel; mtd: Funnel; all: Funnel; lastWeek: Funnel; lastMonth: Funnel }>({
    ftd: ZERO, wtd: ZERO, mtd: ZERO, all: ZERO, lastWeek: ZERO, lastMonth: ZERO,
  });
  const [prevWeeks, setPrevWeeks] = useState<{ label: string; data: Funnel }[] | null>(null);
  const [prevMonths, setPrevMonths] = useState<{ label: string; data: Funnel }[] | null>(null);
  const [weeksOpen, setWeeksOpen] = useState(false);
  const [monthsOpen, setMonthsOpen] = useState(false);
  const [manual, setManual] = useState<Record<string, number>>({});

  const todayLabel = useMemo(
    () => istNow().toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }),
    []
  );

  const fetchOne = useCallback(async (r: Range): Promise<Funnel> => {
    const { data } = await supabase.rpc("dash_registration_funnel", asRpc(r));
    return ((Array.isArray(data) ? data[0] : data) as Funnel | undefined) ?? ZERO;
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const now = istNow();
      const ftd: Range = { from: startOfDayIst(now), to: now };
      const wtd: Range = { from: startOfWeekIst(now), to: now };
      const mtd: Range = { from: startOfMonthIst(now), to: now };
      const all: Range = { from: EPOCH, to: now };
      const lastWeek: Range = { from: addDays(wtd.from, -7), to: addDays(now, -7) };
      const lastMonth: Range = { from: addMonths(mtd.from, -1), to: addMonths(now, -1) };

      const [a, b, c, d, e, f] = await Promise.all([
        fetchOne(ftd), fetchOne(wtd), fetchOne(mtd), fetchOne(all), fetchOne(lastWeek), fetchOne(lastMonth),
      ]);
      if (!active) return;
      setBase({ ftd: a, wtd: b, mtd: c, all: d, lastWeek: e, lastMonth: f });

      const { data: man } = await supabase.from("dash_manual").select("metric, period, value").eq("dashboard", "reg_funnel");
      if (active && man) {
        const m: Record<string, number> = {};
        (man as { metric: string; period: string; value: number }[]).forEach((x) => { m[`${x.metric}:${x.period}`] = Number(x.value); });
        setManual(m);
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [fetchOne]);

  // WTD → previous full weeks (most-recent first)
  const toggleWeeks = useCallback(async () => {
    if (weeksOpen) { setWeeksOpen(false); return; }
    if (!prevWeeks) {
      const now = istNow();
      const curStart = startOfWeekIst(now);
      const out: { label: string; data: Funnel }[] = [];
      for (let i = 1; i <= 4; i++) {
        const from = addDays(curStart, -7 * i);
        const to = addDays(curStart, -7 * (i - 1));
        // eslint-disable-next-line no-await-in-loop
        out.push({ label: `${shortDate(from)}–${shortDate(addDays(to, -1))}`, data: await fetchOne({ from, to }) });
      }
      setPrevWeeks(out);
    }
    setWeeksOpen(true);
  }, [weeksOpen, prevWeeks, fetchOne]);

  // MTD → previous full months (most-recent first)
  const toggleMonths = useCallback(async () => {
    if (monthsOpen) { setMonthsOpen(false); return; }
    if (!prevMonths) {
      const now = istNow();
      const curStart = startOfMonthIst(now);
      const out: { label: string; data: Funnel }[] = [];
      for (let i = 1; i <= 4; i++) {
        const from = addMonths(curStart, -i);
        const to = addMonths(curStart, -(i - 1));
        // eslint-disable-next-line no-await-in-loop
        out.push({ label: monthLabel(from), data: await fetchOne({ from, to }) });
      }
      setPrevMonths(out);
    }
    setMonthsOpen(true);
  }, [monthsOpen, prevMonths, fetchOne]);

  const saveManual = useCallback(async (metric: string, year: string, raw: string) => {
    const value = raw.trim() === "" ? null : Number(raw);
    setManual((m) => ({ ...m, [`${metric}:${year}`]: value as number }));
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("dash_manual").upsert(
      { dashboard: "reg_funnel", metric, period: year, value, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString() },
      { onConflict: "dashboard,metric,period" }
    );
  }, [supabase]);

  // assemble the ordered column list (unfurls inserted right after WTD / MTD)
  const columns: Col[] = useMemo(() => {
    const cols: Col[] = [
      { id: "ftd", label: "FTD", sublabel: todayLabel, type: "period", data: base.ftd },
      { id: "wtd", label: "WTD ⤢", type: "period", data: base.wtd, prevData: base.lastWeek, prevTag: "wk", clickable: toggleWeeks, open: weeksOpen },
    ];
    if (weeksOpen && prevWeeks) {
      prevWeeks.forEach((w, i) => cols.push({
        id: `w${i}`, label: w.label, type: "period", data: w.data,
        prevData: prevWeeks[i + 1]?.data, prevTag: "vs prev wk",
      }));
    }
    cols.push({ id: "mtd", label: "MTD ⤢", type: "period", data: base.mtd, prevData: base.lastMonth, prevTag: "mo", clickable: toggleMonths, open: monthsOpen });
    if (monthsOpen && prevMonths) {
      prevMonths.forEach((m, i) => cols.push({
        id: `m${i}`, label: m.label, type: "period", data: m.data,
        prevData: prevMonths[i + 1]?.data, prevTag: "vs prev mo",
      }));
    }
    cols.push({ id: "all", label: "YTD", sublabel: "all-time", type: "period", data: base.all });
    cols.push({ id: "2026", label: "2026", type: "manual", year: "2026" });
    cols.push({ id: "2025", label: "2025", type: "manual", year: "2025" });
    return cols;
  }, [base, prevWeeks, prevMonths, weeksOpen, monthsOpen, todayLabel, toggleWeeks, toggleMonths]);

  const headBase = "px-3 py-2 text-center font-[family-name:var(--font-inter)] text-[12px] font-bold uppercase tracking-wide";
  const cellBase = "px-3 py-3 text-center font-[family-name:var(--font-inter)] text-[15px] tabular-nums";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-inter)] text-lg font-bold text-white">Registration Funnel</h2>
        <span className="font-[family-name:var(--font-inter)] text-[12px] text-white/40">live · all auto except 2026/2025</span>
      </div>

      {loading ? (
        <div className="h-64 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 text-left font-[family-name:var(--font-inter)] text-[12px] font-bold uppercase tracking-wide text-white/50">Metric</th>
                {columns.map((c) => (
                  <th key={c.id}
                    onClick={c.type === "period" ? c.clickable : undefined}
                    className={[headBase, c.type === "period" && c.clickable ? "cursor-pointer text-white/70 hover:text-white" : "text-white/50",
                      c.type === "period" && c.open ? "text-[#8fe9f5]" : ""].join(" ")}>
                    {c.label}
                    {c.type === "period" && c.sublabel && <div className="font-normal normal-case text-white/35">{c.sublabel}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key} className="border-b border-white/[0.06] hover:bg-white/[0.02]">
                  <td className="px-3 py-3 text-left font-[family-name:var(--font-inter)] text-[15px] font-medium text-white">
                    {r.label}
                    {r.key === "registered" && (
                      <span className="ml-2 font-[family-name:var(--font-inter)] text-[12px] text-white/40">
                        ({fmt(base.mtd.registered_partial)} partial · {fmt(base.mtd.registered_full)} full, MTD)
                      </span>
                    )}
                  </td>
                  {columns.map((c) => {
                    if (c.type === "manual") {
                      return (
                        <td key={c.id} className={cellBase}>
                          <input
                            defaultValue={manual[`${r.key}:${c.year}`] ?? ""}
                            onBlur={(e) => saveManual(r.key, c.year, e.target.value)}
                            inputMode="numeric"
                            className="w-20 rounded-md border border-white/15 bg-white/[0.05] px-2 py-1 text-center font-[family-name:var(--font-inter)] text-[15px] text-white outline-none focus:border-[#8A18FF]"
                            placeholder="—"
                          />
                        </td>
                      );
                    }
                    const v = c.data[r.key] as number;
                    return (
                      <td key={c.id} className={cellBase + " text-white"}>
                        {fmt(v)}
                        {c.prevData && (
                          <div className="text-[11px]"><Delta cur={v} prev={c.prevData[r.key] as number} /> <span className="text-white/30">{c.prevTag}</span></div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 font-[family-name:var(--font-inter)] text-[12px] leading-relaxed text-white/45">
            FTD = today · WTD = week-to-date (Mon) · MTD = month-to-date (IST) · YTD = all data on record.
            New Visitors are tracked front-end sessions (beacon live since 30 Sep 2026); Registered counts actual signups (profiles),
            which can exceed tracked sessions — different sources, so the two columns aren&apos;t a strict funnel.
            ▲▼ = WTD vs last week / MTD vs last month (same days-to-date). Click <b>WTD</b> to unfurl previous weeks, <b>MTD</b> for previous months (each vs the one before it). 2026/2025 are editable hard-data.
          </p>
        </div>
      )}
    </section>
  );
}
