"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Active = { dau: number; dau_prev: number; wau: number; wau_prev: number; mau: number; mau_prev: number };
const ZERO: Active = { dau: 0, dau_prev: 0, wau: 0, wau_prev: 0, mau: 0, mau_prev: 0 };

const ROWS: { key: "dau" | "wau" | "mau"; prev: "dau_prev" | "wau_prev" | "mau_prev"; label: string; tag: string }[] = [
  { key: "dau", prev: "dau_prev", label: "DAU", tag: "vs yesterday" },
  { key: "wau", prev: "wau_prev", label: "WAU", tag: "vs last week" },
  { key: "mau", prev: "mau_prev", label: "MAU", tag: "vs last month" },
];

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return <span className="text-white/30">—</span>;
  const pct = prev === 0 ? 100 : ((cur - prev) / prev) * 100;
  const up = cur >= prev;
  return <span className={up ? "text-[#22e06a]" : "text-[#ff6b6b]"}>{up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%</span>;
}

export function ActiveUsers({ product, title }: { product: "codesprint" | "bootcamp" | "site" | "pyq"; title: string }) {
  const [supabase] = useState(() => createClient());
  const [a, setA] = useState<Active>(ZERO);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase.rpc("dash_active_users", { p_product: product });
      const row = (Array.isArray(data) ? data[0] : data) as Active | undefined;
      if (active && row) setA({ dau: +row.dau, dau_prev: +row.dau_prev, wau: +row.wau, wau_prev: +row.wau_prev, mau: +row.mau, mau_prev: +row.mau_prev });
      const { data: tg } = await supabase.from("dash_targets").select("metric, target").eq("product", product);
      if (active && tg) { const t: Record<string, number> = {}; (tg as { metric: string; target: number }[]).forEach((x) => { t[x.metric] = Number(x.target); }); setTargets(t); }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [supabase, product]);

  const saveTarget = useCallback(async (metric: string, raw: string) => {
    const target = raw.trim() === "" ? null : Number(raw);
    setTargets((t) => ({ ...t, [metric]: target as number }));
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("dash_targets").upsert({ product, metric, target, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: "product,metric" });
  }, [supabase, product]);

  const cell = "px-3 py-3 text-center font-[family-name:var(--font-inter)] text-[15px] tabular-nums";
  const head = "px-3 py-2 text-center font-[family-name:var(--font-inter)] text-[12px] font-bold uppercase tracking-wide text-white/50";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-inter)] text-lg font-bold text-white">{title} — Active Users</h2>
        <span className="font-[family-name:var(--font-inter)] text-[12px] text-white/40">active = ≥5 min/day · Target editable</span>
      </div>
      {loading ? (
        <div className="h-40 animate-pulse rounded-xl border border-white/10 bg-white/[0.04]" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 text-left font-[family-name:var(--font-inter)] text-[12px] font-bold uppercase tracking-wide text-white/50">Metric</th>
                <th className={head}>Target</th>
                <th className={head}>Actual</th>
                <th className={head}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key} className="border-b border-white/[0.06] hover:bg-white/[0.02]">
                  <td className="px-3 py-3 text-left font-[family-name:var(--font-inter)] text-[15px] font-medium text-white">{r.label}</td>
                  <td className={cell}>
                    <input defaultValue={targets[r.key] ?? ""} onBlur={(e) => saveTarget(r.key, e.target.value)} inputMode="numeric"
                      className="w-24 rounded-md border border-white/15 bg-white/[0.05] px-2 py-1 text-center font-[family-name:var(--font-inter)] text-[15px] text-white outline-none focus:border-[#8A18FF]" placeholder="—" />
                  </td>
                  <td className={cell + " text-white"}>{a[r.key].toLocaleString("en-IN")}</td>
                  <td className={cell}><Delta cur={a[r.key]} prev={a[r.prev]} /> <span className="text-white/30 text-[11px]">{r.tag}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 font-[family-name:var(--font-inter)] text-[12px] leading-relaxed text-white/45">
            A user is active on {title} for a day if they spend ≥5 minutes on it (tracked via heartbeat). DAU = today · WAU = active on any day in the last 7 · MAU = last 30. Trend compares today vs yesterday, this week vs last, this month vs last.
          </p>
        </div>
      )}
    </section>
  );
}
