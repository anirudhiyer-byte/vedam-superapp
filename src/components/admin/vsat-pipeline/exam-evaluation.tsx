"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { canManage, errorText, type VsatRoles } from "@/lib/vsat/pipeline";
import { SHEET_CUTS, checkRaise, defaultVsat, femaleMaleRatio, fmtNum, parseCut, sheetTables } from "@/lib/vsat/exam-evaluation";
import { pullPassFetch, pullVsatResults } from "@/lib/vsat/pull-results";
import { Dialog, SelectForPiDialog } from "./exam-tools";
import type { Batch, BelowCutoff, BelowCutoffStudent, ExamAnalysis, RaiseResult } from "./types";

/**
 * Exam Evaluation (0172, owner's review 24 Nov 2026) — one VSAT at a time, an exact copy of the "Test Result" sheet's
 * tables: Average and percentile > 70 (every taker), the marks slabs and Male / Female (not disqualified), and the
 * Overall / ADYPU Pune / Gurugram Campus tables at 35, 60 and 65 % and above (not disqualified). On top: highest / mean /
 * lowest, the cut-off and Select for PI, and raising one student below the cut-off by hand (admins).
 * Every number comes from the database (vsat_exam_analysis, vsat_exam_below_cutoff); this page only lays them out.
 */

const VSAT_KEY = "vsat-exam-eval:vsat";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${fmtNum(n)}%`);

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={cx(vx.well, "px-3.5 py-2.5")} title={hint}>
      <dt className="text-[12px] text-vx-faint">{label}</dt>
      <dd className="mt-0.5 text-[20px] font-semibold tabular-nums tracking-[-0.01em] text-vx-ink">{value}</dd>
    </div>
  );
}

export function ExamEvaluation({ roles }: { roles: VsatRoles }) {
  const [supabase] = useState(() => createClient());
  const admin = roles.admin;
  const manager = canManage(roles);
  const [vsats, setVsats] = useState<Batch[] | null>(null);
  const [vsatId, setVsatId] = useState<string>("");
  const [byCut, setByCut] = useState<Record<number, ExamAnalysis>>({});
  const [cut, setCut] = useState<number>(65);
  const [other, setOther] = useState("");
  const [below, setBelow] = useState<BelowCutoff | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pi, setPi] = useState(false);
  const [raise, setRaise] = useState<BelowCutoffStudent | null>(null);
  const [reload, setReload] = useState(0);

  // the VSAT list (newest first); open on the last one picked here, else the latest whose exam day has come
  useEffect(() => {
    let on = true;
    void supabase.rpc("vsat_batches").then(({ data, error }) => {
      if (!on) return;
      if (error) { setErr(errorText(error.message)); setVsats([]); return; }
      const list = Array.isArray(data) ? (data as Batch[]) : [];
      setVsats(list);
      let saved = "";
      try { saved = localStorage.getItem(VSAT_KEY) ?? ""; } catch { /* storage can be off */ }
      setVsatId(list.some((b) => b.id === saved) ? saved : defaultVsat(list, today()) ?? "");
    });
    return () => { on = false; };
  }, [supabase]);

  function pickVsat(id: string) {
    setVsatId(id); setMsg("");
    try { localStorage.setItem(VSAT_KEY, id); } catch { /* storage can be off */ }
  }

  // the sheet's three cut-offs are always loaded; an "Other" one is a fourth call (switching between 35 / 60 / 65 loads nothing)
  const extraCut = (SHEET_CUTS as readonly number[]).includes(cut) ? null : cut;
  const cuts = useMemo(() => (extraCut === null ? [...SHEET_CUTS] : [...SHEET_CUTS, extraCut]), [extraCut]);
  const load = useCallback(async () => {
    if (!vsatId) return;
    setLoading(true); setErr("");
    const calls = cuts.map((c) => supabase.rpc("vsat_exam_analysis", { p: { exam_date_ids: [vsatId], percentile: c } }));
    const res = await Promise.all(calls);
    const bad = res.find((r) => r.error);
    if (bad?.error) { setErr(errorText(bad.error.message)); setByCut({}); setLoading(false); return; }
    setByCut(Object.fromEntries(cuts.map((c, i) => [c, res[i].data as ExamAnalysis])));
    if (admin) {
      const { data, error } = await supabase.rpc("vsat_exam_below_cutoff", { p: { exam_date_id: vsatId } });
      if (error) setErr(errorText(error.message)); else setBelow(data as BelowCutoff);
    }
    setLoading(false);
  }, [supabase, vsatId, cuts, admin]);
  useEffect(() => { void load(); }, [load, reload]);

  async function pull() {
    const label = vsats?.find((b) => b.id === vsatId)?.label ?? "VSAT";
    setPulling(true); setMsg(`Pulling results for ${label}…`);
    setMsg(await pullVsatResults(label, () => pullPassFetch(vsatId), setMsg));
    setPulling(false); setReload((n) => n + 1);
  }

  function applyOther() {
    const n = parseCut(other);
    if (n === null) return setErr("The cut-off must be a percentile from 0 to 100.");
    setErr(""); setCut(n);
  }

  if (!manager) return <div className={vx.page}><p className={vx.error}>Only admins and admissions can open Exam Evaluation.</p></div>;
  const base = byCut[SHEET_CUTS[0]];
  const label = vsats?.find((b) => b.id === vsatId)?.label ?? "";
  const tables = sheetTables(byCut);
  const chosen = byCut[cut]?.cutoff;

  return (
    <div className={vx.page}>
      <div className={vx.head}>
        <div>
          <h1 className={vx.h1}>Exam Evaluation</h1>
          <p className={vx.sub}>One VSAT at a time, as in the Test Result sheet. Use it to decide the cut-off, select students for PI and raise a student by hand.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className={vx.label} htmlFor="ee-vsat">VSAT</label>
            <select id="ee-vsat" className={cx(vx.field, "min-w-[12rem]")} value={vsatId} onChange={(e) => pickVsat(e.target.value)} disabled={!vsats?.length}>
              {(vsats ?? []).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          {admin && <button className={cx(vx.btn, vx.secondary)} onClick={pull} disabled={!vsatId || pulling}
            title="Fetch every student's real-exam Wheebox result for this VSAT">{pulling ? "Pulling…" : "Pull test results"}</button>}
          <button className={cx(vx.btn, vx.ghost)} onClick={() => setReload((n) => n + 1)} disabled={!vsatId || loading}>Refresh</button>
        </div>
      </div>

      {msg && <p className={cx(vx.info, "mb-4")} role="status">{msg}</p>}
      {err && <p className={cx(vx.error, "mb-4")} role="alert">{err}</p>}
      {vsats && vsats.length === 0 && <p className={vx.note}>No VSAT yet. Add one in Exam Center → Exam dates.</p>}
      {loading && !base && <p className={vx.note}>Loading…</p>}

      {base && base.takers === 0 && (
        <p className={cx(vx.info)}>No results yet for {label}. {admin ? "Pull them from Wheebox with Pull test results." : "They appear here when Wheebox sends them."}</p>
      )}

      {base && base.takers > 0 && (
        <div className="space-y-5">
          {/* ── the sheet's headline numbers + highest / mean / lowest ── */}
          <section className={cx(vx.card, vx.pad)} aria-labelledby="ee-results">
            <h2 id="ee-results" className={cx(vx.h2, "mb-3")}>Results · {label}</h2>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="Booked" value={String(base.booked)} />
              <Tile label="Took the test" value={String(base.takers)} />
              <Tile label="Disqualified" value={String(base.disqualified)} />
              <Tile label="Not disqualified" value={String(base.not_disqualified ?? base.takers - base.disqualified)} />
              <Tile label="Average" value={pct(base.avg_percentage)} hint="Average score % of everyone who took the test, as in the sheet" />
              <Tile label="Percentile above 70" value={String(base.above_70)} hint="Everyone who took the test, as in the sheet" />
            </dl>
            <div className="mt-4 overflow-x-auto">
              <table className={cx(vx.table, "min-w-[420px]")}>
                <caption className="sr-only">Highest, mean and lowest of everyone who took the test</caption>
                <thead><tr><th className={vx.th} scope="col">Everyone who took the test</th><th className={cx(vx.th, "text-right")} scope="col">Highest</th>
                  <th className={cx(vx.th, "text-right")} scope="col">Mean</th><th className={cx(vx.th, "text-right")} scope="col">Lowest</th></tr></thead>
                <tbody className="tabular-nums">
                  <tr><th className={cx(vx.td, "font-normal")} scope="row">Score %</th><td className={cx(vx.td, "text-right")}>{pct(base.max_percentage)}</td>
                    <td className={cx(vx.td, "text-right")}>{pct(base.avg_percentage)}</td><td className={cx(vx.td, "text-right")}>{pct(base.min_percentage)}</td></tr>
                  <tr><th className={cx(vx.td, "font-normal")} scope="row">Percentile</th><td className={cx(vx.td, "text-right")}>{fmtNum(base.max_percentile)}</td>
                    <td className={cx(vx.td, "text-right")}>{fmtNum(base.avg_percentile)}</td><td className={cx(vx.td, "text-right")}>{fmtNum(base.min_percentile)}</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* ── marks slab + male / female (not disqualified), as the sheet ── */}
          <div className="grid gap-5 md:grid-cols-2">
            <section className={cx(vx.card, vx.pad)} aria-labelledby="ee-slab">
              <h2 id="ee-slab" className={cx(vx.h3, "mb-3")}>Marks slab (percentile)</h2>
              <table className={vx.table}>
                <thead><tr><th className={vx.th} scope="col">Marks slab</th><th className={cx(vx.th, "text-right")} scope="col">No. of students (not disqualified)</th></tr></thead>
                <tbody className="tabular-nums">
                  {base.slabs.map((s) => (
                    <tr key={s.label}><th className={cx(vx.td, "font-normal")} scope="row">{s.label}</th><td className={cx(vx.td, "text-right text-vx-ink")}>{s.n}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className={cx(vx.card, vx.pad)} aria-labelledby="ee-gender">
              <h2 id="ee-gender" className={cx(vx.h3, "mb-3")}>Male / Female</h2>
              <table className={vx.table}>
                <thead><tr><th className={vx.th} scope="col">Gender</th><th className={cx(vx.th, "text-right")} scope="col">No. of students (not disqualified)</th></tr></thead>
                <tbody className="tabular-nums">
                  <tr><th className={cx(vx.td, "font-normal")} scope="row">Male</th><td className={cx(vx.td, "text-right text-vx-ink")}>{base.gender.male}</td></tr>
                  <tr><th className={cx(vx.td, "font-normal")} scope="row">Female</th><td className={cx(vx.td, "text-right text-vx-ink")}>{base.gender.female}</td></tr>
                  {base.gender.other > 0 && <tr><th className={cx(vx.td, "font-normal")} scope="row">Other / not given</th><td className={cx(vx.td, "text-right text-vx-ink")}>{base.gender.other}</td></tr>}
                </tbody>
              </table>
              <p className={cx(vx.note, "mt-3")}>Female : male {femaleMaleRatio(base.gender.male, base.gender.female)}</p>
            </section>
          </div>

          {/* ── Overall / ADYPU Pune / Gurugram Campus at 35, 60, 65 % and above (not disqualified) ── */}
          <div className="grid gap-5 lg:grid-cols-3">
            {tables.map((t) => (
              <section key={t.key} className={cx(vx.card, vx.pad)} aria-labelledby={`ee-${t.key}`}>
                <h2 id={`ee-${t.key}`} className={cx(vx.h3, "mb-3")}>{t.title}</h2>
                <table className={vx.table}>
                  <caption className="sr-only">{t.title}: students not disqualified at or above each percentile</caption>
                  <thead>
                    <tr><th className={vx.th} scope="col"><span className="sr-only">Gender</span></th>
                      {SHEET_CUTS.map((c) => (
                        <th key={c} className={cx(vx.th, "text-right")} scope="col">
                          {c}% and above<span className="block text-[11.5px] font-normal">VPS {fmtNum(byCut[c]?.cutoff?.vps)}</span>
                        </th>
                      ))}</tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {t.rows.map((r) => (
                      <tr key={r.label}>
                        <th className={cx(vx.td, r.label === "Total" ? "font-semibold text-vx-ink" : "font-normal")} scope="row">{r.label}</th>
                        {r.values.map((v, i) => <td key={i} className={cx(vx.td, "text-right", r.label === "Total" ? "font-semibold text-vx-ink" : "text-vx-ink")}>{v}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
          <p className={vx.note}>All three tables leave out the disqualified, as in the sheet. VPS is this VSAT&apos;s curve at that percentile.</p>

          {/* ── cut-off + Select for PI ── */}
          <section className={cx(vx.card, vx.pad)} aria-labelledby="ee-cut">
            <h2 id="ee-cut" className={cx(vx.h2, "mb-1")}>Cut-off</h2>
            <p className={cx(vx.note, "mb-3")}>
              {admin ? (below?.vps_cutoff != null ? <>Saved cut-off for {label}: VPS {fmtNum(below.vps_cutoff)}.</> : <>No cut-off saved for {label} yet. Select for PI saves it.</>)
                : <>Admins select students for PI.</>}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[13px] text-vx-mut">Percentile at least</span>
              {SHEET_CUTS.map((c) => (
                <button key={c} onClick={() => { setCut(c); setOther(""); }} aria-pressed={cut === c}
                  className={cx(vx.btn, vx.sm, cut === c ? "border-vx-violet/60 bg-vx-violet/20 text-vx-ink" : vx.ghost)}>{c}</button>
              ))}
              <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); applyOther(); }}>
                <input className={cx(vx.field, "h-8 w-[5.75rem] text-[13px]")} type="text" inputMode="decimal" placeholder="Other"
                  value={other} onChange={(e) => setOther(e.target.value)} aria-label="Other cut-off percentile" />
                {other.trim() !== "" && <button type="submit" className={cx(vx.btn, vx.secondary, vx.sm)}>Use</button>}
              </form>
            </div>
            {chosen && (
              <p className="mt-3 text-[15px] text-vx-ink">
                <b className="font-semibold tabular-nums">{chosen.total}</b> not disqualified at percentile ≥ {fmtNum(cut)}
                {chosen.vps !== null && <> · VPS ≥ {fmtNum(chosen.vps)}</>} · female : male {femaleMaleRatio(chosen.overall.male, chosen.overall.female)}
              </p>
            )}
            {admin && <button className={cx(vx.btn, vx.primary, "mt-3")} onClick={() => setPi(true)} disabled={!chosen}>Select for PI at ≥ {fmtNum(cut)}</button>}
          </section>

          {/* ── raise one student by hand (admins) ── */}
          {admin && (
            <section className={cx(vx.card, vx.pad)} aria-labelledby="ee-raise">
              <h2 id="ee-raise" className={cx(vx.h2, "mb-1")}>Below the cut-off</h2>
              {below?.vps_cutoff == null ? (
                <p className={vx.note}>Decide the cut-off first (Select for PI). Then the students below it are listed here, to raise one by hand.</p>
              ) : below.total === 0 ? (
                <p className={vx.note}>Nobody is below the cut-off (VPS {fmtNum(below.vps_cutoff)}) and still waiting.</p>
              ) : (
                <>
                  <p className={cx(vx.note, "mb-3")}>
                    {below.total} student{below.total === 1 ? "" : "s"} below VPS {fmtNum(below.vps_cutoff)}, not disqualified, not on hold, not marked ineligible
                    {below.total > below.students.length ? ` (showing the top ${below.students.length})` : ""}. Raise gives a new VPS and moves the student to VSAT cleared.
                  </p>
                  <div className="overflow-x-auto">
                    <table className={cx(vx.table, "min-w-[640px]")}>
                      <thead><tr>
                        <th className={vx.th} scope="col">Student</th><th className={cx(vx.th, "text-right")} scope="col">Percentile</th>
                        <th className={cx(vx.th, "text-right")} scope="col">Score %</th><th className={cx(vx.th, "text-right")} scope="col">VPS</th>
                        <th className={vx.th} scope="col">Gender</th><th className={vx.th} scope="col">Campus</th><th className={vx.th} scope="col"><span className="sr-only">Action</span></th>
                      </tr></thead>
                      <tbody className="tabular-nums">
                        {below.students.map((s) => (
                          <tr key={s.application_id} className={vx.row}>
                            <td className={vx.td}><span className="block text-vx-ink">{s.name ?? "—"}</span><span className="block text-[12px] text-vx-faint">{s.application_no ?? s.application_id}</span></td>
                            <td className={cx(vx.td, "text-right")}>{fmtNum(s.percentile)}</td>
                            <td className={cx(vx.td, "text-right")}>{pct(s.percentage)}</td>
                            <td className={cx(vx.td, "text-right")} title={s.vps_override !== null ? `Override in use · calculated ${fmtNum(s.vps_calculated)}` : undefined}>
                              {fmtNum(s.vps)}{s.vps_override !== null && <span className="ml-1 text-[11px] text-vx-orange-t">override</span>}</td>
                            <td className={cx(vx.td, "capitalize")}>{s.gender}</td>
                            <td className={cx(vx.td, "capitalize")}>{s.campus ?? "—"}</td>
                            <td className={cx(vx.td, "text-right")}><button className={cx(vx.btn, vx.secondary, vx.sm)} onClick={() => setRaise(s)}>Raise</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      )}

      {pi && vsatId && (
        <SelectForPiDialog examDateId={vsatId} percentile={cut} onClose={() => setPi(false)} onApplied={() => setReload((n) => n + 1)} />
      )}
      {raise && below?.vps_cutoff != null && (
        <RaiseDialog student={raise} cutoff={below.vps_cutoff} vsat={label} onClose={() => setRaise(null)}
          onDone={(r) => { setMsg(`Raised ${raise.name ?? raise.application_id} to VPS ${fmtNum(r.vps)} and moved to VSAT cleared.`); setRaise(null); setReload((n) => n + 1); }} />
      )}
    </div>
  );
}

function RaiseDialog({ student, cutoff, vsat, onClose, onDone }:
  { student: BelowCutoffStudent; cutoff: number; vsat: string; onClose: () => void; onDone: (r: RaiseResult) => void }) {
  const [supabase] = useState(() => createClient());
  const [vps, setVps] = useState(fmtNum(cutoff));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    const c = checkRaise(vps, cutoff, reason);
    if (!c.ok) return setErr(c.error);
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("vsat_exam_raise", { p: { application_id: student.application_id, vps: c.vps, reason: reason.trim() } });
    setBusy(false);
    if (error) return setErr(errorText(error.message));
    onDone(data as RaiseResult);
  }

  return (
    <Dialog title={`Raise ${student.name ?? student.application_id}`} onClose={onClose}
      sub={<>{vsat} · cut-off VPS {fmtNum(cutoff)} · now VPS {fmtNum(student.vps)} (percentile {fmtNum(student.percentile)})</>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div>
          <label className={vx.label} htmlFor="raise-vps">New VPS (at least {fmtNum(cutoff)})</label>
          <input id="raise-vps" className={vx.input} type="text" inputMode="decimal" value={vps} onChange={(e) => setVps(e.target.value)} />
        </div>
        <div>
          <label className={vx.label} htmlFor="raise-reason">Reason</label>
          <input id="raise-reason" className={vx.input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
            placeholder="e.g. Female ratio, agreed with the manager" />
        </div>
        {err && <p role="alert" className={vx.error}>{err}</p>}
        <p className={vx.note}>Saves the new VPS (the calculated {fmtNum(student.vps_calculated)} stays on record) and moves the student to VSAT cleared, with this reason in the history.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={cx(vx.btn, vx.ghost)} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={cx(vx.btn, vx.primary)} disabled={busy}>{busy ? "Raising…" : "Raise to VSAT cleared"}</button>
        </div>
      </form>
    </Dialog>
  );
}
