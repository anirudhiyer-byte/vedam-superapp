"use client";

/* Cards built on ins_funnel (migration 0129): every product's split by source on one screen, and the path from
 * sign-up (by source, and by how many products people use) to the VSAT application. One RPC feeds all three. */

import { useState } from "react";
import {
  MATRIX_COLUMNS, VSAT_STEPS, columnTotals, fmt, overIndexed, pct, peopleFor, productLabel, ratio, sourceLabel,
  type MatrixKey, type VsatStepKey,
} from "./lib";
import type { Funnel, FunnelSteps, PeopleFilter } from "./data";
import { Card, Empty, ErrorNote, Insight, Loading } from "./ui";

type Range = { p_from: string | null; p_to: string | null };
type Res = { data: Funnel | null; error: string | null };
const MIN_N = 20;   // findings only compare groups with at least this many people
const TOP = 10;     // rows shown before "Show all"

const STEPS_NOTE = "People who signed up in this period. Each step counts if it happened at any time; every % is of the row's people.";

/** Matrix: rows = sources, columns = Vedam One sign-ups and each product's users in the period. Count + share of the column. */
export function SourceMatrixCard({ res, range, openPeople }: { res: Res; range: Range; openPeople: (f: PeopleFilter) => void }) {
  const [all, setAll] = useState(false);
  if (res.error) return <ErrorNote message={res.error} />;
  if (!res.data) return <Loading h={420} />;
  const rows = res.data.matrix.filter((r) => MATRIX_COLUMNS.some((c) => r[c.key] > 0));
  if (rows.length === 0) return <Card title="Source split by product"><Empty>No sign-ups or product users in this period.</Empty></Card>;

  const totals = columnTotals(rows);
  const shown = all ? rows : rows.slice(0, TOP);
  // the two biggest gaps, one per source (the same source twice says nothing new)
  const findings = MATRIX_COLUMNS.filter((c) => c.key !== "all")
    .map((c) => ({ c, o: overIndexed(rows, c.key as Exclude<MatrixKey, "all">, MIN_N) }))
    .filter((x) => x.o)
    .sort((a, b) => (b.o!.productShare - b.o!.allShare) - (a.o!.productShare - a.o!.allShare))
    .filter((x, i, all) => all.findIndex((y) => y.o!.source === x.o!.source) === i)
    .slice(0, 2);

  return (
    <Card title="Source split by product"
      sub="Each cell = people from that source, and their share of the column. Vedam One = everyone who signed up in this period; a product = everyone who used it in this period. Click a cell to see the people.">
      {findings.length > 0 && (
        <div className="mb-4 space-y-2">
          {findings.map(({ c, o }) => (
            <Insight key={c.key}>
              {sourceLabel(o!.source)} brings {o!.allShare.toFixed(0)}% of all sign-ups but {o!.productShare.toFixed(0)}% of {c.label} users: it works better for {c.label} than its size suggests.
            </Insight>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-0 text-[13px]">
          <colgroup><col className="w-[160px]" />{MATRIX_COLUMNS.map((c) => <col key={c.key} />)}</colgroup>
          <thead>
            <tr className="text-[11.5px] uppercase tracking-wide text-white/45">
              <th scope="col" className="sticky left-0 z-10 bg-[#080808] py-2 pr-3 text-left font-semibold">Source</th>
              {MATRIX_COLUMNS.map((c) => (
                <th key={c.key} scope="col" className={`px-1.5 py-2 text-right font-semibold ${c.key === "all" ? "text-white/70" : ""}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.source}>
                <th scope="row" className="sticky left-0 z-10 max-w-[180px] truncate border-t border-white/[0.06] bg-[#080808] py-1 pr-3 text-left font-normal text-white">{sourceLabel(r.source)}</th>
                {MATRIX_COLUMNS.map((c) => {
                  const n = r[c.key], share = ratio(n, totals[c.key]);
                  return (
                    <td key={c.key} className="border-t border-white/[0.06] p-0.5">
                      <button type="button" disabled={!n}
                        aria-label={`${sourceLabel(r.source)}, ${c.label}: ${fmt(n)} people, ${pct(n, totals[c.key])} of the column`}
                        onClick={() => openPeople(peopleFor(c.key, range, { p_source: r.source }, `${c.key === "all" ? "Signed up" : productLabel(c.key)} · from ${sourceLabel(r.source)}`))}
                        className="w-full rounded-md px-2 py-1.5 text-right transition-[filter] hover:brightness-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8A18FF] disabled:cursor-default disabled:hover:brightness-100"
                        style={{ background: n ? `rgba(${c.key === "all" ? "47,155,255" : "138,24,255"},${(0.06 + 0.5 * share).toFixed(3)})` : "transparent" }}>
                        <div className="font-semibold tabular-nums text-white">{n ? fmt(n) : "—"}</div>
                        <div className="text-[11px] tabular-nums text-white/55">{n ? pct(n, totals[c.key]) : ""}</div>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-white/70">
              <th scope="row" className="sticky left-0 z-10 border-t border-white/15 bg-[#080808] py-2 pr-3 text-left text-[12px] font-semibold uppercase tracking-wide">Total</th>
              {MATRIX_COLUMNS.map((c) => (
                <td key={c.key} className="border-t border-white/15 px-2.5 py-2 text-right font-semibold tabular-nums">{fmt(totals[c.key])}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {rows.length > TOP && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 rounded-lg px-2 py-1 text-[12.5px] font-medium text-[#b07cff] hover:bg-white/[0.05]">
          {all ? `Show the top ${TOP} only` : `Show all ${rows.length} sources`}
        </button>
      )}
    </Card>
  );
}

/** One row per group, one column per step: count, and % of the group's people. */
function StepsTable({ rows, first }: { rows: { key: string; name: string; s: FunnelSteps }[]; first: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-white/10 text-[11.5px] uppercase tracking-wide text-white/45">
            <th scope="col" className="py-2 pr-3 text-left font-semibold">{first}</th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">People</th>
            {VSAT_STEPS.map((st) => <th key={st.key} scope="col" title={st.rule} className="px-2 py-2 text-right font-semibold">{st.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-white/[0.06]">
              <th scope="row" className="max-w-[200px] truncate py-2 pr-3 text-left font-normal text-white">{r.name}</th>
              <td className="px-2 py-2 text-right font-semibold tabular-nums text-white">{fmt(r.s.users)}</td>
              {VSAT_STEPS.map((st) => {
                const n = r.s[st.key];
                return (
                  <td key={st.key} className="px-2 py-2 text-right tabular-nums">
                    <span className={n ? "text-white" : "text-white/35"}>{fmt(n)}</span>
                    <span className="ml-1 text-[11px] text-white/45">{n ? pct(n, r.s.users) : ""}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rate of a step for a group of rows added together. */
const rateOf = (rows: FunnelSteps[], key: VsatStepKey) => {
  const users = rows.reduce((s, r) => s + r.users, 0);
  return { users, n: rows.reduce((s, r) => s + r[key], 0), r: ratio(rows.reduce((s, r) => s + r[key], 0), users) };
};

/** Each source's path from sign-up to the VSAT application. */
export function SourceToVsatCard({ res }: { res: Res }) {
  const [all, setAll] = useState(false);
  if (res.error) return <ErrorNote message={res.error} />;
  if (!res.data) return <Loading h={320} />;
  const rows = res.data.by_source.filter((r) => r.users > 0);
  if (rows.length === 0) return <Card title="From source to VSAT"><Empty>No sign-ups in this period.</Empty></Card>;

  const fair = rows.filter((r) => r.users >= MIN_N && r.source !== "unknown");
  const best = [...fair].sort((a, b) => ratio(b.fee_paid, b.users) - ratio(a.fee_paid, a.users))[0];
  const shown = all ? rows : rows.slice(0, TOP);

  return (
    <Card title="From source to VSAT" sub={STEPS_NOTE}>
      {best && best.fee_paid > 0 && (
        <div className="mb-4"><Insight>{sourceLabel(best.source)} turns sign-ups into paid VSAT applicants best: {pct(best.fee_paid, best.users)} paid the fee (sources with {MIN_N}+ people).</Insight></div>
      )}
      <StepsTable first="Source" rows={shown.map((r) => ({ key: r.source, name: sourceLabel(r.source), s: r }))} />
      {rows.length > TOP && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 rounded-lg px-2 py-1 text-[12.5px] font-medium text-[#b07cff] hover:bg-white/[0.05]">
          {all ? `Show the top ${TOP} only` : `Show all ${rows.length} sources`}
        </button>
      )}
    </Card>
  );
}

/** People grouped by how many products they use, and how far each group got with VSAT. */
export function ProductsToVsatCard({ res }: { res: Res }) {
  if (res.error) return <ErrorNote message={res.error} />;
  if (!res.data) return <Loading h={300} />;
  const rows = res.data.by_products.filter((r) => r.users > 0);
  if (rows.length === 0) return <Card title="Products used → VSAT application"><Empty>No sign-ups in this period.</Empty></Card>;

  const one = rateOf(rows.filter((r) => r.n === 1), "fee_paid");
  const multi = rateOf(rows.filter((r) => r.n >= 2), "fee_paid");
  const label = (n: number) => (n === 0 ? "Signed up, no product yet" : `${n} product${n === 1 ? "" : "s"}`);

  return (
    <Card title="Products used → VSAT application" sub={`${STEPS_NOTE} Products: CodeSprint, Bootcamp, PYQ, College Predictor.`}>
      {one.users >= MIN_N && multi.users >= MIN_N && (multi.n > 0 || one.n > 0) && (
        <div className="mb-4">
          <Insight>
            People on 2+ products paid the VSAT fee at {pct(multi.n, multi.users)}, against {pct(one.n, one.users)} for people on one product
            {one.r > 0 && multi.r > one.r ? ` (about ${(multi.r / one.r).toFixed(1)}× as often)` : ""}. A lead to test, not proof: people who use more may already be keener.
          </Insight>
        </div>
      )}
      <StepsTable first="Products used" rows={rows.map((r) => ({ key: String(r.n), name: label(r.n), s: r }))} />
    </Card>
  );
}
