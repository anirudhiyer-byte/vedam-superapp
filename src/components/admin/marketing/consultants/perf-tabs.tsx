"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/growth/consultants";
import {
  CAMPUS_OPTIONS, JOURNEY_COLUMNS, NO_CITY, NO_FILTERS, anyFilter, applyFilters, campusCode, csvDate, distinctSorted, fmtNum, journeyRows, lower,
  nextSort, parseTarget, rowKpis, rollup, sortByNum, targetNote,
  type Consultant, type DateRange, type DrillKind, type Filters, type Group, type RowKpis, type SortState,
} from "@/lib/growth/consultants-perf";
import { call, type Client } from "./api";
import { Icon } from "./icons";
import { ConsultantListModal, KpiDrilldown, StudentsModal } from "./perf-drill";
import { ErrBanner, Kpi, Modal, ModalHead, MultiSelect, SortTh, downloadCsv, usePerf } from "./perf-ui";

/** Application Journey, BDM View and City View tabs of Consultant Performance (as on the vedamcrm360 dashboard). */

function CampusLabel() {
  return <span className="vcp-lab"><Icon n="pin" size="xs" /> Campus</span>;
}
function Spinner({ on }: { on: boolean }) {
  return on ? <span className="c-mut" role="status" aria-label="Loading"><Icon n="loader" spin size="s" /></span> : null;
}

// ───────────────────────────── Application Journey (all time) ─────────────────────────────

export function JourneyTab({ sb }: { sb: Client }) {
  const [campuses, setCampuses] = useState<string[]>([]);
  const [category, setCategory] = useState<string[]>([]);
  const [city, setCity] = useState<string[]>([]);
  const { loading, list, first, err, reload } = usePerf(sb, null, campusCode(campuses));
  const cityOptions = useMemo(() => distinctSorted(list.filter((c) => c.city !== NO_CITY).map((c) => c.city)), [list]);
  const j = useMemo(() => journeyRows(list, category, city), [list, category, city]);
  const cols = j.hasOther ? [...JOURNEY_COLUMNS, { key: "other", label: "Other", stages: [] }] : JOURNEY_COLUMNS;
  const cell = (v: number, cls = "") => <td className={`c vcn-num${v === 0 ? " z" : ""}${cls ? ` ${cls}` : ""}`}>{v === 0 ? "·" : fmtNum(v)}</td>;
  return (
    <>
      <div className="vcp-row">
        <CampusLabel />
        <MultiSelect label="Campuses" allLabel="All Campuses" options={CAMPUS_OPTIONS} selected={campuses} onChange={setCampuses} />
        <MultiSelect label="Categories" allLabel="All categories" options={CATEGORIES} selected={category} onChange={setCategory} />
        <MultiSelect label="Cities" allLabel="All cities" options={cityOptions} selected={city} onChange={setCity} />
        <Spinner on={loading} />
      </div>
      {err && !first && <ErrBanner msg={err} />}
      <div className="vcn-card">
        <div className="vcp-ch"><div className="vcp-ct"><Icon n="branch" /> Application Journey — by Consultant</div><span className="vcp-hint">all time</span></div>
        {first && err ? (
          <div className="vcn-empty" role="alert"><b>Couldn&apos;t load the journey.</b><span>{err}</span>
            <button type="button" className="vcn-b" style={{ marginTop: 14 }} onClick={reload}><Icon n="refresh" size="s" /> Try again</button></div>
        ) : j.rows.length === 0 ? (
          <div className="vcn-empty"><b>{first ? "Loading…" : "No consultant-attributed data for these filters."}</b></div>
        ) : (
          <div className="vcn-scroll">
            <table className="vcn-t vcp-jt" aria-label="Application journey by consultant">
              <thead><tr>
                <th scope="col" className="st">Consultant</th>
                <th scope="col" className="br">City</th>
                <th scope="col" className="c br c-lv">Leads</th>
                <th scope="col" className="c br tot">App Total</th>
                {cols.map((c) => <th key={c.key} scope="col" className={`c${c.key === "enrolled" ? " c-pk" : ""}`}
                  title={c.stages.length ? `Stages: ${c.stages.join(", ")}${c.key === "counsel" ? ", offer_cancelled (OL cancelled)" : ""}` : "Any other stage"}>{c.label}</th>)}
              </tr></thead>
              <tbody>
                {j.rows.map((r) => (
                  <tr key={r.name}>
                    <td className="st nm">{r.name}</td>
                    <td className="mut br">{r.city || "—"}</td>
                    {cell(r.leads, "b br c-lv")}
                    <td className={`c vcn-num br tot${r.total === 0 ? " z" : ""}`} style={{ fontWeight: 800 }}>{r.total === 0 ? "·" : fmtNum(r.total)}</td>
                    {cols.map((c) => {
                      const v = r.cols[c.key] || 0;
                      if (c.key === "counsel") {
                        const all = v + r.ol;
                        return <td key={c.key} className={`c vcn-num${all === 0 ? " z" : ""}`}>{all === 0 ? "·" : <span className="vcp-cl"><span>{fmtNum(all)}</span>{r.ol > 0 && <small>{fmtNum(r.ol)} OL cancelled</small>}</span>}</td>;
                      }
                      return <td key={c.key} className={`c vcn-num${v === 0 ? " z" : c.key === "enrolled" ? " c-pk" : ""}`} style={c.key === "enrolled" && v > 0 ? { fontWeight: 700 } : undefined}>{v === 0 ? "·" : fmtNum(v)}</td>;
                    })}
                  </tr>
                ))}
                <tr className="sum">
                  <td className="st">Total</td><td className="br" />
                  <td className="c vcn-num br c-lv">{fmtNum(j.leads)}</td>
                  <td className="c vcn-num br tot">{fmtNum(j.total)}</td>
                  {cols.map((c) => {
                    const v = j.totals[c.key] || 0;
                    if (c.key === "counsel") return <td key={c.key} className="c vcn-num"><span className="vcp-cl"><span>{fmtNum(v + j.ol)}</span>{j.ol > 0 && <small>{fmtNum(j.ol)} OL cancelled</small>}</span></td>;
                    return <td key={c.key} className={`c vcn-num${c.key === "enrolled" ? " c-pk" : ""}`}>{fmtNum(v)}</td>;
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ───────────────────────────── shared: filter bar + 5 KPI cards ─────────────────────────────

function FilterBar({ campuses, setCampuses, f, setF, cities, bdms, loading }: {
  campuses: string[]; setCampuses: (v: string[]) => void; f: Filters; setF: (f: Filters) => void; cities: string[]; bdms: string[]; loading: boolean;
}) {
  return (
    <div className="vcp-row">
      <CampusLabel />
      <MultiSelect label="Campuses" allLabel="All Campuses" options={CAMPUS_OPTIONS} selected={campuses} onChange={setCampuses} />
      <MultiSelect label="Categories" allLabel="All categories" options={CATEGORIES} selected={f.category} onChange={(v) => setF({ ...f, category: v })} />
      <MultiSelect label="Cities" allLabel="All cities" options={cities} selected={f.city} onChange={(v) => setF({ ...f, city: v })} />
      <MultiSelect label="BDMs" allLabel="All BDMs" options={bdms} selected={f.bdm} onChange={(v) => setF({ ...f, bdm: v })} />
      <MultiSelect label="Statuses" allLabel="All statuses" options={["active", "inactive"]} selected={f.status} onChange={(v) => setF({ ...f, status: v })} />
      {anyFilter(f) && <button type="button" className="vcn-sbtn" onClick={() => setF(NO_FILTERS)}><Icon n="x" size="s" /> Clear</button>}
      <Spinner on={loading} />
    </div>
  );
}

function KpiRow({ k, first, onDrill }: { k: RowKpis; first: boolean; onDrill: (d: DrillKind) => void }) {
  const d = (x: DrillKind) => (first ? undefined : () => onDrill(x));
  return (
    <div className="vcp-kpis k5">
      <Kpi label="Total Consultants" color="var(--a)" loading={first} value={fmtNum(k.total)} />
      <Kpi label="Consultants Active" color="var(--a)" loading={first} value={fmtNum(k.active)} />
      <Kpi label="Leads" color="var(--lv)" loading={first} value={fmtNum(k.leads)} onClick={d("lead")} />
      <Kpi label="Applications" color="var(--cy)" loading={first} value={fmtNum(k.payments)} sub={`${fmtNum(k.appUtm)} UTM · ${fmtNum(k.appCoupon)} coupon`} onClick={d("application")} />
      <Kpi label="Enrolled" color="var(--pink)" loading={first} value={fmtNum(k.enrolled)} onClick={d("enrollment")} />
    </div>
  );
}

const G_GET: Record<string, (g: Group) => number> = {
  total: (g) => g.totalCount, active: (g) => g.activeCount, leads: (g) => g.leads, payments: (g) => g.payments, enrolled: (g) => g.enrolled,
};

/** BDM rows (BDM View, and BDMs inside a city). */
function GroupTable({ label, groups, sort, onSort, other, onOpen }: {
  label: string; groups: Group[]; sort: SortState; onSort: (k: string) => void; other: (g: Group) => string; onOpen: (g: Group) => void;
}) {
  return (
    <div className="vcn-scroll">
      <table className="vcn-t vcp-t w720" aria-label={label}>
        <thead><tr>
          <th scope="col">BDM</th><th scope="col">City</th>
          <SortTh k="total" sort={sort} onSort={onSort} center>Total Consultants</SortTh>
          <SortTh k="active" sort={sort} onSort={onSort} center>Consultants Active</SortTh>
          <SortTh k="leads" sort={sort} onSort={onSort} center>Leads</SortTh>
          <SortTh k="payments" sort={sort} onSort={onSort} center>Applications</SortTh>
          <SortTh k="enrolled" sort={sort} onSort={onSort} center>Enrollments</SortTh>
          <th scope="col" className="r"><span className="vcn-sr">Open</span></th>
        </tr></thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="go" tabIndex={0} onClick={() => onOpen(g)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(g); } }}>
              <td className="nm">{g.key}</td>
              <td className="mut">{other(g)}</td>
              <td className="c vcn-num c-mut" style={{ fontWeight: 600 }}>{fmtNum(g.totalCount)}</td>
              <td className="c b">{fmtNum(g.activeCount)}</td>
              <td className="c b c-lv">{fmtNum(g.leads)}</td>
              <td className="c b c-cy">{fmtNum(g.payments)}</td>
              <td className="c xb c-pk">{fmtNum(g.enrolled)}</td>
              <td className="r vcp-chev"><Icon n="right" size="s" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Data shared by the BDM and City tabs: numbers for the period, filters, KPI drill set. */
function useGrouped(sb: Client, range: DateRange) {
  const [campuses, setCampuses] = useState<string[]>([]);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const campus = campusCode(campuses);
  const perf = usePerf(sb, range, campus);
  const cities = useMemo(() => distinctSorted(perf.list.map((c) => c.city)), [perf.list]);
  const bdms = useMemo(() => distinctSorted(perf.list.map((c) => c.bdm)), [perf.list]);
  const filtered = useMemo(() => applyFilters(perf.list, f), [perf.list, f]);
  const k = useMemo(() => rowKpis(filtered), [filtered]);
  const visible = useMemo(() => new Set(filtered.map((c) => lower(c.name))), [filtered]);
  return { campuses, setCampuses, f, setF, campus, perf, cities, bdms, filtered, k, visible };
}

// ───────────────────────────── BDM View ─────────────────────────────

export function BdmTab({ sb, range }: { sb: Client; range: DateRange }) {
  const g = useGrouped(sb, range);
  const [sort, setSort] = useState<SortState>({ key: "payments", dir: "desc" });
  const groups = useMemo(() => sortByNum(rollup(g.filtered, "bdm"), G_GET[sort.key] ?? G_GET.payments, sort.dir), [g.filtered, sort]);
  const [openBdm, setOpenBdm] = useState<string | null>(null);
  const open = openBdm ? groups.find((x) => x.key === openBdm) ?? null : null;
  const [pick, setPick] = useState<Consultant | null>(null);
  const [drill, setDrill] = useState<DrillKind | null>(null);
  function exportCsv() {
    downloadCsv(`bdm-overview-${csvDate()}.csv`, [
      { key: "bdm", label: "BDM" }, { key: "cities", label: "Cities" }, { key: "total", label: "Total Consultants" }, { key: "active", label: "Consultants Active" },
      { key: "leads", label: "Leads" }, { key: "payments", label: "Applications" }, { key: "enrolled", label: "Enrollments" },
    ], groups.map((b) => ({ bdm: b.key, cities: b.others.join(" / "), total: b.totalCount, active: b.activeCount, leads: b.leads, payments: b.payments, enrolled: b.enrolled })));
  }
  return (
    <>
      <FilterBar campuses={g.campuses} setCampuses={g.setCampuses} f={g.f} setF={g.setF} cities={g.cities} bdms={g.bdms} loading={g.perf.loading} />
      {g.perf.err && <ErrBanner msg={g.perf.err} />}
      {!(g.perf.first && g.perf.err) && <>
        <KpiRow k={g.k} first={g.perf.first} onDrill={setDrill} />
        <div className="vcn-card">
          <div className="vcp-ch">
            <div className="vcp-ct"><Icon n="users" /> BDM Overview</div>
            <div className="vcp-cr"><span className="vcp-hint">click a BDM to drill in</span>
              <button type="button" className="vcp-sb" onClick={exportCsv} disabled={groups.length === 0}><Icon n="download" size="s" /> CSV</button></div>
          </div>
          {groups.length === 0
            ? <div className="vcn-empty"><b>{g.perf.first ? "Loading…" : "No consultants match these filters."}</b></div>
            : <GroupTable label="BDM overview" groups={groups} sort={sort} onSort={(k) => setSort((s) => nextSort(s, k))} other={(b) => b.others.join(", ")} onOpen={(b) => setOpenBdm(b.key)} />}
        </div>
      </>}
      {open && <ConsultantListModal title={open.key} subtitle={`${open.others.join(", ")} · ${open.activeCount} active`} consultants={open.consultants}
        onClose={() => setOpenBdm(null)} onPick={setPick} />}
      {pick && <StudentsModal sb={sb} name={pick.name} range={range} enrolled={pick.enrolled} spend={pick.spend} level={2} onClose={() => setPick(null)} />}
      {drill && <KpiDrilldown sb={sb} kind={drill} range={range} campus={g.campus} visible={g.visible} onClose={() => setDrill(null)} />}
    </>
  );
}

// ───────────────────────────── City View ─────────────────────────────

export function CityTab({ sb, range }: { sb: Client; range: DateRange }) {
  const g = useGrouped(sb, range);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [tErr, setTErr] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const editRef = useRef<string | null>(null);   // one save per edit (Enter, then blur, must not save twice; Esc must not save)
  const startEdit = (city: string, t: number) => { editRef.current = city; setEditing(city); setVal(String(t)); };
  const cancelEdit = () => { editRef.current = null; setEditing(null); };
  const tOf = (city: string) => {
    if (city in targets) return targets[city];
    const hit = Object.keys(targets).find((c) => lower(c) === lower(city));
    return hit ? targets[hit] : 0;
  };
  async function loadTargets() {
    const r = await call<{ targets: Record<string, number> }>(sb, "growth_cons_city_targets_get", {});
    if (r.data) setTargets(r.data.targets ?? {}); else if (r.error) setTErr(`Couldn't load the city targets. ${r.error}`);
  }
  useEffect(() => { void loadTargets(); }, [sb]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(city: string) {
    if (editRef.current !== city) return;
    cancelEdit();
    const t = parseTarget(val);
    if (t === null) { setTErr("Target must be a whole number from 0 to 10,00,000."); return; }
    if (t === tOf(city)) return;
    setTargets((cur) => ({ ...cur, [city]: t }));   // optimistic, as the CRM
    setSaving(city);
    const r = await call<{ ok: boolean }>(sb, "growth_cons_city_target_set", { city, target: t });
    setSaving(null);
    if (r.error) { setTErr(`Could not save the target for ${city}. ${r.error}`); await loadTargets(); }
    else setTErr("");
  }

  const [sort, setSort] = useState<SortState>({ key: "payments", dir: "desc" });
  const CITY_GET: Record<string, (c: Group) => number> = { ...G_GET, target: (c) => tOf(c.key), bdms: (c) => c.others.length };
  const cities = sortByNum(rollup(g.filtered, "city"), CITY_GET[sort.key] ?? CITY_GET.payments, sort.dir);
  const [openCity, setOpenCity] = useState<string | null>(null);
  const [openBdm, setOpenBdm] = useState<string | null>(null);
  const [l2Sort, setL2Sort] = useState<SortState>({ key: "payments", dir: "desc" });
  const inCity = useMemo(() => (openCity ? g.filtered.filter((c) => c.city === openCity) : []), [openCity, g.filtered]);
  const bdmsInCity = useMemo(() => sortByNum(rollup(inCity, "bdm"), G_GET[l2Sort.key] ?? G_GET.payments, l2Sort.dir), [inCity, l2Sort]);
  const bdmOpen = openBdm ? bdmsInCity.find((b) => b.key === openBdm) ?? null : null;
  const [pick, setPick] = useState<Consultant | null>(null);
  const [drill, setDrill] = useState<DrillKind | null>(null);
  function exportCsv() {
    downloadCsv(`city-overview-${csvDate()}.csv`, [
      { key: "city", label: "City" }, { key: "bdms", label: "BDMs" }, { key: "total", label: "Total Consultants" }, { key: "active", label: "Consultants Active" },
      { key: "leads", label: "Leads" }, { key: "payments", label: "Applications" }, { key: "enrolled", label: "Enrollments" },
    ], cities.map((c) => ({ city: c.key, bdms: c.others.length, total: c.totalCount, active: c.activeCount, leads: c.leads, payments: c.payments, enrolled: c.enrolled })));
  }
  const on = (k: string) => setSort((s) => nextSort(s, k));
  return (
    <>
      <FilterBar campuses={g.campuses} setCampuses={g.setCampuses} f={g.f} setF={g.setF} cities={g.cities} bdms={g.bdms} loading={g.perf.loading} />
      {g.perf.err && <ErrBanner msg={g.perf.err} />}
      {tErr && <ErrBanner msg={tErr} onClose={() => setTErr("")} />}
      {!(g.perf.first && g.perf.err) && <>
        <KpiRow k={g.k} first={g.perf.first} onDrill={setDrill} />
        <div className="vcn-card">
          <div className="vcp-ch">
            <div className="vcp-ct"><Icon n="pin" /> City Overview</div>
            <div className="vcp-cr"><span className="vcp-hint">click a city to drill in</span>
              <button type="button" className="vcp-sb" onClick={exportCsv} disabled={cities.length === 0}><Icon n="download" size="s" /> CSV</button></div>
          </div>
          {cities.length === 0 ? <div className="vcn-empty"><b>{g.perf.first ? "Loading…" : "No consultants match these filters."}</b></div> : (
            <div className="vcn-scroll">
              <table className="vcn-t vcp-t w720" aria-label="City overview">
                <thead><tr>
                  <th scope="col">City</th>
                  <SortTh k="target" sort={sort} onSort={on} center>Target</SortTh>
                  <SortTh k="bdms" sort={sort} onSort={on} center>BDMs</SortTh>
                  <SortTh k="total" sort={sort} onSort={on} center>Total Consultants</SortTh>
                  <SortTh k="active" sort={sort} onSort={on} center>Consultants Active</SortTh>
                  <SortTh k="leads" sort={sort} onSort={on} center>Leads</SortTh>
                  <SortTh k="payments" sort={sort} onSort={on} center>Applications</SortTh>
                  <SortTh k="enrolled" sort={sort} onSort={on} center>Enrollments</SortTh>
                  <th scope="col" className="r"><span className="vcn-sr">Open</span></th>
                </tr></thead>
                <tbody>
                  {cities.map((c) => {
                    const t = tOf(c.key);
                    const note = targetNote(c.enrolled, t);
                    return (
                      <tr key={c.key} className="go" tabIndex={0} onClick={() => setOpenCity(c.key)}
                        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpenCity(c.key); } }}>
                        <td className="nm">{c.key}</td>
                        <td className="c" onClick={(e) => e.stopPropagation()}>
                          {editing === c.key ? (
                            <input className="vcp-tin" autoFocus inputMode="numeric" aria-label={`Enrollment target for ${c.key}`} value={val} maxLength={9}
                              onChange={(e) => setVal(e.target.value)} onBlur={() => void save(c.key)}
                              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") void save(c.key); if (e.key === "Escape") cancelEdit(); }} />
                          ) : (
                            <button type="button" className="vcp-tgt" title="Click to edit target" aria-label={`Enrollment target for ${c.key}: ${t > 0 ? fmtNum(t) : "not set"}. Edit`}
                              onClick={() => startEdit(c.key, t)} disabled={saving === c.key}>
                              <b>{saving === c.key ? "…" : t > 0 ? fmtNum(t) : "—"}</b>
                              {note && <small className={note.hit ? "hit" : ""}>{note.pct}% · {fmtNum(note.diff)}</small>}
                            </button>
                          )}
                        </td>
                        <td className="c b">{fmtNum(c.others.length)}</td>
                        <td className="c vcn-num c-mut" style={{ fontWeight: 600 }}>{fmtNum(c.totalCount)}</td>
                        <td className="c b">{fmtNum(c.activeCount)}</td>
                        <td className="c b c-lv">{fmtNum(c.leads)}</td>
                        <td className="c b c-cy">{fmtNum(c.payments)}</td>
                        <td className="c xb c-pk">{fmtNum(c.enrolled)}</td>
                        <td className="r vcp-chev"><Icon n="right" size="s" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>}
      {openCity && !openBdm && (
        <Modal label={`${openCity} BDMs`} size="mid" onClose={() => setOpenCity(null)}>
          <ModalHead eyebrow="City · BDM Overview" title={openCity} sub={`${bdmsInCity.length} BDMs · scoped to this city`} onClose={() => setOpenCity(null)} />
          <div className="vcp-mb">
            <GroupTable label={`BDMs in ${openCity}`} groups={bdmsInCity} sort={l2Sort} onSort={(k) => setL2Sort((s) => nextSort(s, k))} other={() => openCity} onOpen={(b) => setOpenBdm(b.key)} />
          </div>
        </Modal>
      )}
      {bdmOpen && openCity && <ConsultantListModal title={`${bdmOpen.key} — ${openCity}`} subtitle={`${bdmOpen.activeCount} active · scoped to ${openCity}`}
        consultants={bdmOpen.consultants} backLabel="Back to BDMs" onClose={() => setOpenBdm(null)} onPick={setPick} />}
      {pick && <StudentsModal sb={sb} name={pick.name} range={range} enrolled={pick.enrolled} spend={pick.spend} level={2} onClose={() => setPick(null)} />}
      {drill && <KpiDrilldown sb={sb} kind={drill} range={range} campus={g.campus} visible={g.visible} onClose={() => setDrill(null)} />}
    </>
  );
}
