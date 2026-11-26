"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import {
  PANEL_STAGES, PARTS, STAGE_GROUPS, STAGE_LABEL, STATUSES, STATUS_LABEL, canManage, errorText, fmtIst,
  needsReason, statusLabel, type Stage, type Status, type VsatRoles,
} from "@/lib/vsat/pipeline";
import { verdictLabel } from "@/lib/vsat/interview-evaluation";
import { InterviewFormBox } from "./interview-form";
import { StageBadge } from "./pipeline-panel";
import type { Preview, Student, StudentComm, StudentExtras, TeamMember } from "./types";
import { profileErrorText } from "@/lib/vsat/profile-prompt";
import { ATTENDANCE_LABEL, type InterviewRow } from "@/lib/vsat/interviews";
import { InterviewScheduleForm, InterviewStatus, slotText } from "./interview-tools";
import { OfferBox } from "./offer-tools";
import { NotesBox } from "./counselling-tools";
import { STAGES_WITH_EMAIL, sendStageEmailsNow } from "@/lib/vsat/stage-notices-client";
import { TRACKS } from "@/lib/vsat/tracks";
import {
  ADJUST_MAX, ADJUST_MIN, COUNSELLOR_FEEDBACK, FEEDBACK_LABEL, HEARD_FROM_MAX, PARENT_LABEL, PARENT_PRESENT, REMARKS_MAX, awardedPct,
  counsellingPayload, type CounsellingFormInput, type CounsellorFeedback, type ParentPresent,
} from "@/lib/vsat/counselling-form";
import { DeletePerson } from "@/components/admin/vsat-delete-person";
import { ApplicationEditor } from "@/components/admin/vsat-app-admin-tools";

/**
 * One student across all stages. Everything comes from vsat_student / vsat_scholarship_preview and
 * every action is a database function that checks the caller again — the buttons shown here are
 * only a convenience. Interviewers and counsellors never get contact details (the database leaves them out).
 */

const input = vx.input;
const primary = cx(vx.btn, vx.primary);
const ghost = cx(vx.btn, vx.secondary);
const show = (v: unknown, suffix = "") => (v === null || v === undefined || v === "" ? "—" : `${String(v)}${suffix}`);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-vx-line bg-white/[.03] p-4">
      <h3 className="mb-3 font-semibold text-vx-ink">{title}</h3>
      <div className="space-y-3 text-sm text-vx-ink">{children}</div>
    </section>
  );
}
function Grid({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
      {items.map(([k, v]) => <div key={k}><dt className="text-xs text-vx-faint">{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}
function Msg({ text }: { text: string }) {
  if (!text) return null;
  const ok = text.endsWith("✓");
  return <p className={`rounded-lg px-3 py-2 text-sm ${ok ? "bg-vx-green/10 text-vx-green" : "bg-vx-red/10 text-[#ffb3bf]"}`}>{text}</p>;
}
/** One email / WhatsApp in the communication log: channel badge, what it was, delivery state, time (+ sender when not automated). */
function CommRow({ c }: { c: StudentComm }) {
  const isEmail = c.channel === "email";
  const badge = isEmail ? "border-vx-teal/30 bg-vx-teal/10 text-vx-teal-t" : "border-vx-green/30 bg-vx-green/10 text-vx-green";
  const bits: string[] = [];
  if (c.status) bits.push(c.status);
  if (c.opened_at) bits.push("opened"); else if (c.read_at) bits.push("read"); else if (c.delivered_at) bits.push("delivered");
  if (c.failed_reason) bits.push(c.failed_reason);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-vx-line-soft pb-2">
      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge}`}>{isEmail ? "Email" : "WhatsApp"}</span>
      <span className="text-vx-ink">{c.title}</span>
      {bits.length > 0 && <span className="text-xs text-vx-faint">· {bits.join(" · ")}</span>}
      <span className="ml-auto whitespace-nowrap text-xs text-vx-faint">{c.at ? fmtIst(c.at) : "—"}{c.by && c.by !== "system" ? ` · ${c.by}` : ""}</span>
    </li>
  );
}

export function StudentDrawer({ id, roles, onClose, onChanged }: { id: string; roles: VsatRoles; onClose: () => void; onChanged: () => void }) {
  const [supabase] = useState(() => createClient());
  const [s, setS] = useState<Student | null>(null);
  const [extra, setExtra] = useState<StudentExtras | null>(null);
  const [err, setErr] = useState("");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [showEdit, setShowEdit] = useState(false);
  const [toolMsg, setToolMsg] = useState("");
  const manager = canManage(roles);

  const load = useCallback(async () => {
    // vsat_student (pipeline/profile) and vsat_student_comms (documents + comm log) run together.
    // The comms RPC re-checks the same access gate; a failure there never blocks the drawer.
    const [{ data, error }, extraRes] = await Promise.all([
      supabase.rpc("vsat_student", { p_application_id: id }),
      supabase.rpc("vsat_student_comms", { p_application_id: id }),
    ]);
    if (error) { setErr(errorText(error.message)); setS(null); } else { setErr(""); setS(data as Student); }
    setExtra(extraRes.error ? null : (extraRes.data as StudentExtras));
  }, [supabase, id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!manager) return;
    void supabase.rpc("vsat_team_list").then(({ data }) => setTeam(Array.isArray(data) ? (data as TeamMember[]) : []));
  }, [supabase, manager]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changed = () => { void load(); onChanged(); };
  const reenableMock = async () => {
    if (!s) return;
    if (!confirm(`Re-enable the mock for ${s.profile.name || s.profile.application_id}? This clears their mock result so they can take it again.`)) return;
    setToolMsg("");
    const { data, error } = await supabase.rpc("vsat_mock_reset", { p: { applicationId: s.profile.application_id } });
    if (error || !(data as { ok?: boolean })?.ok) { setToolMsg(errorText(error?.message || "Couldn't re-enable the mock.")); return; }
    setToolMsg("Mock re-enabled ✓"); changed();
  };
  const stage = s?.pipeline.stage; const status = s?.pipeline.status;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose} role="dialog" aria-modal="true" aria-label="Student details">
      <div className="h-full w-full max-w-3xl overflow-auto border-l border-vx-line bg-[#0e0b29] p-5 text-vx-ink" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{s?.profile.name ?? "Student"}</h2>
            <p className="text-xs text-vx-faint">{s?.profile.application_no ?? id}{s?.profile.campus ? ` · ${s.profile.campus}` : ""}{s?.exam.batch?.label ? ` · ${s.exam.batch.label}` : ""}</p>
            {stage && status && <div className="mt-2"><StageBadge stage={stage} status={status} /></div>}
          </div>
          <button className={ghost} onClick={onClose}>Close</button>
        </div>
        {err && <Msg text={err} />}
        {!s && !err && <p className="text-vx-faint">Loading…</p>}
        {s && stage && status && (
          <div className="space-y-4">
            <Section title="Profile">
              <Grid items={[
                ["Email", show(s.profile.email)], ["Mobile", show(s.profile.mobile)], ["Gender", show(s.profile.gender)],
                ["City", show(s.profile.city)], ["State", show(s.profile.state)], ["Campus applied", show(s.profile.campus_applied)],
                ["Father's occupation", show(s.profile.father_occupation)], ["Mother's occupation", show(s.profile.mother_occupation)],
              ]} />
              {!s.can_manage && <p className="text-xs text-vx-faint">Contact details are shown to admissions only.</p>}
            </Section>

            {extra?.can_manage && extra.documents.length > 0 && (
              <Section title="Documents">
                <div className="flex flex-wrap gap-2">
                  {extra.documents.map((d) => (
                    <a key={d.key} href={d.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-vx-line2 bg-white/5 px-3 py-1.5 text-sm font-medium text-vx-violet-t hover:bg-white/10">
                      {d.label}
                      <span aria-hidden className="text-vx-faint">↗</span>
                    </a>
                  ))}
                </div>
              </Section>
            )}

            {s.can_manage && <MoveStage s={s} onDone={changed} />}

            <Section title="Academics">
              <Grid items={[
                ["10th year", show(s.academics.class10_year)], ["10th %", show(s.academics.class10_pct)], ["10th Maths %", show(s.academics.class10_maths_pct)],
                ["12th year", show(s.academics.class12_year)], ["12th %", show(s.academics.class12_pct)], ["12th Maths %", show(s.academics.class12_maths_pct)],
                ["Physics", show(s.academics.physics)], ["Chemistry", show(s.academics.chemistry)], ["Maths", show(s.academics.maths)],
                ["JEE registered", show(s.academics.jee_registered === null ? null : s.academics.jee_registered ? "Yes" : "No")],
                ["JEE percentile", show(s.academics.jee_pct)], ["JEE Maths percentile", show(s.academics.jee_maths_pct)],
              ]} />
            </Section>

            <Section title="VSAT exam">
              <Grid items={[
                ["Exam given", s.exam.exam_given ? "Yes" : "No"], ["Percentile", show(s.exam.percentile)],
                ["Marks", s.exam.marks === null ? "—" : `${s.exam.marks} / ${show(s.exam.max_marks)}`],
                ["VPS (calculated)", show(s.effective.vps.calculated)],
                ["VPS (counts)", <span key="v">{show(s.effective.vps.value)}{s.effective.vps.override !== null && <span className="ml-1 text-xs text-vx-orange-t">override</span>}</span>],
                ["Eligible (calculated)", show(s.effective.eligible.calculated === null ? null : s.effective.eligible.calculated ? "Yes" : "No")],
                ["Eligible (counts)", <span key="e">{s.effective.eligible.value ? "Yes" : "No"}{s.effective.eligible.override !== null && <span className="ml-1 text-xs text-vx-orange-t">override</span>}</span>],
                ["12th result", show(s.effective.eligible.detail?.class12?.replace(/_/g, " "))], ["PCM total", show(s.effective.eligible.detail?.pcm_total)],
              ]} />
              {roles.admin && <Overrides s={s} onDone={changed} />}
            </Section>

            <InterviewSection s={s} roles={roles} team={team} onDone={changed} />
            <CounsellingSection s={s} roles={roles} team={team} onDone={changed} />

            {extra?.can_manage && (
              <Section title="Communication history">
                {extra.comms.length === 0
                  ? <p className="text-sm text-vx-faint">No emails or WhatsApp messages yet.</p>
                  : <ul className="space-y-2">{extra.comms.map((c, i) => <CommRow key={i} c={c} />)}</ul>}
              </Section>
            )}

            <Section title="Stage history">
              <ul className="space-y-2">
                {s.history.map((h, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 border-b border-vx-line-soft pb-2">
                    <span className="text-xs text-vx-faint">{fmtIst(h.at)}</span>
                    <span>{h.from_stage ? `${STAGE_LABEL[h.from_stage]}${h.from_status && h.from_status !== "active" ? ` (${statusLabel(h.from_status)})` : ""} → ` : ""}
                      <b>{STAGE_LABEL[h.to_stage]}{h.to_status !== "active" ? ` (${statusLabel(h.to_status)})` : ""}</b></span>
                    <span className="text-xs text-vx-faint">{h.by ?? h.source}{h.reason ? ` · “${h.reason}”` : ""}</span>
                  </li>
                ))}
              </ul>
            </Section>

            {roles.admin && (
              <Section title="Application tools">
                <div className="flex flex-wrap gap-2">
                  <button className={primary} onClick={() => setShowEdit(true)}>Edit application</button>
                  <button className={ghost} onClick={reenableMock}>Re-enable mock</button>
                </div>
                <Msg text={toolMsg} />
                <p className="text-xs text-vx-faint">Edit any field of this application (changing an ID asks for confirmation). Re-enabling the mock clears the mock result so the student can take it again.</p>
              </Section>
            )}

            {roles.admin && (
              <section className="rounded-xl border border-[rgba(255,107,129,0.35)] bg-[rgba(255,107,129,0.06)] p-4">
                <h3 className="mb-1 font-semibold text-vx-red">Danger zone</h3>
                <p className="mb-3 text-sm text-vx-mut">
                  Permanently erase this person and their entire VSAT footprint (application, exam,
                  interview, counselling, payments, CRM logs and early registration). Use only for
                  dummy / test entries — it cannot be undone.
                </p>
                <DeletePerson
                  kind="application"
                  id={s.profile.application_id}
                  name={s.profile.name}
                  email={s.profile.email}
                  onDeleted={() => { onChanged(); onClose(); }}
                />
              </section>
            )}
          </div>
        )}
        {showEdit && s && <ApplicationEditor applicationId={s.profile.application_id} onClose={() => setShowEdit(false)} onSaved={changed} />}
      </div>
    </div>
  );
}

/** Admin / admissions: move to any stage (0166: the scheduled ones too, once the booking is sent). */
function MoveStage({ s, onDone }: { s: Student; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const cur = s.pipeline;
  const [to, setTo] = useState<Stage>(cur.stage);
  const [st, setSt] = useState<Status>(cur.status);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const req = needsReason(cur.stage, cur.status, to, st);

  async function move() {
    if (to === cur.stage && st === cur.status) return setMsg("Nothing to change.");
    if (req && reason.trim().length < 3) return setMsg("Please add a reason (at least 3 characters).");
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = { application_id: s.profile.application_id, to_stage: to, to_status: st, expected_stage: cur.stage };
    if (reason.trim()) p.reason = reason.trim();
    const { error } = await supabase.rpc("vsat_move_stage", { p });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    // PI cleared (0173) emails the student: send it now instead of waiting for the cron (best effort)
    if (st === "active" && STAGES_WITH_EMAIL.includes(to)) void sendStageEmailsNow([s.profile.application_id]);
    setMsg("Moved ✓"); setReason(""); onDone();
  }

  return (
    <Section title="Move stage">
      <div className="grid gap-2 sm:grid-cols-3">
        <select className={input} value={to} onChange={(e) => setTo(e.target.value as Stage)} aria-label="Stage">
          {STAGE_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.stages.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}
            </optgroup>
          ))}
        </select>
        <select className={input} value={st} onChange={(e) => setSt(e.target.value as Status)} aria-label="Status">
          {STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
        </select>
        <button className={primary} disabled={busy} onClick={move}>{busy ? "Saving…" : "Move"}</button>
      </div>
      <input className={input} placeholder={req ? "Reason (required: going back, skipping, not cleared, on hold or reopening)" : "Reason (optional)"}
        value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="Reason" />
      <Msg text={msg} />
    </Section>
  );
}

/** Admin only: override VPS or eligibility with a reason; the calculated value stays visible. */
function Overrides({ s, onDone }: { s: Student; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [field, setField] = useState<"vps" | "eligible">("vps");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const active = s.overrides.filter((o) => !o.cleared_at);

  async function save() {
    let v: number | boolean;
    if (field === "vps") { v = Number(value); if (value.trim() === "" || !Number.isFinite(v) || v < 0 || v > 10) return setMsg("VPS must be between 0 and 10."); }
    else { if (value !== "true" && value !== "false") return setMsg("Pick eligible or not eligible."); v = value === "true"; }
    if (reason.trim().length < 3) return setMsg("Please add a reason (at least 3 characters).");
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("vsat_set_override", { p: { application_id: s.profile.application_id, field, value: v, reason: reason.trim() } });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    setMsg("Override saved ✓"); setValue(""); setReason(""); onDone();
  }
  async function clear(f: string) {
    const r = window.prompt("Reason for removing this override?");
    if (!r || r.trim().length < 3) return setMsg("Please add a reason (at least 3 characters).");
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc("vsat_clear_override", { p: { application_id: s.profile.application_id, field: f, reason: r.trim() } });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    setMsg("Override removed ✓"); onDone();
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-vx-orange/20 bg-vx-orange/5 p-3">
      <p className="text-xs font-semibold text-vx-orange-t">Admin override</p>
      {active.map((o) => (
        <div key={o.field} className="flex flex-wrap items-center gap-2 text-xs">
          <span>{o.field === "vps" ? "VPS" : "Eligible"}: <b>{String(o.value)}</b> (calculated {String(o.calculated ?? "—")}) · “{o.reason}” · {o.by ?? ""}</span>
          <button className="text-vx-red underline" disabled={busy} onClick={() => clear(o.field)}>Remove</button>
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={input} value={field} onChange={(e) => { setField(e.target.value as "vps" | "eligible"); setValue(""); }} aria-label="Override field">
          <option value="vps">VPS</option><option value="eligible">Eligibility</option>
        </select>
        {field === "vps"
          ? <input className={input} type="number" min={0} max={10} step="0.01" placeholder="New VPS" value={value} onChange={(e) => setValue(e.target.value)} aria-label="New VPS" />
          : <select className={input} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Eligible">
              <option value="">Pick…</option><option value="true">Eligible</option><option value="false">Not eligible</option>
            </select>}
        <input className={`${input} sm:col-span-2`} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="Override reason" />
      </div>
      <button className={primary} disabled={busy} onClick={save}>Save override</button>
      <Msg text={msg} />
    </div>
  );
}

function InterviewSection({ s, roles, team, onDone }: { s: Student; roles: VsatRoles; team: TeamMember[]; onDone: () => void }) {
  const st = s.pipeline.stage; const iv = s.interview;
  const row = iv as unknown as InterviewRow | null;
  const isInterviewer = roles.roles.includes("interviewer");
  // 0177: a rejected student sits on PI not cleared (a stage), so the stage check alone keeps them out
  const canAssign = s.can_manage && (st === "vsat_cleared" || st === "interview_scheduled");
  // 0166: the stage no longer follows the booking, so the form works at every stage of the interview step
  const atStep = TRACKS.interview.stepStages.includes(st);
  const canForm = atStep && (s.can_manage || isInterviewer);
  if (!iv && !canAssign && !atStep) return null;
  const cancelled = !!row?.cancelled_at;

  return (
    <Section title="Interview">
      {iv && !cancelled && <Grid items={[
        ["Interviewer", show(iv.interviewer)], ["Slot (IST)", slotText(iv.slot_datetime, row?.duration_min)],
        ["Status", show(iv.attendance ? ATTENDANCE_LABEL[iv.attendance] ?? iv.attendance : null)], ["Weighted score (out of 5)", show(iv.weighted_avg)],
        ["Final score (out of 20)", iv.weighted_avg === null ? "—" : show(Math.round(Number(iv.weighted_avg) * 4 * 100) / 100)],
        // 0173: the verdict comes from Interview Evaluation (the interviewer gives none)
        ["Verdict", iv.weighted_avg === null && !iv.verdict ? "—" : verdictLabel(iv.verdict)],
        ["Cheating seen", iv.cheating_seen === null ? "—" : iv.cheating_seen ? "Yes" : "No"], ["Financial capability", show(iv.financial_capability)],
      ]} />}
      {iv && iv.weighted_avg !== null && (
        <Grid items={PARTS.map(([k, label]) => [label, `${show(iv[({ communication: "rubric_behavioural", logic: "rubric_math", passion: "rubric_passion", achievements: "rubric_achievements", why_program: "rubric_why_program" } as const)[k]])}${iv.remarks?.[k] ? ` · ${iv.remarks[k]}` : ""}`] as [string, ReactNode])} />
      )}
      {iv?.why_accept && <p><span className="text-xs text-vx-faint">Why should Vedam accept you: </span>{iv.why_accept}</p>}
      {row && (
        <InterviewStatus iv={row} applicationId={s.profile.application_id} manager={s.can_manage} isInterviewer={isInterviewer}
          atInterviewStage={atStep} studentAbsent={st === "pi_not_appeared"} onDone={onDone} />
      )}
      {canAssign && <InterviewScheduleForm team={team} applicationId={s.profile.application_id} current={row} onDone={onDone} />}
      {canForm && iv && !cancelled && <InterviewFormBox applicationId={s.profile.application_id} onDone={onDone} />}
    </Section>
  );
}

function CounsellingSection({ s, roles, team, onDone }: { s: Student; roles: VsatRoles; team: TeamMember[]; onDone: () => void }) {
  const st = s.pipeline.stage; const c = s.counselling;
  // 0145: the counselling row in the shape the meeting tools read (the host is "interviewer", the link column is zoom_link)
  const row = c ? ({ ...c, interviewer_id: c.counsellor_id ?? null, interviewer: c.counsellor, meet_link: c.zoom_link } as unknown as InterviewRow) : null;
  const cancelled = !!row?.cancelled_at;
  const isCounsellor = roles.roles.includes("counsellor");
  const canAssign = s.can_manage && (st === "pi_cleared" || st === "counselling_scheduled") && !c?.submitted_at;
  // 0166: the stage no longer follows the booking, so the form works at every stage of the counselling step
  const atStep = TRACKS.counselling.stepStages.includes(st);
  const canForm = atStep && (s.can_manage || isCounsellor);
  // the offer (0144): from Counselled on, or whenever one was released
  const showOffer = ["counselled", "offer_sent", "enrolled", "offer_lapsed", "offer_cancelled"].includes(st) || !!s.offer?.released_at;
  if (!c && !canAssign && !showOffer) return null;

  return (
    <Section title="Counselling & scholarship">
      {/* 0179: the student's Online / Offline choice — shown before booking too, so the right slot can be set up */}
      <p className="text-sm">
        <span className="text-xs text-vx-faint">Mode (student&apos;s choice): </span>
        {s.profile.counselling_mode === "online" ? "Online" : s.profile.counselling_mode === "offline" ? "Offline" : "Not chosen yet"}
      </p>
      {c && <Grid items={[
        ["Counsellor", show(cancelled ? null : c.counsellor)], ["Slot (IST)", cancelled ? "—" : slotText(c.slot_datetime, row?.duration_min)],
        ["Status", show(c.attendance ? ATTENDANCE_LABEL[c.attendance] ?? c.attendance : null)],
        ["Scholarship score", show(c.calc_score)], ["Category", show(c.calc_category ?? c.scholarship_category)],
        ["Step", show(c.chosen_step, "%")], ["Calculated %", show(c.calculated_pct, "%")],
        // 0184: the counsellor's ±5 sits between the formula's % and the awarded one
        ...(c.submitted_at ? [["Counsellor adjustment", c.adjust_pct ? `${c.adjust_pct > 0 ? "+" : ""}${c.adjust_pct}%` : "None"] as [string, ReactNode]] : []),
        ["Final %", show(c.actual_pct ?? c.scholarship_pct, "%")],
      ]} />}
      {c?.actual_reason && <p className="text-xs text-vx-mut">Reason for the counsellor&apos;s adjustment: “{c.actual_reason}”</p>}
      {/* 0184: the sheet's counsellor answers, once the form is saved */}
      {c?.submitted_at && <Grid items={[
        ["Counsellor feedback", show(c.counsellor_feedback ? FEEDBACK_LABEL[c.counsellor_feedback as CounsellorFeedback] ?? c.counsellor_feedback : null)],
        ["Parent present", show(c.parent_present ? PARENT_LABEL[c.parent_present as ParentPresent] ?? c.parent_present : null)],
        ["Already connected with existing students", c.connected_students == null ? "—" : c.connected_students ? "Yes" : "No"],
        ["Came to know about Vedam from", show(c.heard_from)],
        ["Offline form filled", c.offline_form_filled == null ? "—" : c.offline_form_filled ? "Yes" : "No"],
        ["Counsellor remarks", show(c.counsellor_remarks)],
      ]} />}
      {c && <ProfileBox applicationId={s.profile.application_id} {...savedProfile(c.profile_analysis)} canGenerate={s.can_manage || isCounsellor} />}
      {row && (
        <InterviewStatus iv={row} applicationId={s.profile.application_id} manager={s.can_manage} isInterviewer={isCounsellor}
          atInterviewStage={atStep} studentAbsent={st === "counselling_not_appeared"} onDone={onDone} track={TRACKS.counselling} />
      )}
      {canAssign && <InterviewScheduleForm team={team} applicationId={s.profile.application_id} current={row} onDone={onDone} track={TRACKS.counselling} />}
      {canForm && c && !cancelled && !c.submitted_at && <CounsellingFormBox applicationId={s.profile.application_id} onDone={onDone} />}
      {/* 0193: sir's sheet columns Confirmation, Additional comments, Proposed fee (admins and admissions) */}
      {s.can_manage && (PANEL_STAGES.couns as readonly string[]).includes(st) && <NotesBox applicationId={s.profile.application_id} onDone={onDone} />}
      {showOffer && (
        <OfferBox applicationId={s.profile.application_id} stage={st} status={s.pipeline.status} offer={s.offer ?? null}
          canManage={s.can_manage} onDone={onDone} />
      )}
    </Section>
  );
}

/** "**bold**" → <strong>; everything else stays plain text (no HTML from the AI is ever rendered). */
export function BriefingText({ text }: { text: string }) {
  return (
    <div className="space-y-1 whitespace-pre-wrap text-sm leading-relaxed text-vx-ink">
      {text.split("\n").map((line, i) => (
        <p key={i}>{line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
          /^\*\*[^*]+\*\*$/.test(part) ? <strong key={j} className="text-vx-ink">{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>)}</p>
      ))}
    </div>
  );
}

/** profile_analysis (jsonb) → the saved briefing, if it has the shape vsat_profile_save writes. */
function savedProfile(p: unknown): { saved: string | null; savedAt: string | null } {
  const o = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  return { saved: typeof o.text === "string" && o.text ? o.text : null, savedAt: typeof o.generated_at === "string" ? o.generated_at : null };
}

/** Profile analyser (step 6): the AI briefing for the counsellor. Generated on the server (/api/vsat/profile). */
export function ProfileBox({ applicationId, saved, savedAt, canGenerate }: { applicationId: string; saved: string | null; savedAt: string | null; canGenerate: boolean }) {
  const [text, setText] = useState(saved);
  const [at, setAt] = useState(savedAt);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function generate() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/vsat/profile", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ application_id: applicationId }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; code?: string; text?: string; generated_at?: string | null };
      if (d.ok && d.text) { setText(d.text); setAt(d.generated_at ?? new Date().toISOString()); }
      else setMsg(profileErrorText(d.code));
    } catch {
      setMsg(profileErrorText(null));
    }
    setBusy(false);
  }

  if (!text && !canGenerate) return null;
  return (
    <div className="space-y-2 rounded-lg border border-vx-line p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-vx-violet-t">Profile analysis</p>
        {canGenerate && <button className={primary} disabled={busy} onClick={generate}>{busy ? "Generating… (up to a minute)" : text ? "Regenerate profile" : "Generate profile"}</button>}
      </div>
      {text ? <>
        <BriefingText text={text} />
        <p className="text-xs text-vx-faint">Written by AI from this student&apos;s data{at ? ` on ${fmtIst(at)}` : ""}. Check it against the scores before you rely on it.</p>
      </> : <p className="text-xs text-vx-faint">No profile yet. It reads this student&apos;s application, VSAT and interview data and writes a short briefing for the counselling call.</p>}
      <Msg text={msg} />
    </div>
  );
}

function CounsellingFormBox({ applicationId, onDone }: { applicationId: string; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [pre, setPre] = useState<Preview | null>(null);
  // 0184: the "Selected for counselling" sheet's counsellor columns, and the counsellor's −5 … +5 on the formula's %
  const [f, setF] = useState<CounsellingFormInput>({ feedback: "", parentPresent: "", connected: "", heardFrom: "", remarks: "", adjust: "0", adjustReason: "", offlineForm: "" });
  const set = <K extends keyof CounsellingFormInput>(k: K, v: CounsellingFormInput[K]) => { setF((x) => ({ ...x, [k]: v })); setMsg(""); };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void supabase.rpc("vsat_scholarship_preview", { p_application_id: applicationId }).then(({ data, error }) => {
      if (error) setMsg(errorText(error.message)); else setPre(data as Preview);
    });
  }, [supabase, applicationId]);

  // Formula only (0083): the step is the sheet's BK formula, the +10% rating is the interview's
  // achievements score. Shown for guidance; the database calculates both again on save.
  const step = pre?.auto_step ?? null;
  const calc = step === null ? null : Math.min(100, (() => {
    const floor = pre?.jee_floor_enabled ? (pre.jee_floor ?? 0) : 0;
    const m = Math.max(step, floor);
    return pre?.special_rating === 5 && m <= 30 ? m + 10 : m;
  })());
  const adjNum = Number(f.adjust.trim().replace(/^\+/, "") || "0");
  const adjOk = Number.isInteger(adjNum) && adjNum >= ADJUST_MIN && adjNum <= ADJUST_MAX;
  const awarded = adjOk ? awardedPct(calc, adjNum) : null;
  const fee = Number(pre?.programme_fee);

  async function submit() {
    if (step === null) return setMsg(errorText("NO_BAND"));
    const chk = counsellingPayload(applicationId, f);
    if (!chk.ok) return setMsg(chk.error);
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("vsat_submit_counselling", { p: chk.payload });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    const d = data as { actual_pct: number };
    // 0166: saving does not move the stage (admissions moves it by hand)
    setMsg(`Saved ✓ Scholarship ${d.actual_pct}%`);
    onDone();
  }

  if (!pre) return <Msg text={msg} />;
  return (
    <div className="space-y-3 rounded-lg border border-vx-violet/30 p-3">
      <p className="text-xs font-semibold text-vx-violet-t">Scholarship (calculated by the system)</p>
      <Grid items={[
        ["Case", pre.case.replace(/_/g, " ")], ["Score", String(pre.score)], ["Category", show(pre.category)],
        ["Range", pre.min_award === null ? "—" : `${pre.min_award}%–${pre.max_award}%`],
        ["Step (from the score)", step === null ? "—" : `${step}%`],
        ["JEE floor", pre.jee_floor === null ? "—" : `${pre.jee_floor}% (${pre.jee_floor_enabled ? "on" : "off for this campus"})`],
        ["Achievements (interview)", pre.special_rating === null ? "—" : `${pre.special_rating}/5${pre.special_rating === 5 ? " · +10% if 30% or less" : ""}`],
        ["Scholarship (formula)", calc === null ? "—" : `${calc}%`],
        ["Programme fee", `₹${Number(pre.programme_fee).toLocaleString("en-IN")}`],
      ]} />
      {pre.missing.length > 0 && <p className="text-xs text-vx-orange-t">Missing (counted as 0, like the sheet): {pre.missing.join(", ").replace(/_/g, " ")}</p>}
      {step === null && <p className="text-xs text-vx-orange-t">{errorText("NO_BAND")}</p>}

      <p className="pt-1 text-xs font-semibold text-vx-violet-t">The counselling call</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-vx-faint">Counsellor feedback
          <select className={cx(input, "mt-1")} value={f.feedback} onChange={(e) => set("feedback", e.target.value)}>
            <option value="">Not given</option>
            {COUNSELLOR_FEEDBACK.map((v) => <option key={v} value={v}>{FEEDBACK_LABEL[v]}</option>)}
          </select>
        </label>
        <label className="block text-xs text-vx-faint">Parent present?
          <select className={cx(input, "mt-1")} value={f.parentPresent} onChange={(e) => set("parentPresent", e.target.value)}>
            <option value="">Not given</option>
            {PARENT_PRESENT.map((v) => <option key={v} value={v}>{PARENT_LABEL[v]}</option>)}
          </select>
        </label>
        <label className="block text-xs text-vx-faint">Already connected with existing students?
          <select className={cx(input, "mt-1")} value={f.connected} onChange={(e) => set("connected", e.target.value as CounsellingFormInput["connected"])}>
            <option value="">Not given</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </label>
        <label className="block text-xs text-vx-faint">Came to know about Vedam from?
          <input className={cx(input, "mt-1")} maxLength={HEARD_FROM_MAX} value={f.heardFrom} onChange={(e) => set("heardFrom", e.target.value)} placeholder="e.g. a friend, Instagram, school" />
        </label>
        {/* 0186: the sheet's "Offline Form Filled" */}
        <label className="block text-xs text-vx-faint">Offline form filled?
          <select className={cx(input, "mt-1")} value={f.offlineForm ?? ""} onChange={(e) => set("offlineForm", e.target.value as CounsellingFormInput["offlineForm"])}>
            <option value="">Not given</option><option value="yes">Yes</option><option value="no">No</option>
          </select>
        </label>
      </div>
      <textarea className={input} rows={2} maxLength={REMARKS_MAX} placeholder="Counsellor remarks (optional)" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} aria-label="Counsellor remarks" />

      <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
        <label className="block text-xs text-vx-faint">Adjustment (−5 to +5)
          <input className={cx(input, "mt-1 tabular-nums")} type="number" step={1} min={ADJUST_MIN} max={ADJUST_MAX} inputMode="numeric"
            value={f.adjust} onChange={(e) => set("adjust", e.target.value)} />
        </label>
        <label className="block text-xs text-vx-faint">Why (needed if the adjustment is not 0)
          <input className={cx(input, "mt-1")} maxLength={500} value={f.adjustReason} onChange={(e) => set("adjustReason", e.target.value)} disabled={adjOk && adjNum === 0} />
        </label>
      </div>
      <p className="text-sm text-vx-ink tabular-nums">
        Scholarship awarded: <b className="font-semibold">{awarded === null ? "—" : `${awarded}%`}</b>
        {awarded !== null && adjNum !== 0 && <span className="text-xs text-vx-faint"> (formula {calc}% {adjNum > 0 ? "+" : "−"} {Math.abs(adjNum)})</span>}
        {awarded !== null && Number.isFinite(fee) && fee > 0 && (
          <span className="block text-xs text-vx-faint">
            Scholarship ₹{Math.round(fee * awarded / 100).toLocaleString("en-IN")} · 1st year ₹{Math.round(fee * awarded / 100 / 4).toLocaleString("en-IN")} · fee after scholarship ₹{Math.round(fee - fee * awarded / 100).toLocaleString("en-IN")}
          </span>
        )}
      </p>
      <button className={primary} disabled={busy || step === null} onClick={submit}>{busy ? "Saving…" : "Save counselling"}</button>
      <p className="text-xs text-vx-faint">The form is saved once. The stage does not move: admissions moves the student on by hand.</p>
      <Msg text={msg} />
    </div>
  );
}
