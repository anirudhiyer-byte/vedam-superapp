"use client";

import { useMemo, useState } from "react";
import { CATEGORIES } from "@/lib/growth/consultants";
import {
  ALL_TIME, CAMPUS_OPTIONS, breakdownKpis, breakdownRows, campusCode, csvDate, distinctSorted, fmtINR, fmtNum, lower, nextSort, sortByNum,
  type Consultant, type DateRange, type DrillKind, type SortState,
} from "@/lib/growth/consultants-perf";
import { type Client } from "./api";
import { Icon } from "./icons";
import { KpiDrilldown, StudentsModal } from "./perf-drill";
import { BdmTab, CityTab, JourneyTab } from "./perf-tabs";
import { CategoryBadge, Customize, ErrBanner, Kpi, MultiSelect, PeriodBar, SortTh, downloadCsv, usePerf, usePersistedSet } from "./perf-ui";

/**
 * Growth → Marketing Channels → Consultants Channel → Consultant Performance. Admin only.
 * Layout and behaviour follow the vedamcrm360 Consultants Dashboard (4 tabs). Numbers come from growth_cons_perf
 * (migration 0131), worked out in the database with the Listing's attribution rules; students from growth_cons_perf_students.
 */

type Tab = "breakdown" | "journey" | "bdm" | "city";
const TABS: { k: Tab; label: string }[] = [
  { k: "breakdown", label: "Consultant Breakdown" }, { k: "journey", label: "Application Journey" },
  { k: "bdm", label: "BDM View" }, { k: "city", label: "City View" },
];

export function ConsultantsPerformance({ sb }: { sb: Client }) {
  const [tab, setTab] = useState<Tab>("breakdown");
  const [range, setRange] = useState<DateRange>(ALL_TIME);   // shared by Breakdown / BDM / City (not Journey)
  return (
    <div className="vcn-page">
      <div className="vcn-head">
        <div>
          <h1 className="vcn-h1">Consultants Dashboard</h1>
          <p className="vcn-sub"><span>Education-consultant performance — leads, applications, enrollments, and payout tracking.</span></p>
        </div>
      </div>
      <div className="vcn-tabs" role="tablist" aria-label="Consultant performance views">
        {TABS.map((t) => (
          <button key={t.k} type="button" role="tab" id={`vcp-tab-${t.k}`} aria-controls={`vcp-panel-${t.k}`} className="vcn-tab"
            aria-selected={tab === t.k} onClick={() => setTab(t.k)}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`vcp-panel-${tab}`} aria-labelledby={`vcp-tab-${tab}`}>
        {tab !== "journey" && <PeriodBar value={range} onChange={setRange} />}
        {tab === "breakdown" && <Breakdown sb={sb} range={range} />}
        {tab === "journey" && <JourneyTab sb={sb} />}
        {tab === "bdm" && <BdmTab sb={sb} range={range} />}
        {tab === "city" && <CityTab sb={sb} range={range} />}
      </div>
    </div>
  );
}

const COLS = [
  { key: "category", label: "Category" }, { key: "city", label: "City" }, { key: "leads", label: "Leads" },
  { key: "applications", label: "Applications" }, { key: "enrollments", label: "Enrollments" },
  { key: "enrollmentSpend", label: "Enrollment Spend" }, { key: "totalSpend", label: "Total Spend" },
];
const CARDS = [
  { key: "consultants", label: "Consultants" }, { key: "consultantsActive", label: "Consultants Active" }, { key: "leads", label: "Leads" },
  { key: "applications", label: "Applications" }, { key: "enrollments", label: "Enrollments" },
  { key: "enrollmentSpend", label: "Enrollment Spend" }, { key: "totalSpend", label: "Total Spend" },
];
const GET: Record<string, (c: Consultant) => number> = {
  leads: (c) => c.leads, applications: (c) => c.payments, enrollments: (c) => c.enrolled,
  enrollmentSpend: (c) => c.enrollSpend, totalSpend: (c) => c.spend,
};

function Breakdown({ sb, range }: { sb: Client; range: DateRange }) {
  const [campuses, setCampuses] = useState<string[]>([]);
  const [category, setCategory] = useState<string[]>([]);
  const [city, setCity] = useState<string[]>([]);
  const campus = campusCode(campuses);
  const { loading, list, first, err, reload } = usePerf(sb, range, campus);
  const cityOptions = useMemo(() => distinctSorted(list.flatMap((c) => c.cityList)), [list]);
  const rows = useMemo(() => breakdownRows(list, category, city), [list, category, city]);
  const [sort, setSort] = useState<SortState>({ key: "applications", dir: "desc" });
  const sorted = useMemo(() => sortByNum(rows, GET[sort.key] ?? GET.applications, sort.dir), [rows, sort]);
  const k = useMemo(() => breakdownKpis(rows), [rows]);
  const visible = useMemo(() => new Set(rows.map((c) => lower(c.name))), [rows]);
  const hidCols = usePersistedSet("vcn-perf-hidden-cols");
  const hidCards = usePersistedSet("vcn-perf-hidden-cards");
  const col = (key: string) => !hidCols.has(key);
  const card = (key: string) => !hidCards.has(key);
  const [drill, setDrill] = useState<Consultant | null>(null);
  const [kpiDrill, setKpiDrill] = useState<DrillKind | null>(null);
  const on = (key: string) => setSort((s) => nextSort(s, key));

  function exportCsv() {
    downloadCsv(`consultant-breakdown-${csvDate()}.csv`, [
      { key: "name", label: "Consultant" }, { key: "category", label: "Category" }, { key: "city", label: "City" }, { key: "leads", label: "Leads" },
      { key: "appUtm", label: "Applications (UTM)" }, { key: "appCoupon", label: "Applications (Coupon)" }, { key: "payments", label: "Applications (Total)" },
      { key: "enrolled", label: "Enrollments" }, { key: "enrollSpend", label: "Enrollment Spend" }, { key: "slabSpend", label: "Slab Spend" }, { key: "spend", label: "Total Spend" },
    ], sorted.map((c) => ({ ...c, city: c.cityList.join(", ") })));
  }

  return (
    <>
      <div className="vcp-row">
        <span className="vcp-lab"><Icon n="pin" size="xs" /> Campus</span>
        <MultiSelect label="Campuses" allLabel="All Campuses" options={CAMPUS_OPTIONS} selected={campuses} onChange={setCampuses} />
        <MultiSelect label="Categories" allLabel="All categories" options={CATEGORIES} selected={category} onChange={setCategory} />
        <MultiSelect label="Cities" allLabel="All cities" options={cityOptions} selected={city} onChange={setCity} />
        {loading && <span className="c-mut" role="status" aria-label="Loading"><Icon n="loader" spin size="s" /></span>}
      </div>

      {err && !first && <ErrBanner msg={err} />}

      <div className="vcp-kpis k7" aria-busy={first}>
        {card("consultants") && <Kpi label="Consultants" color="var(--a)" loading={first} value={fmtNum(k.consultants)} sub={`${fmtNum(k.associated)} assoc · ${fmtNum(k.notAssociated)} not`} />}
        {card("consultantsActive") && <Kpi label="Consultants Active" color="var(--a)" loading={first} value={fmtNum(k.active)} />}
        {card("leads") && <Kpi label="Leads" color="var(--lv)" loading={first} value={fmtNum(k.leads)} onClick={first ? undefined : () => setKpiDrill("lead")} />}
        {card("applications") && <Kpi label="Applications" color="var(--cy)" loading={first} value={fmtNum(k.payments)} sub={`${fmtNum(k.appUtm)} UTM · ${fmtNum(k.appCoupon)} coupon`}
          onClick={first ? undefined : () => setKpiDrill("application")} />}
        {card("enrollments") && <Kpi label="Enrollments" color="var(--pink)" loading={first} value={fmtNum(k.enrolled)} sub={`${fmtNum(k.enrolled)} strict`}
          onClick={first ? undefined : () => setKpiDrill("enrollment")} />}
        {card("enrollmentSpend") && <Kpi label="Enrollment Spend" color="var(--gr)" loading={first} value={fmtINR(k.enrollSpend)} />}
        {card("totalSpend") && <Kpi label="Total Spend" color="var(--a)" hl loading={first} value={fmtINR(k.totalSpend)} sub={`+ ${fmtINR(k.slabSpend)} slab`} />}
      </div>

      <div className="vcn-card">
        <div className="vcp-ch">
          <div className="vcp-ct"><Icon n="trophy" /> Consultant Breakdown</div>
          <div className="vcp-cr">
            <span className="vcp-hint">strict · click a row to drill in</span>
            <button type="button" className="vcp-sb" onClick={exportCsv} disabled={first || sorted.length === 0} title="Download the filtered rows as CSV"><Icon n="download" size="s" /> CSV</button>
            <Customize cards={CARDS} cols={COLS} hiddenCards={hidCards} hiddenCols={hidCols} />
          </div>
        </div>
        {first && err ? (
          <div className="vcn-empty" role="alert"><b>Couldn&apos;t load the consultants.</b><span>{err}</span>
            <button type="button" className="vcn-b" style={{ marginTop: 14 }} onClick={reload}><Icon n="refresh" size="s" /> Try again</button></div>
        ) : sorted.length === 0 ? (
          <div className="vcn-empty"><b>{first ? "Loading…" : list.length === 0 ? "No consultants yet." : "No consultants match these filters."}</b>
            {!first && list.length === 0 && <span>Add consultants in <em>Consultant Listing</em> to see their performance here.</span>}</div>
        ) : (
          <div className="vcn-scroll">
            <table className="vcn-t vcp-t" aria-label="Consultant breakdown" aria-busy={loading}>
              <thead><tr>
                <th scope="col">Consultant</th>
                {col("category") && <th scope="col">Category</th>}
                {col("city") && <th scope="col">City</th>}
                {col("leads") && <SortTh k="leads" sort={sort} onSort={on}>Leads</SortTh>}
                {col("applications") && <SortTh k="applications" sort={sort} onSort={on}>Applications</SortTh>}
                {col("enrollments") && <SortTh k="enrollments" sort={sort} onSort={on}>Enrollments</SortTh>}
                {col("enrollmentSpend") && <SortTh k="enrollmentSpend" sort={sort} onSort={on}>Enrollment Spend</SortTh>}
                {col("totalSpend") && <SortTh k="totalSpend" sort={sort} onSort={on}>Total Spend</SortTh>}
                <th scope="col" className="r"><span className="vcn-sr">Open</span></th>
              </tr></thead>
              <tbody>
                {sorted.map((c) => (
                  <tr key={c.name} className="go" tabIndex={0} onClick={() => setDrill(c)} aria-label={`${c.name}: open students`}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrill(c); } }}>
                    <td className="nm">{c.name}</td>
                    {col("category") && <td><CategoryBadge category={c.category} /></td>}
                    {col("city") && <td className="mut">{c.cityList.join(", ") || "—"}</td>}
                    {col("leads") && <td className="r b c-lv">{fmtNum(c.leads)}</td>}
                    {col("applications") && <td className="r b c-cy">{fmtNum(c.payments)}{c.appCoupon > 0 && <span className="vcp-small"> ({fmtNum(c.appUtm)}u·{fmtNum(c.appCoupon)}c)</span>}</td>}
                    {col("enrollments") && <td className="r xb c-pk">{fmtNum(c.enrolled)}</td>}
                    {col("enrollmentSpend") && <td className="r b">{fmtINR(c.enrollSpend)}</td>}
                    {col("totalSpend") && <td className="r xb">{fmtINR(c.spend)}{c.slabSpend > 0 && <span className="vcp-under">incl {fmtINR(c.slabSpend)} slab</span>}</td>}
                    <td className="r vcp-chev"><Icon n="right" size="s" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drill && <StudentsModal sb={sb} name={drill.name} range={range} enrolled={drill.enrolled} spend={drill.spend} onClose={() => setDrill(null)} />}
      {kpiDrill && <KpiDrilldown sb={sb} kind={kpiDrill} range={range} campus={campus} visible={visible} onClose={() => setKpiDrill(null)} />}
    </>
  );
}
