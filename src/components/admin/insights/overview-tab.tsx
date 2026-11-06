"use client";

import { useEffect, useMemo, useState } from "react";
import { PERIODS, fmt, pct, periodRange, productLabel, shortDate, type PeriodKey } from "./lib";
import { sb, type Active, type Overview, type PeopleFilter } from "./data";
import { BLUE, Card, Delta, ErrorNote, Funnel, Insight, Loading, Stat } from "./ui";

/** Vedam One as a whole: the funnel for the chosen period, every period side by side, and active users. */
export function OverviewTab({ period, active, openPeople }: { period: PeriodKey; active: { data: Active | null; error: string | null }; openPeople: (f: PeopleFilter) => void }) {
  const [rows, setRows] = useState<Record<PeriodKey, Overview> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranges = useMemo(() => Object.fromEntries(PERIODS.map((p) => [p.key, periodRange(p.key)])) as Record<PeriodKey, ReturnType<typeof periodRange>>, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await Promise.all(PERIODS.map((p) => sb().rpc("ins_overview", ranges[p.key])));
      if (!live) return;
      const bad = res.find((r) => r.error);
      if (bad?.error) { setError(bad.error.message); return; }
      setRows(Object.fromEntries(PERIODS.map((p, i) => [p.key, res[i].data as Overview])) as Record<PeriodKey, Overview>);
    })();
    return () => { live = false; };
  }, [ranges]);

  if (error) return <ErrorNote message={error} />;
  if (!rows) return <div className="space-y-4"><Loading h={110} /><Loading h={380} /></div>;

  const o = rows[period];
  const r = ranges[period];
  const label = PERIODS.find((p) => p.key === period)!.label.toLowerCase();
  const site = active.data?.products.find((p) => p.product === "site");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Visitors" value={fmt(o.visitors)} sub="browser sessions that opened any page" />
        <Stat label="Registrations" value={fmt(o.registered)} sub={`${fmt(o.partial)} partial · ${fmt(o.full)} full profile`} />
        <Stat label="MQR" accent value={fmt(o.mqr)} sub={`${pct(o.mqr, o.registered)} of registrations · ${o.mqr_full == null ? "—" : pct(o.mqr_full, o.full)} of full profiles`} />
        <Stat label="VSAT early registrations" value={fmt(o.vsat_early_in_period)}
          sub={period === "all" ? "everyone who has early-registered" : `${fmt(o.vsat_early)} of ${label}'s sign-ups have early-registered`} />
        <Stat label="Active users (30 days)" value={site ? fmt(site.mau) : "—"} sub={site ? `${fmt(site.dau)} today · ${fmt(site.wau)} in 7 days` : "loading…"} />
      </div>

      <Card title={`Vedam One funnel · ${PERIODS.find((p) => p.key === period)!.label}`}
        sub="Visitors and attempts are browser sessions; from Registered down they are people who signed up in this period.">
        <Funnel steps={[
          { label: "Visitors", value: o.visitors },
          { label: "Attempted registration", value: o.attempted, note: "sessions that opened the sign-up page" },
          { label: "Registered (partial + full)", value: o.registered, note: `${fmt(o.partial)} partial · ${fmt(o.full)} full profile`,
            overNote: "more than the step above (people also sign up from other pages)",
            onClick: () => openPeople({ title: "Registered", sub: `Signed up ${label}`, p_from: r.p_from, p_to: r.p_to }) },
          { label: "MQR", value: o.mqr, note: `PCM / PCMB and passing year 2026 or 2027 · ${o.mqr_full == null ? "—" : fmt(o.mqr_full)} of them have a full profile` },
          { label: "VSAT early registration", value: o.vsat_early_mqr, note: `MQRs who also early-registered for VSAT · all registrations: ${fmt(o.vsat_early)} (${pct(o.vsat_early, o.registered)})`,
            onClick: () => openPeople({ title: "Registered and VSAT early-registered", sub: `Signed up ${label}`, p_from: r.p_from, p_to: r.p_to, p_vsat: true }) },
          { label: "VSAT fee paid", value: o.vsat_paid_in_period, muted: o.vsat_paid_in_period == null,
            note: o.vsat_paid_in_period == null ? "Shows here once VSAT payments go live" : `everyone who paid the VSAT fee ${label}` },
        ]} />
        {o.registered > 0 && (
          <div className="mt-4 space-y-2">
            <Insight>
              {pct(o.mqr, o.registered)} of {label === "all time" ? "all" : "this period's"} registrations are MQRs, and {pct(o.used_product, o.registered)} have used at least one product.
            </Insight>
          </div>
        )}
      </Card>

      <Card title="Every period side by side" sub="Same numbers as the funnel. IST; weeks start on Monday. The highlighted column is the period picked above.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-white/10 text-[11.5px] uppercase tracking-wide text-white/45">
                <th className="py-2 pr-3 text-left font-semibold">Metric</th>
                {PERIODS.map((p) => (
                  <th key={p.key} className={`px-3 py-2 text-right font-semibold ${p.key === period ? "text-white" : ""}`}>{p.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                ["Visitors", (x: Overview) => fmt(x.visitors)],
                ["Attempted registration", (x: Overview) => fmt(x.attempted)],
                ["Registered (partial + full)", (x: Overview) => fmt(x.registered)],
                ["   Partial", (x: Overview) => fmt(x.partial)],
                ["   Full profile", (x: Overview) => fmt(x.full)],
                ["MQR", (x: Overview) => fmt(x.mqr)],
                ["MQR % of registrations", (x: Overview) => pct(x.mqr, x.registered)],
                ["MQR % of full profiles", (x: Overview) => (x.mqr_full == null ? "—" : pct(x.mqr_full, x.full))],
                ["VSAT early registrations", (x: Overview) => fmt(x.vsat_early_in_period)],
                ["   of them MQR from this period", (x: Overview) => fmt(x.vsat_early_mqr)],
              ] as [string, (x: Overview) => string][]).map(([name, get]) => (
                <tr key={name} className="border-b border-white/[0.06]">
                  <td className={`whitespace-pre py-2 pr-3 ${name.startsWith(" ") ? "text-white/55" : "text-white/90"}`}>{name}</td>
                  {PERIODS.map((p) => (
                    <td key={p.key} className={`px-3 py-2 text-right tabular-nums ${p.key === period ? "bg-[#8A18FF]/10 font-semibold text-white" : "text-white/80"}`}>{get(rows[p.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ActiveCard active={active} />
    </div>
  );
}

/** Active users per product (5+ minutes a day; Bootcamp = 5+ minutes in the live Zoom) and a 30-day trend for the whole site. */
export function ActiveCard({ active }: { active: { data: Active | null; error: string | null } }) {
  if (active.error) return <ErrorNote message={active.error} />;
  if (!active.data) return <Loading h={300} />;
  const a = active.data;
  const days: string[] = [];
  const end = new Date(`${a.today}T00:00:00Z`);
  for (let i = 29; i >= 0; i--) days.push(new Date(end.getTime() - i * 864e5).toISOString().slice(0, 10));
  const site = new Map(a.trend.filter((t) => t.product === "site").map((t) => [t.day, t.dau]));
  const vals = days.map((d) => site.get(d) ?? 0);
  const max = Math.max(1, ...vals);
  const peakDay = days[vals.indexOf(Math.max(...vals))];

  return (
    <Card title="Active users" sub="Active = 5+ minutes on the product that day (Bootcamp: 5+ minutes in the live Zoom session). Week = last 7 days, month = last 30 days, compared with the 7 / 30 days before.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b border-white/10 text-[11.5px] uppercase tracking-wide text-white/45">
              <th className="py-2 pr-3 text-left font-semibold">Product</th>
              <th className="px-3 py-2 text-right font-semibold">Today</th>
              <th className="px-3 py-2 text-right font-semibold">Last 7 days</th>
              <th className="px-3 py-2 text-right font-semibold">Last 30 days</th>
              <th className="px-3 py-2 text-right font-semibold">Stickiness</th>
              <th className="px-3 py-2 text-right font-semibold">Tracked since</th>
            </tr>
          </thead>
          <tbody>
            {a.products.map((p) => (
              <tr key={p.product} className={`border-b border-white/[0.06] ${p.product === "site" ? "bg-white/[0.03]" : ""}`}>
                <td className={`py-2 pr-3 ${p.product === "site" ? "font-semibold text-white" : "text-white/90"}`}>{productLabel(p.product)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-white">{fmt(p.dau)} <span className="ml-1"><Delta cur={p.dau} prev={p.dau_prev} /></span></td>
                <td className="px-3 py-2 text-right tabular-nums text-white">{fmt(p.wau)} <span className="ml-1"><Delta cur={p.wau} prev={p.wau_prev} /></span></td>
                <td className="px-3 py-2 text-right tabular-nums text-white">{fmt(p.mau)} <span className="ml-1"><Delta cur={p.mau} prev={p.mau_prev} /></span></td>
                <td className="px-3 py-2 text-right tabular-nums text-white/80" title="Today's active users as a share of the last 30 days">{pct(p.dau, p.mau)}</td>
                <td className="px-3 py-2 text-right text-white/50">{p.tracked_since ? shortDate(p.tracked_since) : "starts with this release"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-baseline justify-between text-[12.5px] text-white/55">
          <span>Vedam One daily active users, last 30 days</span>
          <span>peak {fmt(max)} on {shortDate(peakDay)}</span>
        </div>
        <svg viewBox="0 0 600 100" preserveAspectRatio="none" className="h-28 w-full" role="img" aria-label="Daily active users on Vedam One, last 30 days">
          {vals.map((v, i) => {
            const h = (v / max) * 96;
            return (
              <rect key={days[i]} x={i * 20 + 3} y={100 - h} width={14} height={Math.max(h, v > 0 ? 2 : 0)} fill={BLUE} opacity={i === vals.length - 1 ? 1 : 0.7}>
                <title>{`${shortDate(days[i])}: ${v} active`}</title>
              </rect>
            );
          })}
          <line x1="0" x2="600" y1="99.5" y2="99.5" stroke="rgba(255,255,255,0.15)" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="mt-1 flex justify-between text-[11px] text-white/45"><span>{shortDate(days[0])}</span><span>today</span></div>
      </div>
    </Card>
  );
}
