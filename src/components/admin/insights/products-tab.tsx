"use client";

import { useMemo, useState } from "react";
import { PRODUCT_STEPS, PRODUCT_USER_RULE, costPer, fmt, inr, pct, productLabel, ratio, sourceLabel, type PeriodKey, type ProductKey } from "./lib";
import { useRpc, type Active, type PeopleFilter, type ProductRow, type SourceRow, type StateRow } from "./data";
import { BLUE, BarRow, Card, Empty, ErrorNote, Funnel, Insight, Loading } from "./ui";

type Range = { p_from: string | null; p_to: string | null };

/** All products side by side, then one product in depth. */
export function ProductsTab({ range, period, active, openPeople }: { range: Range; period: PeriodKey; active: { data: Active | null }; openPeople: (f: PeopleFilter) => void }) {
  const res = useRpc<ProductRow[]>("ins_products", range);
  const [pick, setPick] = useState<ProductKey>("codesprint");
  const mau = useMemo(() => new Map((active.data?.products ?? []).map((p) => [p.product, p])), [active.data]);

  if (res.error) return <ErrorNote message={res.error} />;
  if (!res.data) return <Loading h={420} />;
  const rows = res.data;
  const maxUsers = Math.max(1, ...rows.map((r) => r.users));
  const allTime = period === "all";

  // findings (only from products with a fair number of users)
  const big = rows.filter((r) => r.product !== "vsat" && r.users >= 20);
  const most = [...rows].filter((r) => r.product !== "vsat").sort((a, b) => b.users - a.users)[0];
  const bestMqr = [...big].sort((a, b) => ratio(b.mqr, b.users) - ratio(a.mqr, a.users))[0];
  const bestVsat = [...big].sort((a, b) => ratio(b.vsat_early, b.users) - ratio(a.vsat_early, a.users))[0];

  return (
    <div className="space-y-5">
      {(most?.users ?? 0) > 0 && (
        <div className="space-y-2">
          <Insight>{productLabel(most.product)} has the most users in this period ({fmt(most.users)}).</Insight>
          {bestMqr && <Insight>{productLabel(bestMqr.product)} brings the highest share of MQRs: {pct(bestMqr.mqr, bestMqr.users)} of its users.</Insight>}
          {bestVsat && <Insight>{productLabel(bestVsat.product)} users early-register for VSAT most often: {pct(bestVsat.vsat_early, bestVsat.users)}.</Insight>}
        </div>
      )}

      <Card title="Products compared" sub="Users = people who used the product in this period (see each product's rule below). VSAT % and 2+ products count what those users have done at any time.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-white/10 text-[11.5px] uppercase tracking-wide text-white/45">
                <th className="py-2 pr-3 text-left font-semibold">Product</th>
                <th className="px-2 py-2 text-right font-semibold" title="Browser sessions that opened the product's pages">Visitors</th>
                <th className="px-2 py-2 text-right font-semibold">Users</th>
                <th className="px-2 py-2 text-right font-semibold" title="First time on this product">New</th>
                <th className="px-2 py-2 text-right font-semibold">MQR</th>
                <th className="px-2 py-2 text-right font-semibold">MQR %</th>
                <th className="px-2 py-2 text-right font-semibold">VSAT early</th>
                <th className="px-2 py-2 text-right font-semibold">VSAT %</th>
                <th className="px-2 py-2 text-right font-semibold">On 2+ products</th>
                <th className="px-2 py-2 text-right font-semibold" title="5+ minutes in the last 30 days">Active (30d)</th>
                <th className="px-2 py-2 text-right font-semibold">Spend*</th>
                <th className="px-2 py-2 text-right font-semibold">Cost / user*</th>
                <th className="px-2 py-2 text-right font-semibold">Cost / MQR*</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = mau.get(r.product);
                return (
                  <tr key={r.product} onClick={() => setPick(r.product)} className={`cursor-pointer border-b border-white/[0.06] hover:bg-white/[0.04] ${pick === r.product ? "bg-[#8A18FF]/10" : ""}`}>
                    <td className="py-2.5 pr-3 font-medium text-white">{productLabel(r.product)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/70">{fmt(r.visitors)}</td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-white">{fmt(r.users)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/70">{fmt(r.new_users)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white">{fmt(r.mqr)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/80">{pct(r.mqr, r.users)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white">{r.product === "vsat" ? "—" : fmt(r.vsat_early)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/80">{r.product === "vsat" ? "—" : pct(r.vsat_early, r.users)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/80">{pct(r.multi, r.users)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/80">{m ? fmt(m.mau) : "—"}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/70">{r.spend_all_time ? inr(r.spend_all_time) : "—"}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/70">{allTime ? costPer(r.spend_all_time, r.users) : "—"}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/70">{allTime ? costPer(r.spend_all_time, r.mqr) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-white/45">
          * Spend = everything logged in the Growth sheets so far (it has no dates), so cost per user and per MQR are shown only for “All time”. Click a row to open that product below.
        </p>
      </Card>

      <Card title="Users by product" sub="Bar = users in this period; the purple part of the label is the MQR count.">
        <div className="grid gap-1 sm:grid-cols-2">
          {rows.map((r) => (
            <BarRow key={r.product} name={productLabel(r.product)} value={r.users} max={maxUsers}
              right={<span>{fmt(r.users)} <span className="text-[12px] font-normal text-[#c9a3ff]">· {fmt(r.mqr)} MQR</span></span>}
              color={r.product === "vsat" ? BLUE : undefined} onClick={() => setPick(r.product)} />
          ))}
        </div>
      </Card>

      <ProductDetail product={pick} row={rows.find((r) => r.product === pick)!} range={range} openPeople={openPeople} />
    </div>
  );
}

function ProductDetail({ product, row, range, openPeople }: { product: ProductKey; row: ProductRow; range: Range; openPeople: (f: PeopleFilter) => void }) {
  const args = useMemo(() => ({ ...range, p_product: product }), [range, product]);
  const src = useRpc<SourceRow[]>("ins_sources", args);
  const st = useRpc<StateRow[]>("ins_states", args);
  const [s1, s2, s3] = PRODUCT_STEPS[product];
  const everyone: PeopleFilter = product === "vsat"
    ? { title: "VSAT early registrations", sub: "Everyone, all time", p_from: null, p_to: null, p_vsat: true }
    : { title: `${productLabel(product)} users`, sub: "Everyone who has used it, all time", p_from: null, p_to: null, p_products: [product] };

  const steps = [
    { label: `Users (${PRODUCT_USER_RULE[product]})`, value: row.users },
    { label: s1, value: row.step1 },
    { label: s2, value: row.step2 },
    ...(s3 ? [{ label: s3, value: row.step3 }] : []),
  ];
  const srcRows = (src.data ?? []).filter((r) => r.users > 0);
  const stRows = (st.data ?? []).filter((r) => r.users > 0);
  const maxSrc = Math.max(1, ...srcRows.map((r) => r.users));
  const maxSt = Math.max(1, ...stRows.map((r) => r.users));

  return (
    <Card title={productLabel(product)} sub="How far this period's users have gone, where they came from, and where they are."
      right={<button type="button" onClick={() => openPeople(everyone)} className="rounded-lg border border-white/15 px-3 py-1.5 text-[13px] text-white/85 hover:bg-white/[0.06]">See the people →</button>}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <Funnel steps={steps} />
          {product !== "vsat" && (
            <div className="mt-3 space-y-2">
              <Insight>{pct(row.mqr, row.users)} are MQRs, {pct(row.vsat_early, row.users)} have early-registered for VSAT, and {pct(row.multi, row.users)} also use another product.</Insight>
            </div>
          )}
        </div>
        <div className="space-y-5">
          <div>
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-white/45">Top sources</div>
            {src.error ? <ErrorNote message={src.error} /> : src.loading && !src.data ? <Loading h={120} /> : srcRows.length === 0 ? <Empty>No users in this period.</Empty> :
              srcRows.slice(0, 6).map((r) => (
                <BarRow key={r.source} name={sourceLabel(r.source)} value={r.users} max={maxSrc} right={`${fmt(r.users)} · ${pct(r.users, row.users)}`} />
              ))}
          </div>
          <div>
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-white/45">Top states</div>
            {st.error ? <ErrorNote message={st.error} /> : st.loading && !st.data ? <Loading h={120} /> : stRows.length === 0 ? <Empty>No users in this period.</Empty> :
              stRows.slice(0, 6).map((r) => (
                <BarRow key={r.state} name={r.state} value={r.users} max={maxSt} right={`${fmt(r.users)} · ${pct(r.users, row.users)}`} color={BLUE} />
              ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
