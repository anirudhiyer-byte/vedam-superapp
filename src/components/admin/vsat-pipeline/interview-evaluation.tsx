"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { STAGE_LABEL, canManage, errorText, type Stage, type VsatRoles } from "@/lib/vsat/pipeline";
import { defaultVsat, fmtNum } from "@/lib/vsat/exam-evaluation";
import {
  FINAL_MAX, SUMMARY_LABEL, changesVerdict, parseScores, rangeLabels, verdictLabel,
  type InterviewAnalysis, type SetVerdictsResult, type Verdict,
} from "@/lib/vsat/interview-evaluation";
import { campusLabel } from "@/lib/vsat/leads-grid";
import { Dialog } from "./exam-tools";
import type { Batch } from "./types";

/**
 * Interview Evaluation (0173, owner's review 24 Nov 2026) — one VSAT at a time, the interview sheet's evaluation:
 * weighted score (the five parts × the sheet's weights), final score (× 4, out of 20), highest / mean / lowest, and the
 * table of Everyone / Selected / Maybe / Rejected (students, average, highest, lowest, median final score).
 * The Selected and Maybe scores are decided here; saving them gives every interviewed student of the VSAT a verdict,
 * which shows in the Interview table. The stage does not move: admissions moves students to PI cleared by hand.
 * Every number comes from the database (vsat_interview_analysis, vsat_interview_set_verdicts); this page lays them out.
 */

const VSAT_KEY = "vsat-intv-eval:vsat";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const scoreText = (n: number | null | undefined) => (n === null || n === undefined ? "" : fmtNum(n));
const VERDICT_TONE: Record<Verdict, string> = { selected: vx.tone.green, maybe: vx.tone.orange, not_selected: vx.tone.red };

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={cx(vx.well, "px-3.5 py-2.5")} title={hint}>
      <dt className="text-[12px] text-vx-faint">{label}</dt>
      <dd className="mt-0.5 text-[20px] font-semibold tabular-nums tracking-[-0.01em] text-vx-ink">{value}</dd>
    </div>
  );
}

function VerdictBadge({ v }: { v: Verdict | null }) {
  return v ? <span className={cx(vx.badge, VERDICT_TONE[v])}>{verdictLabel(v)}</span> : <span className="text-vx-faint">{verdictLabel(v)}</span>;
}

export function InterviewEvaluation({ roles }: { roles: VsatRoles }) {
  const [supabase] = useState(() => createClient());
  const admin = roles.admin;
  const manager = canManage(roles);
  const [vsats, setVsats] = useState<Batch[] | null>(null);
  const [vsatId, setVsatId] = useState("");
  const [data, setData] = useState<InterviewAnalysis | null>(null);
  const [selText, setSelText] = useState("");
  const [maybeText, setMaybeText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [reload, setReload] = useState(0);

  // the VSAT list (newest first); open on the last one picked here, else the latest whose exam day has come
  useEffect(() => {
    let on = true;
    void supabase.rpc("vsat_batches").then(({ data: list0, error }) => {
      if (!on) return;
      if (error) { setErr(errorText(error.message)); setVsats([]); return; }
      const list = Array.isArray(list0) ? (list0 as Batch[]) : [];
      setVsats(list);
      let saved = "";
      try { saved = localStorage.getItem(VSAT_KEY) ?? ""; } catch { /* storage can be off */ }
      setVsatId(list.some((b) => b.id === saved) ? saved : defaultVsat(list, today()) ?? "");
    });
    return () => { on = false; };
  }, [supabase]);

  function pickVsat(id: string) {
    setVsatId(id); setMsg(""); setErr("");
    try { localStorage.setItem(VSAT_KEY, id); } catch { /* storage can be off */ }
  }

  /** Loads the VSAT with its saved scores (scores = null) or with the two scores typed here (a preview, nothing saved). */
  const fetchAnalysis = useCallback(async (scores: { selectMin: number; maybeMin: number } | null) => {
    if (!vsatId) return null;
    setLoading(true); setErr("");
    const p: Record<string, unknown> = { exam_date_id: vsatId };
    if (scores) { p.select_min = scores.selectMin; p.maybe_min = scores.maybeMin; }
    const { data: d, error } = await supabase.rpc("vsat_interview_analysis", { p });
    setLoading(false);
    if (error) { setErr(errorText(error.message)); return null; }
    return d as InterviewAnalysis;
  }, [supabase, vsatId]);

  // a new VSAT or Refresh: the saved scores (if any) fill the two boxes
  useEffect(() => {
    let on = true;
    setData(null);
    void fetchAnalysis(null).then((d) => {
      if (!on || !d) return;
      setData(d); setSelText(scoreText(d.saved.select_min)); setMaybeText(scoreText(d.saved.maybe_min));
    });
    return () => { on = false; };
  }, [fetchAnalysis, reload]);

  const parsed = parseScores(selText, maybeText);
  const shown = data?.used;
  // the numbers on the page are for exactly the two scores in the boxes (a preview of them, or the saved ones)
  const inSync = parsed.ok && shown?.select_min === parsed.selectMin && shown?.maybe_min === parsed.maybeMin;

  async function preview() {
    if (!parsed.ok) return setErr(parsed.error);
    setMsg("");
    const d = await fetchAnalysis({ selectMin: parsed.selectMin, maybeMin: parsed.maybeMin });
    if (d) setData(d);
  }

  if (!manager) return <div className={vx.page}><p className={vx.error}>Only admins and admissions can open Interview Evaluation.</p></div>;
  const label = data?.vsat ?? vsats?.find((b) => b.id === vsatId)?.label ?? "";
  const saved = data?.saved;
  const hasSaved = saved?.select_min != null && saved?.maybe_min != null;
  const ranges = rangeLabels(shown?.select_min ?? null, shown?.maybe_min ?? null, (n) => fmtNum(n));
  const changed = data ? data.students.filter(changesVerdict).length : 0;
  const all = data?.summary.find((s) => s.key === "all");

  return (
    <div className={vx.page}>
      <div className={vx.head}>
        <div>
          <h1 className={vx.h1}>Interview Evaluation</h1>
          <p className={vx.sub}>One VSAT at a time, as in the interview sheet. Decide the Selected and Maybe scores here; every interviewed student then gets a verdict in the Interview table.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className={vx.label} htmlFor="ie-vsat">VSAT</label>
            <select id="ie-vsat" className={cx(vx.field, "min-w-[12rem]")} value={vsatId} onChange={(e) => pickVsat(e.target.value)} disabled={!vsats?.length}>
              {(vsats ?? []).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <button className={cx(vx.btn, vx.ghost)} onClick={() => { setMsg(""); setReload((n) => n + 1); }} disabled={!vsatId || loading}>Refresh</button>
        </div>
      </div>

      {msg && <p className={cx(vx.ok, "mb-4")} role="status">{msg}</p>}
      {err && <p className={cx(vx.error, "mb-4")} role="alert">{err}</p>}
      {vsats && vsats.length === 0 && <p className={vx.note}>No VSAT yet. Add one in Exam Center → Exam dates.</p>}
      {loading && !data && <p className={vx.note}>Loading…</p>}

      {data && (
        <div className="space-y-5">
          {/* ── headline numbers ── */}
          <section className={cx(vx.card, vx.pad)} aria-labelledby="ie-results">
            <h2 id="ie-results" className={cx(vx.h2, "mb-3")}>Interviews · {label}</h2>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Tile label="Booked" value={String(data.booked)} hint="Students with an interview booked (not cancelled) in this attempt" />
              <Tile label="Interviewed" value={String(data.interviewed)} hint="The interview form is submitted" />
              <Tile label="Form not submitted yet" value={String(data.waiting)} />
              <Tile label="Cheating" value={String(data.cheating)} hint="Rejected straight away, whatever the scores" />
              <Tile label={`Average final score (out of ${FINAL_MAX})`} value={fmtNum(all?.avg)} />
            </dl>
            {data.interviewed === 0 ? (
              <p className={cx(vx.note, "mt-4")}>No interview form is submitted yet for {label}. The numbers appear here as interviewers submit the form.</p>
            ) : (
              <p className={cx(vx.note, "mt-3")}>
                Weighted score (out of 5): highest {fmtNum(data.weighted.max)} · mean {fmtNum(data.weighted.avg)} · lowest {fmtNum(data.weighted.min)}.
                The final score is the weighted score × 4.
              </p>
            )}
          </section>

          {data.interviewed > 0 && (
            <>
              {/* ── the sheet's table ── */}
              <section className={cx(vx.card, vx.pad)} aria-labelledby="ie-table">
                <h2 id="ie-table" className={cx(vx.h2, "mb-1")}>Final score (out of {FINAL_MAX})</h2>
                <p className={cx(vx.note, "mb-3")}>
                  {shown?.select_min == null ? "No Selected / Maybe scores yet, so only cheating decides a verdict so far."
                    : shown.preview ? <>With the scores in the boxes below (not saved): Selected from {fmtNum(shown.select_min)}, Maybe from {fmtNum(shown.maybe_min)}.</>
                    : <>With the saved scores: Selected from {fmtNum(shown.select_min)}, Maybe from {fmtNum(shown.maybe_min)}.</>}
                </p>
                <div className="overflow-x-auto">
                  <table className={cx(vx.table, "min-w-[560px]")}>
                    <thead><tr>
                      <th className={vx.th} scope="col"><span className="sr-only">Group</span></th>
                      {["Students", "Average", "Highest", "Lowest", "Median"].map((h) => <th key={h} className={cx(vx.th, "text-right")} scope="col">{h}</th>)}
                    </tr></thead>
                    <tbody className="tabular-nums">
                      {data.summary.map((s) => (
                        <tr key={s.key}>
                          <th className={cx(vx.td, s.key === "all" ? "font-semibold text-vx-ink" : "font-normal")} scope="row">{SUMMARY_LABEL[s.key]}</th>
                          <td className={cx(vx.td, "text-right text-vx-ink")}>{s.n}</td>
                          <td className={cx(vx.td, "text-right")}>{fmtNum(s.avg)}</td>
                          <td className={cx(vx.td, "text-right")}>{fmtNum(s.max)}</td>
                          <td className={cx(vx.td, "text-right")}>{fmtNum(s.min)}</td>
                          <td className={cx(vx.td, "text-right")}>{fmtNum(s.median)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ── the Selected / Maybe scores ── */}
              <section className={cx(vx.card, vx.pad)} aria-labelledby="ie-scores">
                <h2 id="ie-scores" className={cx(vx.h2, "mb-1")}>Verdict scores</h2>
                <p className={cx(vx.note, "mb-3")}>
                  {hasSaved
                    ? <>Saved for {label}: Selected from {fmtNum(saved!.select_min)}, Maybe from {fmtNum(saved!.maybe_min)}{saved!.set_by ? ` (by ${saved!.set_by})` : ""}. </>
                    : <>No verdict scores saved for {label} yet. </>}
                  Final score at or above the Selected score → Selected; at or above the Maybe score → Maybe; below it → Rejected. Cheating → Rejected.
                </p>
                <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void preview(); }}>
                  <div>
                    <label className={vx.label} htmlFor="ie-sel">Selected from (out of {FINAL_MAX})</label>
                    <input id="ie-sel" className={cx(vx.field, "w-[9rem]")} type="text" inputMode="decimal" value={selText} onChange={(e) => setSelText(e.target.value)} />
                  </div>
                  <div>
                    <label className={vx.label} htmlFor="ie-maybe">Maybe from (out of {FINAL_MAX})</label>
                    <input id="ie-maybe" className={cx(vx.field, "w-[9rem]")} type="text" inputMode="decimal" value={maybeText} onChange={(e) => setMaybeText(e.target.value)} />
                  </div>
                  <button type="submit" className={cx(vx.btn, vx.secondary)} disabled={loading || inSync}>{loading ? "Counting…" : "Show counts"}</button>
                  {admin && (
                    <button type="button" className={cx(vx.btn, vx.primary)} disabled={loading || !inSync} onClick={() => setConfirm(true)}
                      title={inSync ? undefined : "Show counts for these scores first"}>Save verdicts</button>
                  )}
                </form>
                {inSync && shown?.select_min != null && (
                  <p className="mt-3 text-[15px] text-vx-ink tabular-nums">
                    {ranges.selected}: <b className="font-semibold">{data.ranges.selected}</b> · {ranges.maybe}: <b className="font-semibold">{data.ranges.maybe}</b> ·{" "}
                    {ranges.not_selected}: <b className="font-semibold">{data.ranges.not_selected}</b>
                    {data.ranges.undecided > 0 && <> · Not decided yet: <b className="font-semibold">{data.ranges.undecided}</b></>}
                  </p>
                )}
                {inSync && shown?.preview && <p className={cx(vx.note, "mt-1")}>{changed} student{changed === 1 ? "" : "s"} would get a different verdict from the one saved now. Nothing is saved until you press Save verdicts.</p>}
                {!inSync && parsed.ok && <p className={cx(vx.note, "mt-2")}>Press Show counts to see these scores on the page.</p>}
                {!admin && <p className={cx(vx.note, "mt-2")}>Admins save the verdict scores.</p>}
              </section>

              {/* ── the students ── */}
              <section className={cx(vx.card, vx.pad)} aria-labelledby="ie-students">
                <h2 id="ie-students" className={cx(vx.h2, "mb-1")}>Students</h2>
                <p className={cx(vx.note, "mb-3")}>
                  Everyone interviewed in {label}, highest final score first{data.interviewed > data.students.length ? ` (the top ${data.students.length})` : ""}.
                  To move students to PI cleared, open the Interview table and filter Verdict = Selected.
                </p>
                <div className="overflow-x-auto">
                  <table className={cx(vx.table, "min-w-[860px]")}>
                    <thead><tr>
                      <th className={vx.th} scope="col">Student</th><th className={vx.th} scope="col">Campus</th><th className={vx.th} scope="col">Interviewer</th>
                      <th className={cx(vx.th, "text-right")} scope="col">Weighted (of 5)</th><th className={cx(vx.th, "text-right")} scope="col">Final (of {FINAL_MAX})</th>
                      <th className={vx.th} scope="col">Verdict</th>
                      {shown?.preview && <th className={vx.th} scope="col">With these scores</th>}
                      <th className={vx.th} scope="col">Stage</th>
                    </tr></thead>
                    <tbody className="tabular-nums">
                      {data.students.map((s) => (
                        <tr key={s.application_id} className={vx.row}>
                          <td className={vx.td}>
                            <span className="block text-vx-ink">{s.name ?? "—"}</span>
                            <span className="block text-[12px] text-vx-faint">{s.application_no ?? s.application_id}</span>
                          </td>
                          <td className={vx.td}>{campusLabel(s.campus)}</td>
                          <td className={vx.td}>{s.interviewer ?? "—"}</td>
                          <td className={cx(vx.td, "text-right")}>{fmtNum(s.weighted)}</td>
                          <td className={cx(vx.td, "text-right text-vx-ink")}>{fmtNum(s.final)}
                            {s.cheating && <span className={cx(vx.badge, vx.tone.red, "ml-2")}>Cheating</span>}</td>
                          <td className={vx.td}><VerdictBadge v={s.verdict} /></td>
                          {shown?.preview && (
                            <td className={vx.td}>
                              <VerdictBadge v={s.verdict_preview} />
                              {changesVerdict(s) && <span className="ml-1.5 text-[11.5px] text-vx-orange-t">changes</span>}
                            </td>
                          )}
                          <td className={vx.td}>{STAGE_LABEL[s.stage as Stage] ?? s.stage}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {confirm && data && parsed.ok && inSync && (
        <SaveVerdictsDialog examDateId={vsatId} vsat={label} selectMin={parsed.selectMin} maybeMin={parsed.maybeMin}
          counts={data.ranges} changed={changed} onClose={() => setConfirm(false)}
          onDone={(r) => {
            setConfirm(false);
            setMsg(`Saved for ${r.vsat}: ${r.counts.selected} Selected · ${r.counts.maybe} Maybe · ${r.counts.not_selected} Rejected (${r.changed} verdict${r.changed === 1 ? "" : "s"} changed). The verdict now shows in the Interview table.`);
            setReload((n) => n + 1);
          }} />
      )}
    </div>
  );
}

function SaveVerdictsDialog({ examDateId, vsat, selectMin, maybeMin, counts, changed, onClose, onDone }: {
  examDateId: string; vsat: string; selectMin: number; maybeMin: number;
  counts: InterviewAnalysis["ranges"]; changed: number; onClose: () => void; onDone: (r: SetVerdictsResult) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("vsat_interview_set_verdicts", { p: { exam_date_id: examDateId, select_min: selectMin, maybe_min: maybeMin } });
    setBusy(false);
    if (error) return setErr(errorText(error.message));
    onDone(data as SetVerdictsResult);
  }

  return (
    <Dialog title={`Save verdicts for ${vsat}`} onClose={onClose}
      sub={<>Selected from {fmtNum(selectMin)} · Maybe from {fmtNum(maybeMin)} (final score out of {FINAL_MAX})</>}>
      <div className="space-y-3">
        <p className="text-[15px] text-vx-ink tabular-nums">
          {counts.selected} Selected · {counts.maybe} Maybe · {counts.not_selected} Rejected
          {counts.undecided > 0 && <> · {counts.undecided} not decided</>}
        </p>
        <p className={vx.note}>
          {changed} student{changed === 1 ? "" : "s"} get{changed === 1 ? "s" : ""} a different verdict from the one saved now. The verdict shows in the Interview table and on each
          student&apos;s profile. Students interviewed later get their verdict from these scores when their form is submitted.
        </p>
        <p className={vx.note}>No stage changes. Admissions moves the selected students to PI cleared.</p>
        {err && <p role="alert" className={vx.error}>{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={cx(vx.btn, vx.ghost)} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={cx(vx.btn, vx.primary)} onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save verdicts"}</button>
        </div>
      </div>
    </Dialog>
  );
}
