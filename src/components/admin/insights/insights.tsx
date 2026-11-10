"use client";

import { useCallback, useMemo, useState } from "react";
import { PERIODS, periodRange, type PeriodKey } from "./lib";
import { useRpc, type Active, type PeopleFilter } from "./data";
import { Segmented } from "./ui";
import { OverviewTab } from "./overview-tab";
import { ProductsTab } from "./products-tab";
import { SourcesTab, StatesTab } from "./sources-tab";
import { CrossTab } from "./cross-tab";
import { PeopleDrawer } from "./people-drawer";

type Tab = "overview" | "products" | "sources" | "states" | "cross";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Vedam One overview" },
  { key: "products", label: "Products" },
  { key: "sources", label: "Sources" },
  { key: "states", label: "States" },
  { key: "cross", label: "Cross-product & VSAT" },
];

/** Admin Insights: one place for the Vedam One funnel, products, sources, states and the VSAT link. */
export function Insights() {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [tab, setTab] = useState<Tab>("overview");
  const [people, setPeople] = useState<PeopleFilter | null>(null);
  const range = useMemo(() => periodRange(period), [period]);
  const active = useRpc<Active>("ins_active", useMemo(() => ({ p_days: 30 }), []));
  const closePeople = useCallback(() => setPeople(null), []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 font-[family-name:var(--font-inter)]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Insights</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-white/50">
            Live from Vedam One. Registrations, quality (MQR), products, sources, states and the link to VSAT. Click any bar or row to see the people behind it.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Segmented value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ key: p.key, label: p.label }))} />
          <span className="text-[11.5px] text-white/40">IST · weeks start Monday · applies to every tab</span>
        </div>
      </div>

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-white/10">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[14px] font-medium transition-colors ${tab === t.key ? "border-[#8A18FF] text-white" : "border-transparent text-white/50 hover:text-white/80"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab period={period} active={active} openPeople={setPeople} />}
      {tab === "products" && <ProductsTab range={range} period={period} active={active} openPeople={setPeople} />}
      {tab === "sources" && <SourcesTab range={range} period={period} openPeople={setPeople} />}
      {tab === "states" && <StatesTab range={range} openPeople={setPeople} />}
      {tab === "cross" && <CrossTab range={range} openPeople={setPeople} />}

      {people && <PeopleDrawer filter={people} onClose={closePeople} />}
    </div>
  );
}
