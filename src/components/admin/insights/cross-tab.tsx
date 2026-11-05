"use client";

import { LEVEL_LABEL, REAL_USE_RULE, fmt, pct, productLabel, ratio } from "./lib";
import { useRpc, type Cross, type PeopleFilter } from "./data";
import { ACCENT, BLUE, BarRow, Card, Empty, ErrorNote, Insight, Loading } from "./ui";

type Range = { p_from: string | null; p_to: string | null };
const PRODUCTS = ["codesprint", "bootcamp", "pyq", "cp"] as const;
const MIN_N = 20;

/** Who uses more than one product, in what order, how engaged they are, and how that links to VSAT. */
export function CrossTab({ range, openPeople }: { range: Range; openPeople: (f: PeopleFilter) => void }) {
  const res = useRpc<Cross>("ins_cross", range);
  if (res.error) return <ErrorNote message={res.error} />;
  if (!res.data) return <Loading h={460} />;
  const c = res.data;
  if (!c.cohort) return <Empty>No sign-ups in this period.</Empty>;

  const by = (n: number) => c.by_count.find((x) => x.n === n) ?? { n, users: 0, vsat: 0 };
  const one = by(1);
  const multi = c.by_count.filter((x) => x.n >= 2).reduce((s, x) => ({ users: s.users + x.users, vsat: s.vsat + x.vsat }), { users: 0, vsat: 0 });
  const r1 = ratio(one.vsat, one.users), rm = ratio(multi.vsat, multi.users);
  const maxBy = Math.max(1, ...c.by_count.map((x) => x.users));
  const people = (extra: Partial<PeopleFilter>, title: string): PeopleFilter => ({ title, sub: "Signed up in this period", ...range, ...extra });
  const pair = (a: string, b: string) => c.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  const single = (a: string) => c.products.find((p) => p.product === a);
  const maxPair = Math.max(1, ...c.pairs.map((p) => p.users));
  const levels = (["high", "medium", "low"] as const).map((l) => c.levels.find((x) => x.level === l) ?? { level: l, users: 0, vsat: 0 });
  const maxLevel = Math.max(1, ...levels.map((l) => l.users));
  const beforeTotal = c.before_vsat.reduce((s, x) => s + x.users, 0);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Insight>{fmt(multi.users)} of {fmt(c.cohort)} people ({pct(multi.users, c.cohort)}) use 2 or more products.</Insight>
        {one.users >= MIN_N && multi.users >= 1 && (
          <Insight>
            People on 2+ products early-register for VSAT at {pct(multi.vsat, multi.users)}, against {pct(one.vsat, one.users)} for people on one product
            {r1 > 0 && rm > r1 ? ` (about ${(rm / r1).toFixed(1)}× as often)` : ""}. Small groups: treat this as a lead to test, not proof.
          </Insight>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="How many products people use" sub="Products: CodeSprint, Bootcamp, PYQ, College Predictor. Click a row to see the people.">
          {c.by_count.map((x) => (
            <BarRow key={x.n} name={x.n === 0 ? "Signed up, no product yet" : `${x.n} product${x.n === 1 ? "" : "s"}`} value={x.users} max={maxBy}
              color={x.n >= 2 ? ACCENT : BLUE}
              note={`${fmt(x.vsat)} early-registered for VSAT (${pct(x.vsat, x.users)})`}
              onClick={x.n >= 1 ? () => openPeople(people({ p_min_products: x.n }, x.n === 1 ? "On 1 or more products" : `On ${x.n} or more products`)) : undefined} />
          ))}
        </Card>

        <Card title="Engagement level and VSAT" sub={REAL_USE_RULE}>
          {levels.map((l) => (
            <BarRow key={l.level} name={`${LEVEL_LABEL[l.level].name} · ${LEVEL_LABEL[l.level].rule}`} value={l.users} max={maxLevel}
              color={l.level === "high" ? ACCENT : l.level === "medium" ? BLUE : "rgba(255,255,255,0.3)"}
              note={`${fmt(l.vsat)} early-registered for VSAT (${pct(l.vsat, l.users)})`}
              onClick={() => openPeople(people({ p_level: l.level }, LEVEL_LABEL[l.level].name))} />
          ))}
        </Card>
      </div>

      <Card title="Which products are used together" sub="Each cell = people who used both products (the diagonal = all users of that product). The small line is the VSAT early-registration rate. Click a cell to see the people.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] table-fixed border-separate border-spacing-1.5 text-[13px]">
            <thead>
              <tr>
                <th className="w-40" />
                {PRODUCTS.map((p) => <th key={p} className="px-2 pb-1 text-center text-[11.5px] font-semibold uppercase tracking-wide text-white/45">{productLabel(p)}</th>)}
              </tr>
            </thead>
            <tbody>
              {PRODUCTS.map((a) => (
                <tr key={a}>
                  <th className="whitespace-nowrap pr-2 text-right text-[11.5px] font-semibold uppercase tracking-wide text-white/45">{productLabel(a)}</th>
                  {PRODUCTS.map((b) => {
                    const cell = a === b ? single(a) : pair(a, b);
                    const n = cell?.users ?? 0;
                    const v = cell?.vsat ?? 0;
                    const shade = a === b ? 0.06 : 0.1 + 0.55 * (n / maxPair);
                    return (
                      <td key={b} className="p-0">
                        <button type="button" disabled={!n}
                          onClick={() => openPeople(people({ p_products: a === b ? [a] : [a, b] }, a === b ? `${productLabel(a)} users` : `${productLabel(a)} + ${productLabel(b)}`))}
                          className="w-full rounded-lg px-2 py-2.5 text-center transition-[filter] hover:brightness-125 disabled:cursor-default disabled:hover:brightness-100"
                          style={{ background: a === b ? `rgba(255,255,255,${shade})` : n ? `rgba(138,24,255,${shade})` : "rgba(255,255,255,0.03)" }}>
                          <div className="text-[15px] font-bold tabular-nums text-white">{fmt(n)}</div>
                          <div className="text-[11px] text-white/60">{n ? `${pct(v, n)} VSAT` : "—"}</div>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="First product, then the next one" sub="For people on 2+ products: the product they started with and the one they tried next.">
          {c.paths.length === 0 ? <Empty>Nobody on 2+ products in this period.</Empty> : c.paths.slice(0, 8).map((p) => (
            <BarRow key={`${p.from}-${p.to}`} name={`${productLabel(p.from)} → ${productLabel(p.to)}`} value={p.users} max={c.paths[0].users} />
          ))}
        </Card>
        <Card title="Last product before VSAT early registration" sub="For people who early-registered: the product they had started most recently before that.">
          {c.before_vsat.length === 0 ? <Empty>No VSAT early registrations in this group.</Empty> : c.before_vsat.map((b) => (
            <BarRow key={b.product} name={b.product === "none" ? "No product before VSAT" : productLabel(b.product)} value={b.users} max={c.before_vsat[0].users}
              right={`${fmt(b.users)} · ${pct(b.users, beforeTotal)}`} color={b.product === "none" ? "rgba(255,255,255,0.3)" : ACCENT} />
          ))}
        </Card>
      </div>
    </div>
  );
}
