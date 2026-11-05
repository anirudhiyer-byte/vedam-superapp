"use client";

import { useMemo, useState } from "react";
import { costPer, fmt, inr, pct, productLabel, ratio, sourceLabel, type PeriodKey } from "./lib";
import { useRpc, type PeopleFilter, type SourceRow, type StateRow } from "./data";
import { BLUE, BarRow, Card, Empty, ErrorNote, Insight, Loading, Segmented } from "./ui";
import { StateMap, type MapMetric } from "./state-map";

type Range = { p_from: string | null; p_to: string | null };
type ProductFilter = "all" | "codesprint" | "bootcamp" | "pyq" | "cp" | "vsat";
const PRODUCT_FILTERS: { key: ProductFilter; label: string }[] = [
  { key: "all", label: "All sign-ups" },
  { key: "codesprint", label: "CodeSprint" },
  { key: "bootcamp", label: "Bootcamp" },
  { key: "pyq", label: "PYQ" },
  { key: "cp", label: "College Predictor" },
  { key: "vsat", label: "VSAT early" },
];
const MIN_N = 20; // findings only compare groups with at least this many people

/** People for a source/state row: sign-ups in the period, or (with a product filter) everyone who used that product. */
function peopleFor(product: ProductFilter, range: Range, extra: Partial<PeopleFilter>, title: string): PeopleFilter {
  if (product === "all") return { title, sub: "Signed up in this period", ...range, ...extra };
  if (product === "vsat") return { title, sub: "VSAT early registrations, all time", p_from: null, p_to: null, p_vsat: true, ...extra };
  return { title, sub: `${productLabel(product)} users, all time`, p_from: null, p_to: null, p_products: [product], ...extra };
}

export function SourcesTab({ range, period, openPeople }: { range: Range; period: PeriodKey; openPeople: (f: PeopleFilter) => void }) {
  const [product, setProduct] = useState<ProductFilter>("all");
  const args = useMemo(() => ({ ...range, p_product: product }), [range, product]);
  const res = useRpc<SourceRow[]>("ins_sources", args);

  const rows = (res.data ?? []).filter((r) => r.users > 0);
  const spendOnly = (res.data ?? []).filter((r) => r.users === 0 && r.spend_all_time);
  const total = rows.reduce((s, r) => s + r.users, 0);
  const max = Math.max(1, ...rows.map((r) => r.users));
  const showSpend = product === "all";
  const showCost = showSpend && period === "all";

  const fair = rows.filter((r) => r.users >= MIN_N && r.source !== "unknown");
  const top = rows[0];
  const bestMqr = [...fair].sort((a, b) => ratio(b.mqr, b.users) - ratio(a.mqr, a.users))[0];
  const bestVsat = [...fair].sort((a, b) => ratio(b.vsat_early, b.users) - ratio(a.vsat_early, a.users))[0];
  const paid = showCost ? rows.filter((r) => (r.spend_all_time ?? 0) > 0 && r.mqr > 0) : [];
  const cheapest = [...paid].sort((a, b) => (a.spend_all_time! / a.mqr) - (b.spend_all_time! / b.mqr))[0];
  const hasPaidAndMeta = rows.some((r) => r.source === "paid") && rows.some((r) => r.source === "meta");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={product} onChange={setProduct} options={PRODUCT_FILTERS} />
        <span className="text-[12.5px] text-white/45">Source = the first link a person signed up from. Capital and small letters count as the same source.</span>
      </div>

      {res.error ? <ErrorNote message={res.error} /> : !res.data ? <Loading h={420} /> : rows.length === 0 ? <Empty>No sign-ups in this period.</Empty> : (
        <>
          <div className="space-y-2">
            {top && <Insight>{sourceLabel(top.source)} brings the most people: {fmt(top.users)} of {fmt(total)} ({pct(top.users, total)}).</Insight>}
            {bestMqr && <Insight>Best quality: {pct(bestMqr.mqr, bestMqr.users)} of people from {sourceLabel(bestMqr.source)} are MQRs (sources with {MIN_N}+ people).</Insight>}
            {bestVsat && <Insight>{sourceLabel(bestVsat.source)} converts to VSAT early registration best: {pct(bestVsat.vsat_early, bestVsat.users)}.</Insight>}
            {cheapest && <Insight>Cheapest MQRs come from {sourceLabel(cheapest.source)}: {costPer(cheapest.spend_all_time, cheapest.mqr)} per MQR (all-time spend ÷ all-time MQRs).</Insight>}
            {hasPaidAndMeta && <Insight>“Paid” and “Meta” are two different tags in the sign-up links. If “Paid” also means Meta ads, the links should use one name so they count together.</Insight>}
          </div>

          <Card title="Where people come from" sub="Click a source to see the people.">
            {rows.map((r) => (
              <BarRow key={r.source} name={sourceLabel(r.source)} value={r.users} max={max}
                right={<span>{fmt(r.users)} <span className="text-[12px] font-normal text-white/45">· {pct(r.users, total)}</span></span>}
                note={`${pct(r.mqr, r.users)} MQR · ${pct(r.vsat_early, r.users)} VSAT early · ${pct(r.multi, r.users)} on 2+ products`}
                onClick={() => openPeople(peopleFor(product, range, { p_source: r.source }, `From ${sourceLabel(r.source)}`))} />
            ))}
          </Card>

          <Card title="Source quality and cost" sub={showSpend ? (showCost ? "Spend is everything logged in the Growth sheets so far." : "Spend is all-time (the Growth sheets have no dates), so cost per person is shown only for “All time”.") : "Spend is shown only for all sign-ups, because the Growth sheets do not split spend by product."}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-[13.5px]">
                <thead>
                  <tr className="border-b border-white/10 text-[11.5px] uppercase tracking-wide text-white/45">
                    <th className="py-2 pr-3 text-left font-semibold">Source</th>
                    <th className="px-2 py-2 text-right font-semibold">People</th>
                    <th className="px-2 py-2 text-right font-semibold">Share</th>
                    <th className="px-2 py-2 text-right font-semibold">MQR</th>
                    <th className="px-2 py-2 text-right font-semibold">MQR %</th>
                    <th className="px-2 py-2 text-right font-semibold">VSAT early</th>
                    <th className="px-2 py-2 text-right font-semibold">VSAT %</th>
                    <th className="px-2 py-2 text-right font-semibold">2+ products</th>
                    {showSpend && <th className="px-2 py-2 text-right font-semibold">Spend</th>}
                    {showSpend && <th className="px-2 py-2 text-right font-semibold">Cost / person</th>}
                    {showSpend && <th className="px-2 py-2 text-right font-semibold">Cost / MQR</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.source} className="border-b border-white/[0.06]">
                      <td className="py-2 pr-3 text-white">{sourceLabel(r.source)}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-white">{fmt(r.users)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/70">{pct(r.users, total)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white">{fmt(r.mqr)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/80">{pct(r.mqr, r.users)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white">{fmt(r.vsat_early)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/80">{pct(r.vsat_early, r.users)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/80">{pct(r.multi, r.users)}</td>
                      {showSpend && <td className="px-2 py-2 text-right tabular-nums text-white/70">{r.spend_all_time ? inr(r.spend_all_time) : "—"}</td>}
                      {showSpend && <td className="px-2 py-2 text-right tabular-nums text-white/70">{showCost ? costPer(r.spend_all_time, r.users) : "—"}</td>}
                      {showSpend && <td className="px-2 py-2 text-right tabular-nums text-white/70">{showCost ? costPer(r.spend_all_time, r.mqr) : "—"}</td>}
                    </tr>
                  ))}
                  {showSpend && spendOnly.map((r) => (
                    <tr key={`spend-${r.source}`} className="border-b border-white/[0.06] text-white/50">
                      <td className="py-2 pr-3">{sourceLabel(r.source)}</td>
                      <td className="px-2 py-2 text-right" colSpan={7}>no sign-ups with this tag</td>
                      <td className="px-2 py-2 text-right tabular-nums">{inr(r.spend_all_time)}</td>
                      <td className="px-2 py-2 text-right">—</td>
                      <td className="px-2 py-2 text-right">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

const MAP_METRICS: { key: MapMetric; label: string }[] = [
  { key: "users", label: "Users" },
  { key: "mqr", label: "MQR %" },
  { key: "vsat", label: "VSAT early %" },
];

export function StatesTab({ range, openPeople }: { range: Range; openPeople: (f: PeopleFilter) => void }) {
  const [product, setProduct] = useState<ProductFilter>("all");
  const [mapMetric, setMapMetric] = useState<MapMetric>("users");
  const args = useMemo(() => ({ ...range, p_product: product }), [range, product]);
  const res = useRpc<StateRow[]>("ins_states", args);

  const rows = res.data ?? [];
  const known = rows.filter((r) => r.state !== "Unknown");
  const unknown = rows.find((r) => r.state === "Unknown");
  const total = rows.reduce((s, r) => s + r.users, 0);
  const max = Math.max(1, ...known.map((r) => r.users));
  const fair = known.filter((r) => r.users >= MIN_N);
  const bestVsat = [...fair].sort((a, b) => ratio(b.vsat_early, b.users) - ratio(a.vsat_early, a.users))[0];
  const bestMqr = [...fair].sort((a, b) => ratio(b.mqr, b.users) - ratio(a.mqr, a.users))[0];
  const pickState = (state: string) => openPeople(peopleFor(product, range, { p_state: state }, state === "Unknown" ? "State unknown" : `In ${state}`));

  return (
    <div className="space-y-4">
      <Segmented value={product} onChange={setProduct} options={PRODUCT_FILTERS} />
      {res.error ? <ErrorNote message={res.error} /> : !res.data ? <Loading h={420} /> : rows.length === 0 ? <Empty>No sign-ups in this period.</Empty> : (
        <>
          <div className="grid gap-2 lg:grid-cols-2">
            {known.length > 0 && <Insight>Top states: {known.slice(0, 3).map((r) => `${r.state} (${pct(r.users, total)})`).join(", ")}.</Insight>}
            {bestMqr && <Insight>Highest MQR share: {bestMqr.state}, {pct(bestMqr.mqr, bestMqr.users)} (states with {MIN_N}+ people).</Insight>}
            {bestVsat && <Insight>Highest VSAT early-registration rate: {bestVsat.state}, {pct(bestVsat.vsat_early, bestVsat.users)}.</Insight>}
            {unknown && unknown.users > 0 && <Insight>State is missing for {fmt(unknown.users)} people ({pct(unknown.users, total)}), mostly people who have not finished their profile.</Insight>}
          </div>
          <Card title="Where people are" sub={`${known.length} states and union territories. Map is coloured by the chosen metric; click a state (map or list) to see the people.`}
            right={<Segmented value={mapMetric} onChange={setMapMetric} options={MAP_METRICS} />}>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
              <StateMap rows={known} metric={mapMetric} onPick={pickState} unknown={unknown} total={total} />
              <div className="min-w-0">
                <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-white/45">All states ({known.length})</div>
                {/* the list scrolls inside the map's height so the row never gets taller than the map */}
                <div className="max-h-[540px] overflow-y-auto pr-1 [scrollbar-width:thin]">
                  {known.map((r) => (
                    <BarRow key={r.state} name={r.state} value={r.users} max={max} color={BLUE}
                      right={<span>{fmt(r.users)} <span className="text-[12px] font-normal text-white/45">· {pct(r.users, total)}</span></span>}
                      note={`${pct(r.mqr, r.users)} MQR · ${pct(r.vsat_early, r.users)} VSAT early`}
                      onClick={() => pickState(r.state)} />
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
