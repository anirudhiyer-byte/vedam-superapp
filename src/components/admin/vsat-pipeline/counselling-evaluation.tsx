"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { STAGE_LABEL, canManage, errorText, fmtIst, type Stage, type VsatRoles } from "@/lib/vsat/pipeline";
import { defaultVsat } from "@/lib/vsat/exam-evaluation";
import { ATTENDANCE_LABEL } from "@/lib/vsat/interviews";
import { campusLabel } from "@/lib/vsat/leads-grid";
import {
  LIST_CAP, adjustment, feedbackLabel, modeLabel, pct, rupees, rupeesShort, share, type CounsellingAnalysis,
} from "@/lib/vsat/counselling-evaluation";
import type { Batch } from "./types";

/**
 * Counselling Evaluation (0184, owner's review 24 Nov 2026) — one VSAT at a time: who reached counselling and chose
 * Online / Offline, the booked sessions and their Status, the counsellor's "likely to pay" feedback, the scholarship
 * given (the formula's % and the awarded % after the counsellor's ±5) and the ARPU — the average fee a counselled
 * student pays after the scholarship — per campus and overall. Read only: every number comes from
 * vsat_counselling_analysis (campus scope of the admissions member applies there).
 */

const VSAT_KEY = "vsat-couns-eval:vsat";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const FEEDBACK_TONE: Record<string, string> = { likely: vx.tone.green, may_or_may_not: vx.tone.orange, unlikely: vx.tone.red };

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={cx(vx.well, "px-3.5 py-2.5")} title={hint}>
      <dt className="text-[12px] text-vx-faint">{label}</dt>
      <dd className="mt-0.5 text-[20px] font-semibold tabular-nums tracking-[-0.01em] text-vx-ink">{value}</dd>
    </div>
  );
}

/** One row of a "how many of N" breakdown: label, count, share, and a thin bar for the share. */
function Share({ label, n, of, tone }: { label: string; n: number; of: number; tone?: string }) {
  const w = of > 0 ? Math.round((n / of) * 100) : 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_3.2rem] items-center gap-x-3 gap-y-1 py-1.5 text-sm">
      <span className="text-vx-ink">{label}</span>
      <span className="tabular-nums text-vx-ink">{n}</span>
      <span className="text-right tabular-nums text-vx-faint">{share(n, of)}</span>
      <span className="col-span-3 h-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <span className={cx("block h-full rounded-full", tone ?? "bg-vx-violet/70")} style={{ width: `${w}%` }} />
      </span>
    </li>
  );
}

export function CounsellingEvaluation({ roles }: { roles: VsatRoles }) {
  const [supabase] = useState(() => createClient());
  const manager = canManage(roles);
  const [vsats, setVsats] = useState<Batch[] | null>(null);
  const [vsatId, setVsatId] = useState("");
  const [campus, setCampus] = useState<"" | "pune" | "gurugram">("");
  const [data, setData] = useState<CounsellingAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
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
    setVsatId(id); setErr("");
    try { localStorage.setItem(VSAT_KEY, id); } catch { /* storage can be off */ }
  }

  const fetchAnalysis = useCallback(async () => {
    if (!vsatId) return null;
    setLoading(true); setErr("");
    const p: Record<string, unknown> = { exam_date_id: vsatId };
    if (campus) p.campus = campus;
    const { data: d, error } = await supabase.rpc("vsat_counselling_analysis", { p });
    setLoading(false);
    if (error) { setErr(errorText(error.message)); return null; }
    return d as CounsellingAnalysis;
  }, [supabase, vsatId, campus]);

  useEffect(() => {
    let on = true;
    setData(null);
    void fetchAnalysis().then((d) => { if (on && d) setData(d); });
    return () => { on = false; };
  }, [fetchAnalysis, reload]);

  if (!manager) return <div className={vx.page}><p className={vx.error}>Only admins and admissions can open Counselling Evaluation.</p></div>;
  const label = data?.vsat ?? vsats?.find((b) => b.id === vsatId)?.label ?? "";
  const where = data?.campus ? ` · ${campusLabel(data.campus)}` : "";
  const booked = data?.booked ?? 0;

  return (
    <div className={vx.page}>
      <div className={vx.head}>
        <div>
          <h1 className={vx.h1}>Counselling Evaluation</h1>
          <p className={vx.sub}>One VSAT at a time: who chose online or offline, how the sessions went, the counsellors&apos; feedback, the scholarship given and the ARPU.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className={vx.label} htmlFor="ce-vsat">VSAT</label>
            <select id="ce-vsat" className={cx(vx.field, "min-w-[12rem]")} value={vsatId} onChange={(e) => pickVsat(e.target.value)} disabled={!vsats?.length}>
              {(vsats ?? []).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label className={vx.label} htmlFor="ce-campus">Campus</label>
            <select id="ce-campus" className={cx(vx.field, "min-w-[8rem]")} value={campus} onChange={(e) => setCampus(e.target.value as typeof campus)}>
              <option value="">Both</option><option value="pune">Pune</option><option value="gurugram">Gurugram</option>
            </select>
          </div>
          <button className={cx(vx.btn, vx.ghost)} onClick={() => setReload((n) => n + 1)} disabled={!vsatId || loading}>Refresh</button>
        </div>
      </div>

      {err && <p className={cx(vx.error, "mb-4")} role="alert">{err}</p>}
      {vsats && vsats.length === 0 && <p className={vx.note}>No VSAT yet. Add one in Exam Center → Exam dates.</p>}
      {loading && !data && <p className={vx.note}>Loading…</p>}

      {data && (
        <div className="space-y-5">
          {/* ── headline numbers ── */}
          <section className={cx(vx.card, vx.pad)} aria-labelledby="ce-results">
            <h2 id="ce-results" className={cx(vx.h2, "mb-3")}>Counselling · {label}{where}</h2>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="Reached counselling" value={String(data.students)} hint="PI cleared and every stage after it, this attempt" />
              <Tile label="Chose online" value={String(data.mode.online)} />
              <Tile label="Chose offline" value={String(data.mode.offline)} />
              <Tile label="Booked" value={String(data.booked)} hint="An online session is booked or an offline one is recorded (not cancelled)" />
              <Tile label="Counselled" value={String(data.counselled)} hint="The counselling form is saved: the scholarship is decided" />
              <Tile label="ARPU" value={rupeesShort(data.arpu)} hint="Average fee a counselled student pays after the scholarship" />
            </dl>
            {data.students === 0 && <p className={cx(vx.note, "mt-4")}>No student of {label}{where} has reached counselling yet. The numbers appear as admissions move students to PI cleared.</p>}
          </section>

          {data.students > 0 && (
            <>
              <div className="grid gap-5 lg:grid-cols-3">
                <section className={cx(vx.card, vx.pad)} aria-labelledby="ce-mode">
                  <h2 id="ce-mode" className={cx(vx.h2, "mb-1")}>Online or offline</h2>
                  <p className={cx(vx.note, "mb-2")}>The student&apos;s choice on the dashboard, or set by admissions.</p>
                  <ul>
                    <Share label="Online" n={data.mode.online} of={data.students} />
                    <Share label="Offline" n={data.mode.offline} of={data.students} tone="bg-vx-teal/70" />
                    <Share label="Not chosen yet" n={data.mode.not_chosen} of={data.students} tone="bg-white/25" />
                  </ul>
                </section>
                <section className={cx(vx.card, vx.pad)} aria-labelledby="ce-status">
                  <h2 id="ce-status" className={cx(vx.h2, "mb-1")}>Booked sessions</h2>
                  <p className={cx(vx.note, "mb-2")}>Status of the {booked} booked session{booked === 1 ? "" : "s"} (set by hand: Zoom is not read).</p>
                  <ul>
                    <Share label="Done" n={data.status.done} of={booked} tone="bg-vx-green/70" />
                    <Share label="No-show" n={data.status.no_show} of={booked} tone="bg-vx-red/70" />
                    <Share label="Rescheduled" n={data.status.rescheduled} of={booked} tone="bg-vx-orange/70" />
                    <Share label="Not marked yet" n={data.status.not_marked} of={booked} tone="bg-white/25" />
                  </ul>
                </section>
                <section className={cx(vx.card, vx.pad)} aria-labelledby="ce-feedback">
                  <h2 id="ce-feedback" className={cx(vx.h2, "mb-1")}>Counsellor feedback</h2>
                  <p className={cx(vx.note, "mb-2")}>Of the {data.counselled} counselled student{data.counselled === 1 ? "" : "s"}.</p>
                  <ul>
                    <Share label="Likely to pay" n={data.feedback.likely} of={data.counselled} tone="bg-vx-green/70" />
                    <Share label="May or may not" n={data.feedback.may_or_may_not} of={data.counselled} tone="bg-vx-orange/70" />
                    <Share label="Unlikely to pay" n={data.feedback.unlikely} of={data.counselled} tone="bg-vx-red/70" />
                    <Share label="Not given" n={data.feedback.not_given} of={data.counselled} tone="bg-white/25" />
                  </ul>
                </section>
              </div>

              {/* ── scholarship and ARPU ── */}
              <section className={cx(vx.card, vx.pad)} aria-labelledby="ce-money">
                <h2 id="ce-money" className={cx(vx.h2, "mb-1")}>Scholarship and ARPU</h2>
                <p className={cx(vx.note, "mb-3")}>
                  {data.counselled === 0 ? "No counselling form is saved yet, so there is no scholarship to show." : (
                    <>Counselled students: the formula gave {pct(data.scholarship.avg_calculated)} on average; awarded after the counsellors&apos; adjustment {pct(data.scholarship.avg_awarded)} (highest {pct(data.scholarship.max)}, lowest {pct(data.scholarship.min)}). ARPU = programme fee − scholarship, averaged over counselled students.</>
                  )}
                </p>
                <div className="overflow-x-auto">
                  <table className={cx(vx.table, "min-w-[620px]")}>
                    <thead><tr>
                      <th className={vx.th} scope="col">Campus</th>
                      {["Programme fee", "Reached counselling", "Counselled", "Average awarded", "ARPU"].map((h) => <th key={h} className={cx(vx.th, "text-right")} scope="col">{h}</th>)}
                    </tr></thead>
                    <tbody className="tabular-nums">
                      {data.campuses.map((c) => (
                        <tr key={c.campus}>
                          <th className={cx(vx.td, "font-normal")} scope="row">{campusLabel(c.campus)}</th>
                          <td className={cx(vx.td, "text-right")}>{rupees(c.fee)}</td>
                          <td className={cx(vx.td, "text-right")}>{c.students}</td>
                          <td className={cx(vx.td, "text-right")}>{c.counselled}</td>
                          <td className={cx(vx.td, "text-right")}>{pct(c.avg_awarded)}</td>
                          <td className={cx(vx.td, "text-right text-vx-ink")}>{rupees(c.arpu)}</td>
                        </tr>
                      ))}
                      {data.campuses.length > 1 && (
                        <tr>
                          <th className={cx(vx.td, "font-semibold text-vx-ink")} scope="row">All</th>
                          <td className={vx.td} />
                          <td className={cx(vx.td, "text-right text-vx-ink")}>{data.students}</td>
                          <td className={cx(vx.td, "text-right text-vx-ink")}>{data.counselled}</td>
                          <td className={cx(vx.td, "text-right text-vx-ink")}>{pct(data.scholarship.avg_awarded)}</td>
                          <td className={cx(vx.td, "text-right font-semibold text-vx-ink")}>{rupees(data.arpu)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* ── the students ── */}
              <section className={cx(vx.card, vx.pad)} aria-labelledby="ce-students">
                <h2 id="ce-students" className={cx(vx.h2, "mb-1")}>Students</h2>
                <p className={cx(vx.note, "mb-3")}>
                  Everyone of {label}{where} at counselling, counselled first{data.students > data.list.length ? ` (the first ${Math.min(data.list.length, LIST_CAP)})` : ""}.
                  To book, set the mode or move stages, use the Counselling table.
                </p>
                <div className="overflow-x-auto">
                  <table className={cx(vx.table, "min-w-[1040px]")}>
                    <thead><tr>
                      <th className={vx.th} scope="col">Student</th><th className={vx.th} scope="col">Campus</th><th className={vx.th} scope="col">Mode</th>
                      <th className={vx.th} scope="col">Counsellor</th><th className={vx.th} scope="col">Slot (IST)</th><th className={vx.th} scope="col">Status</th>
                      <th className={vx.th} scope="col">Feedback</th>
                      <th className={cx(vx.th, "text-right")} scope="col">Formula</th><th className={cx(vx.th, "text-right")} scope="col">Awarded</th>
                      <th className={cx(vx.th, "text-right")} scope="col">Fee after scholarship</th><th className={vx.th} scope="col">Stage</th>
                    </tr></thead>
                    <tbody className="tabular-nums">
                      {data.list.map((s) => {
                        const adj = adjustment(s);
                        return (
                          <tr key={s.application_id} className={vx.row}>
                            <td className={vx.td}>
                              <span className="block text-vx-ink">{s.name ?? "—"}</span>
                              <span className="block text-[12px] text-vx-faint">{s.application_no ?? s.application_id}</span>
                            </td>
                            <td className={vx.td}>{campusLabel(s.campus)}</td>
                            <td className={cx(vx.td, s.mode ? "" : "text-vx-faint")}>{modeLabel(s.mode)}</td>
                            <td className={vx.td}>{s.counsellor ?? "—"}</td>
                            <td className={cx(vx.td, "text-xs text-vx-mut")}>{s.slot ? fmtIst(s.slot) : "—"}</td>
                            <td className={vx.td}>{s.attendance ? ATTENDANCE_LABEL[s.attendance] ?? s.attendance : "—"}</td>
                            <td className={vx.td}>
                              {s.feedback ? <span className={cx(vx.badge, FEEDBACK_TONE[s.feedback])}>{feedbackLabel(s.feedback)}</span> : <span className="text-vx-faint">—</span>}
                            </td>
                            <td className={cx(vx.td, "text-right")}>{pct(s.calculated_pct)}</td>
                            <td className={cx(vx.td, "text-right text-vx-ink")}>
                              {pct(s.awarded_pct)}{adj && <span className="ml-1 text-[11.5px] text-vx-orange-t" title="The counsellor's adjustment">{adj}</span>}
                            </td>
                            <td className={cx(vx.td, "text-right")}>{rupees(s.actual_fee)}</td>
                            <td className={vx.td}>{STAGE_LABEL[s.stage as Stage] ?? s.stage}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
