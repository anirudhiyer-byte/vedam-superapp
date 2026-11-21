"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LEAD_STAGE, drillRows, fmtINR, fmtNum, nextSort, sortByNum, stageBreakdown, stageCounts, stageLabel, unpaidLeads, windowParams,
  type Consultant, type DateRange, type DrillKind, type PerfStudent, type PerfStudents, type SortState,
} from "@/lib/growth/consultants-perf";
import { call, type Client } from "./api";
import { Icon } from "./icons";
import { Loading, Modal, ModalHead, SortTh } from "./perf-ui";

/** Drill-downs of Consultant Performance: KPI cards → students, consultant → students, BDM / city → consultants. */

const C = { a: "var(--a)", lv: "var(--lv)", cy: "var(--cy)", pk: "var(--pink)" };

/** Students of one request (growth_cons_perf_students). null range = all time. */
function useStudents(sb: Client, p: Record<string, string>) {
  const key = JSON.stringify(p);
  const [state, setState] = useState<{ key: string; data: PerfStudents | null; err: string }>({ key: "", data: null, err: "" });
  useEffect(() => {
    let alive = true;
    void call<PerfStudents>(sb, "growth_cons_perf_students", JSON.parse(key)).then((r) => {
      if (alive) setState({ key, data: r.data, err: r.error ?? "" });
    });
    return () => { alive = false; };
  }, [sb, key]);
  const loading = state.key !== key;
  return { loading, data: loading ? null : state.data, err: loading ? "" : state.err };
}

function Truncated({ d }: { d: PerfStudents | null }) {
  if (!d?.truncated) return null;
  return <div className="vcp-trunc">Showing the latest {fmtNum(d.students.length)} of {fmtNum(d.total)} students. Narrow the period or filters to see the rest.</div>;
}

const KIND: Record<DrillKind, { title: string; color: string }> = {
  lead: { title: "Leads", color: C.lv }, application: { title: "Applications", color: C.cy }, enrollment: { title: "Enrollments", color: C.pk },
};

/** KPI card drill-down. Applications: stage breakdown first (with the not-paid leads), then the students of a stage. */
export function KpiDrilldown({ sb, kind, range, campus, visible, onClose }: {
  sb: Client; kind: DrillKind; range: DateRange; campus: string | null; visible: Set<string>; onClose: () => void;
}) {
  const { loading, data, err } = useStudents(sb, windowParams(range, campus));
  const all = useMemo(() => data?.students ?? [], [data]);
  const rows = useMemo(() => drillRows(all, visible, kind), [all, visible, kind]);
  const unpaid = useMemo(() => (kind === "application" ? unpaidLeads(all, visible) : []), [all, visible, kind]);
  const stages = useMemo(() => (kind === "application" ? stageBreakdown(rows, unpaid.length) : []), [rows, unpaid, kind]);
  const [stage, setStage] = useState<string | null>(null);
  const meta = KIND[kind];
  const isApp = kind === "application";
  const showStages = isApp && stage === null;
  const list = !isApp ? rows : stage === LEAD_STAGE ? unpaid : rows.filter((r) => (r.stage || "no_application") === stage);
  const title = isApp && stage !== null ? (stage === LEAD_STAGE ? "Lead Stage — not paid" : stageLabel(stage)) : meta.title;
  return (
    <Modal label={title} size="big" onClose={onClose}>
      <ModalHead color={meta.color} onClose={onClose} title={title}
        eyebrow={isApp && stage !== null ? <button type="button" className="vcp-back" onClick={() => setStage(null)}><Icon n="arrowL" size="xs" /> Back to stages</button> : meta.title}
        sub={loading ? "Loading…" : showStages ? `${fmtNum(rows.length)} paid · ${fmtNum(unpaid.length)} not paid · ${stages.length} stages` : `${fmtNum(list.length)} students`} />
      <div className="vcp-mb">
        {loading ? <Loading text="Loading students…" color={meta.color} /> : err ? <div className="vcn-empty" role="alert"><b>Couldn&apos;t load the students.</b><span>{err}</span></div> : (
          <>
            <Truncated d={data} />
            {showStages ? (
              <div className="vcp-stl">
                {stages.length === 0 ? <div className="vcn-empty"><b>No applications in view.</b></div> : <>
                  <div className="vcp-sth"><Icon n="branch" size="s" /> Application stage breakdown</div>
                  {stages.map((s) => {
                    const lead = s.stage === LEAD_STAGE;
                    const k = lead ? C.lv : s.stage === "enrolled" ? C.pk : C.a;
                    return (
                      <button key={s.stage} type="button" className="vcp-sr" style={{ ["--k" as string]: k }} onClick={() => setStage(s.stage)}>
                        <span>{lead ? "Lead Stage (not paid)" : stageLabel(s.stage)}</span>
                        <span className="vcp-srr"><span className="vcp-pct">{s.pct.toFixed(1)}%</span><b style={{ color: lead || s.stage === "enrolled" ? k : undefined }}>{fmtNum(s.n)}</b></span>
                      </button>
                    );
                  })}
                </>}
              </div>
            ) : <StudentTable rows={list} withConsultant />}
          </>
        )}
      </div>
    </Modal>
  );
}

export function StudentTable({ rows, withConsultant }: { rows: PerfStudent[]; withConsultant?: boolean }) {
  return (
    <div className="vcn-scroll">
      <table className={`vcn-t ${withConsultant ? "vcp-t" : "vcp-t w640"}`}>
        <thead><tr>
          <th scope="col">Name</th>
          {withConsultant && <><th scope="col">Consultant</th><th scope="col">City</th><th scope="col">BDM</th></>}
          <th scope="col">Email</th><th scope="col">Mobile</th><th scope="col">Stage</th><th scope="col">Payment</th><th scope="col">Campus</th>
        </tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={withConsultant ? 9 : 6}><div className="vcn-empty"><b>No students in view.</b></div></td></tr>
          ) : rows.map((s) => (
            <tr key={`${s.lead_id}-${s.consultant_name}`}>
              <td className="nm">{s.name || "—"}</td>
              {withConsultant && <><td className="c-a" style={{ fontWeight: 600 }}>{s.consultant_name || "—"}</td><td>{s.city || "—"}</td><td>{s.bdm || "—"}</td></>}
              <td title={s.email || ""} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{s.email || "—"}</td>
              <td className="vcn-num">{s.mobile || "—"}</td>
              <td className={s.stage === "enrolled" ? "c-pk" : ""} style={{ fontWeight: 600 }}>{stageLabel(s.stage)}</td>
              <td>{s.payment_status || "—"}</td>
              <td>{s.campus_preference || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Consultant drill: the consultant's students + stage breakdown, for the period shown (null = all time). */
export function StudentsModal({ sb, name, range, enrolled, spend, level = 1, onClose }: {
  sb: Client; name: string; range: DateRange | null; enrolled: number; spend: number; level?: 1 | 2 | 3; onClose: () => void;
}) {
  const p = useMemo(() => ({ consultant: name, ...(range ? windowParams(range, null) : {}) }), [name, range]);
  const { loading, data, err } = useStudents(sb, p);
  const students = useMemo(() => data?.students ?? [], [data]);
  const counts = useMemo(() => stageCounts(students), [students]);
  return (
    <Modal label={`${name} students`} level={level} onClose={onClose}>
      <ModalHead eyebrow="Consultant Drill" title={name} onClose={onClose}
        sub={`${loading ? "…" : fmtNum(data?.total ?? students.length)} students · ${fmtNum(enrolled)} enrolled · ${fmtINR(spend)} spend`} />
      <div className="vcp-mb">
        {loading ? <Loading /> : err ? <div className="vcn-empty" role="alert"><b>Couldn&apos;t load the students.</b><span>{err}</span></div> : (
          <div className="vcp-split">
            <div>
              <Truncated d={data} />
              {students.length === 0
                ? <div className="vcn-empty"><b>No students found for this consultant&apos;s UTM or coupon.</b></div>
                : <StudentTable rows={students} />}
            </div>
            <div className="vcp-stg">
              <div className="vcp-sth"><Icon n="branch" size="s" /> Stage Breakdown</div>
              {counts.length === 0 ? <div className="c-mut" style={{ fontSize: 13 }}>No stages.</div> : counts.map(([s, c]) => (
                <div key={s} className="vcp-sr" style={{ ["--k" as string]: s === "enrolled" ? C.pk : C.a }}>
                  <span>{stageLabel(s)}</span><b className={s === "enrolled" ? "c-pk" : ""}>{fmtNum(c)}</b>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Consultants under a BDM (BDM view) or under a BDM in a city (City view). */
export function ConsultantListModal({ title, subtitle, consultants, backLabel, level = 1, onClose, onPick }: {
  title: string; subtitle: string; consultants: Consultant[]; backLabel?: string; level?: 1 | 2 | 3; onClose: () => void; onPick: (c: Consultant) => void;
}) {
  const [sort, setSort] = useState<SortState>({ key: "payments", dir: "desc" });
  const GET: Record<string, (c: Consultant) => number> = { leads: (c) => c.leads, payments: (c) => c.payments, enrolled: (c) => c.enrolled, spend: (c) => c.spend };
  const rows = sortByNum(consultants, GET[sort.key] ?? GET.payments, sort.dir);
  const on = (k: string) => setSort((s) => nextSort(s, k));
  return (
    <Modal label={title} size="mid" level={level} onClose={onClose}>
      <ModalHead onClose={onClose} title={title} sub={subtitle}
        eyebrow={backLabel ? <button type="button" className="vcp-back" onClick={onClose}><Icon n="arrowL" size="xs" /> {backLabel}</button> : "Consultants"} />
      <div className="vcp-mb">
        <div className="vcn-scroll">
          <table className="vcn-t vcp-t w720">
            <thead><tr>
              <th scope="col">Consultant</th>
              <SortTh k="leads" sort={sort} onSort={on}>Leads</SortTh>
              <SortTh k="payments" sort={sort} onSort={on}>Applications</SortTh>
              <SortTh k="enrolled" sort={sort} onSort={on}>Enrollments</SortTh>
              <SortTh k="spend" sort={sort} onSort={on}>Payouts</SortTh>
              <th scope="col" className="r"><span className="vcn-sr">Open</span></th>
            </tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.name} className="go" tabIndex={0} onClick={() => onPick(c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(c); } }}>
                  <td className="nm">{c.name}{!c.active && <span className="vcp-small" style={{ marginLeft: 8 }}>(inactive)</span>}</td>
                  <td className="r b c-lv">{fmtNum(c.leads)}</td>
                  <td className="r b c-cy">{fmtNum(c.payments)}{c.appCoupon > 0 && <span className="vcp-small"> ({fmtNum(c.appUtm)}u·{fmtNum(c.appCoupon)}c)</span>}</td>
                  <td className="r xb c-pk">{fmtNum(c.enrolled)}</td>
                  <td className="r b">{fmtINR(c.spend)}</td>
                  <td className="r vcp-chev"><Icon n="right" size="s" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
