"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  NEEDS_ASSIGNMENT, PARTS, STAGES, STAGE_LABEL, STATUSES, STATUS_LABEL, canManage, errorText, fmtIst, interviewFormErrors,
  isHttpsLink, istSlot, needsReason, type InterviewForm, type Stage, type Status, type VsatRoles,
} from "@/lib/vsat/pipeline";
import { StageBadge } from "./pipeline-panel";
import type { Preview, Student, TeamMember } from "./types";
import { profileErrorText } from "@/lib/vsat/profile-prompt";

/**
 * One student across all stages. Everything comes from vsat_student / vsat_scholarship_preview and
 * every action is a database function that checks the caller again — the buttons shown here are
 * only a convenience. Interviewers and counsellors never get contact details (the database leaves them out).
 */

const input = "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#22d3ee] focus:outline-none";
const btn = "rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40";
const primary = `${btn} bg-[#34e2b0] text-[#04101a]`;
const ghost = `${btn} bg-white/5 text-white/80`;
const show = (v: unknown, suffix = "") => (v === null || v === undefined || v === "" ? "—" : `${String(v)}${suffix}`);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[.03] p-4">
      <h3 className="mb-3 font-semibold text-white">{title}</h3>
      <div className="space-y-3 text-sm text-white/80">{children}</div>
    </section>
  );
}
function Grid({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
      {items.map(([k, v]) => <div key={k}><dt className="text-xs text-white/40">{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}
function Msg({ text }: { text: string }) {
  if (!text) return null;
  const ok = text.endsWith("✓");
  return <p className={`rounded-lg px-3 py-2 text-sm ${ok ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"}`}>{text}</p>;
}

export function StudentDrawer({ id, roles, onClose, onChanged }: { id: string; roles: VsatRoles; onClose: () => void; onChanged: () => void }) {
  const [supabase] = useState(() => createClient());
  const [s, setS] = useState<Student | null>(null);
  const [err, setErr] = useState("");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const manager = canManage(roles);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("vsat_student", { p_application_id: id });
    if (error) { setErr(errorText(error.message)); setS(null); } else { setErr(""); setS(data as Student); }
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
  const stage = s?.pipeline.stage; const status = s?.pipeline.status;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose} role="dialog" aria-modal="true" aria-label="Student details">
      <div className="h-full w-full max-w-3xl overflow-auto border-l border-white/10 bg-[#0b1024] p-5 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{s?.profile.name ?? "Student"}</h2>
            <p className="text-xs text-white/50">{s?.profile.application_no ?? id}{s?.profile.campus ? ` · ${s.profile.campus}` : ""}{s?.exam.batch?.label ? ` · ${s.exam.batch.label}` : ""}</p>
            {stage && status && <div className="mt-2"><StageBadge stage={stage} status={status} /></div>}
          </div>
          <button className={ghost} onClick={onClose}>Close</button>
        </div>
        {err && <Msg text={err} />}
        {!s && !err && <p className="text-white/50">Loading…</p>}
        {s && stage && status && (
          <div className="space-y-4">
            <Section title="Profile">
              <Grid items={[
                ["Email", show(s.profile.email)], ["Mobile", show(s.profile.mobile)], ["Gender", show(s.profile.gender)],
                ["City", show(s.profile.city)], ["State", show(s.profile.state)], ["Campus applied", show(s.profile.campus_applied)],
                ["Father's occupation", show(s.profile.father_occupation)], ["Mother's occupation", show(s.profile.mother_occupation)],
              ]} />
              {!s.can_manage && <p className="text-xs text-white/40">Contact details are shown to admissions only.</p>}
            </Section>

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
                ["VPS (counts)", <span key="v">{show(s.effective.vps.value)}{s.effective.vps.override !== null && <span className="ml-1 text-xs text-amber-300">override</span>}</span>],
                ["Eligible (calculated)", show(s.effective.eligible.calculated === null ? null : s.effective.eligible.calculated ? "Yes" : "No")],
                ["Eligible (counts)", <span key="e">{s.effective.eligible.value ? "Yes" : "No"}{s.effective.eligible.override !== null && <span className="ml-1 text-xs text-amber-300">override</span>}</span>],
                ["12th result", show(s.effective.eligible.detail?.class12?.replace(/_/g, " "))], ["PCM total", show(s.effective.eligible.detail?.pcm_total)],
              ]} />
              {roles.admin && <Overrides s={s} onDone={changed} />}
            </Section>

            <InterviewSection s={s} roles={roles} team={team} onDone={changed} />
            <CounsellingSection s={s} roles={roles} team={team} onDone={changed} />

            <Section title="Stage history">
              <ul className="space-y-2">
                {s.history.map((h, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 border-b border-white/5 pb-2">
                    <span className="text-xs text-white/40">{fmtIst(h.at)}</span>
                    <span>{h.from_stage ? `${STAGE_LABEL[h.from_stage]}${h.from_status && h.from_status !== "active" ? ` (${STATUS_LABEL[h.from_status]})` : ""} → ` : ""}
                      <b>{STAGE_LABEL[h.to_stage]}{h.to_status !== "active" ? ` (${STATUS_LABEL[h.to_status]})` : ""}</b></span>
                    <span className="text-xs text-white/50">{h.by ?? h.source}{h.reason ? ` · “${h.reason}”` : ""}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

/** Admin / admissions: move to any stage (scheduled stages go through "Assign"). */
function MoveStage({ s, onDone }: { s: Student; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const cur = s.pipeline;
  const [to, setTo] = useState<Stage>(cur.stage);
  const [st, setSt] = useState<Status>(cur.status);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const req = needsReason(cur.stage, cur.status, to, st);
  const assignOnly = !!NEEDS_ASSIGNMENT[to] && to !== cur.stage;

  async function move() {
    if (to === cur.stage && st === cur.status) return setMsg("Nothing to change.");
    if (assignOnly) return setMsg(`Use "Assign" below to schedule (it needs a ${NEEDS_ASSIGNMENT[to]} and a slot).`);
    if (req && reason.trim().length < 3) return setMsg("Please add a reason (at least 3 characters).");
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = { application_id: s.profile.application_id, to_stage: to, to_status: st, expected_stage: cur.stage };
    if (reason.trim()) p.reason = reason.trim();
    const { error } = await supabase.rpc("vsat_move_stage", { p });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    setMsg("Moved ✓"); setReason(""); onDone();
  }

  return (
    <Section title="Move stage">
      <div className="grid gap-2 sm:grid-cols-3">
        <select className={input} value={to} onChange={(e) => setTo(e.target.value as Stage)} aria-label="Stage">
          {STAGES.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}
        </select>
        <select className={input} value={st} onChange={(e) => setSt(e.target.value as Status)} aria-label="Status">
          {STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
        </select>
        <button className={primary} disabled={busy} onClick={move}>{busy ? "Saving…" : "Move"}</button>
      </div>
      <input className={input} placeholder={req ? "Reason (required: going back, skipping, not selected, on hold or reopening)" : "Reason (optional)"}
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
    <div className="mt-3 space-y-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Admin override</p>
      {active.map((o) => (
        <div key={o.field} className="flex flex-wrap items-center gap-2 text-xs">
          <span>{o.field === "vps" ? "VPS" : "Eligible"}: <b>{String(o.value)}</b> (calculated {String(o.calculated ?? "—")}) · “{o.reason}” · {o.by ?? ""}</span>
          <button className="text-rose-300 underline" disabled={busy} onClick={() => clear(o.field)}>Remove</button>
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

/** Interviewer / counsellor picker + IST date and time + optional https link. */
function AssignForm({ kind, team, applicationId, onDone }: { kind: "interviewer" | "counsellor"; team: TeamMember[]; applicationId: string; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const people = team.filter((t) => t.roles.includes(kind));
  const [who, setWho] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    const slot = istSlot(date, time);
    if (!who) return setMsg(`Pick a ${kind}.`);
    if (!slot) return setMsg("Pick a date and time.");
    if (link.trim() && !isHttpsLink(link)) return setMsg("The meeting link must start with https://");
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = { application_id: applicationId, slot_datetime: slot };
    if (kind === "interviewer") { p.interviewer_id = who; if (link.trim()) p.meet_link = link.trim(); }
    else { p.counsellor_id = who; if (link.trim()) p.meeting_link = link.trim(); }
    const { error } = await supabase.rpc(kind === "interviewer" ? "vsat_assign_interview" : "vsat_assign_counsellor", { p });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    setMsg("Assigned ✓"); onDone();
  }

  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/50">Assign {kind} and slot (IST)</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <select className={input} value={who} onChange={(e) => setWho(e.target.value)} aria-label={kind}>
          <option value="">Pick {kind}…</option>
          {people.map((t) => <option key={t.user_id} value={t.user_id}>{t.name ?? t.email}{t.campus ? ` (${t.campus})` : ""}</option>)}
        </select>
        <input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <input className={input} type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
      </div>
      <input className={input} placeholder="Meeting link (optional, https://…) — automatic Google Meet comes in the next step" value={link}
        onChange={(e) => setLink(e.target.value)} maxLength={300} aria-label="Meeting link" />
      <button className={primary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Assign"}</button>
      <Msg text={msg} />
    </div>
  );
}

function InterviewSection({ s, roles, team, onDone }: { s: Student; roles: VsatRoles; team: TeamMember[]; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const st = s.pipeline.stage; const iv = s.interview;
  const isInterviewer = roles.roles.includes("interviewer");
  const canAssign = s.can_manage && (st === "vsat_cleared" || st === "interview_scheduled") && s.pipeline.status !== "not_selected";
  const canForm = st === "interview_scheduled" && (s.can_manage || isInterviewer);
  const [msg, setMsg] = useState("");
  if (!iv && !canAssign && !["vsat_cleared", "interview_scheduled"].includes(st)) return null;

  async function markAbsent() {
    const { error } = await supabase.rpc("vsat_move_stage", { p: { application_id: s.profile.application_id, to_stage: "interview_scheduled", to_status: "absent", expected_stage: st } });
    setMsg(error ? errorText(error.message) : "Marked absent ✓"); if (!error) onDone();
  }

  return (
    <Section title="Interview">
      {iv && <Grid items={[
        ["Interviewer", show(iv.interviewer)], ["Slot (IST)", fmtIst(iv.slot_datetime)],
        ["Meeting", iv.meet_link ? <a key="m" className="text-[#22d3ee] underline" href={iv.meet_link} target="_blank" rel="noopener noreferrer">Open link</a> : "—"],
        ["Attendance", show(iv.attendance)], ["Score (out of 5)", show(iv.weighted_avg)],
        ["Verdict (calculated / interviewer)", iv.weighted_avg === null ? "—" : `${show(iv.calc_verdict)} / ${show(iv.interviewer_verdict)}`],
        ["Cheating seen", iv.cheating_seen === null ? "—" : iv.cheating_seen ? "Yes" : "No"], ["Financial capability", show(iv.financial_capability)],
      ]} />}
      {iv && iv.weighted_avg !== null && (
        <Grid items={PARTS.map(([k, label]) => [label, `${show(iv[({ communication: "rubric_behavioural", logic: "rubric_math", passion: "rubric_passion", achievements: "rubric_achievements", why_program: "rubric_why_program" } as const)[k]])}${iv.remarks?.[k] ? ` · ${iv.remarks[k]}` : ""}`] as [string, ReactNode])} />
      )}
      {iv?.why_accept && <p><span className="text-xs text-white/40">Why should Vedam accept you: </span>{iv.why_accept}</p>}
      {canAssign && <AssignForm kind="interviewer" team={team} applicationId={s.profile.application_id} onDone={onDone} />}
      {canForm && iv && <InterviewFormBox applicationId={s.profile.application_id} onDone={onDone} />}
      {canForm && iv && s.pipeline.status !== "absent" && <button className={ghost} onClick={markAbsent}>Student didn&apos;t join — mark absent</button>}
      <Msg text={msg} />
    </Section>
  );
}

function InterviewFormBox({ applicationId, onDone }: { applicationId: string; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [f, setF] = useState<InterviewForm>({ communication: null, logic: null, passion: null, achievements: null, why_program: null, cheating_seen: null, interviewer_verdict: "" });
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const text = (k: string, label: string, max = 300) => (
    <label className="block text-xs text-white/50">{label}
      <input className={input} value={extra[k] ?? ""} maxLength={max} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })} />
    </label>
  );
  const pct = (k: string, label: string) => (
    <label className="block text-xs text-white/50">{label}
      <input className={input} type="number" min={0} max={100} step="0.01" value={extra[k] ?? ""} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })} />
    </label>
  );

  async function submit() {
    const errs = interviewFormErrors(f);
    if (errs.length) return setMsg(errs.join(" · "));
    const p: Record<string, unknown> = { application_id: applicationId, ...f };
    const rem = Object.fromEntries(Object.entries(remarks).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    if (Object.keys(rem).length) p.remarks = rem;
    for (const k of ["previous_jee", "other_exams", "financial_reason", "why_accept"]) if (extra[k]?.trim()) p[k] = extra[k].trim();
    for (const k of ["jee_pct", "jee_maths_pct", "expected_jee_pct", "class10_pct", "class11_pct", "class12_pct"]) {
      if (extra[k]?.trim()) { const n = Number(extra[k]); if (!Number.isFinite(n) || n < 0 || n > 100) return setMsg("Percentages must be between 0 and 100."); p[k] = n; }
    }
    for (const k of ["coding_talent", "cert_asked", "drop_year"]) if (extra[k] === "yes" || extra[k] === "no") p[k] = extra[k] === "yes";
    if (extra.financial_capability) p.financial_capability = extra.financial_capability;
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("vsat_submit_interview", { p });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    const d = data as { score: number; calc_verdict: string; stage: Stage; status: Status };
    setMsg(`Saved ✓ Score ${d.score} (${d.calc_verdict}) → ${STAGE_LABEL[d.stage]}${d.status !== "active" ? ` (${STATUS_LABEL[d.status]})` : ""} ✓`);
    onDone();
  }

  const yn = (k: string, label: string) => (
    <label className="block text-xs text-white/50">{label}
      <select className={input} value={extra[k] ?? ""} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })}>
        <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
    </label>
  );

  return (
    <div className="space-y-3 rounded-lg border border-[#34e2b0]/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#34e2b0]">Interview form</p>
      {PARTS.map(([k, label]) => (
        <div key={k} className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="text-sm">{label}</p>
            <input className={`${input} mt-1`} placeholder="Remarks (optional)" maxLength={1000} value={remarks[k] ?? ""}
              onChange={(e) => setRemarks({ ...remarks, [k]: e.target.value })} aria-label={`${label} remarks`} />
          </div>
          <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={f[k] === n}
                className={`h-9 w-9 rounded-lg border text-sm font-semibold ${f[k] === n ? "border-[#34e2b0] bg-[#34e2b0] text-[#04101a]" : "border-white/15 bg-white/5"}`}
                onClick={() => setF({ ...f, [k]: n })}>{n}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-white/50">Cheating seen? (yes = not selected)
          <select className={input} value={f.cheating_seen === null ? "" : f.cheating_seen ? "yes" : "no"}
            onChange={(e) => setF({ ...f, cheating_seen: e.target.value === "" ? null : e.target.value === "yes" })}>
            <option value="">Pick…</option><option value="no">No</option><option value="yes">Yes</option>
          </select>
        </label>
        <label className="block text-xs text-white/50">Your verdict
          <select className={input} value={f.interviewer_verdict} onChange={(e) => setF({ ...f, interviewer_verdict: e.target.value as InterviewForm["interviewer_verdict"] })}>
            <option value="">Pick…</option><option value="selected">Selected</option><option value="maybe">Maybe</option><option value="not_selected">Not selected</option>
          </select>
        </label>
        {yn("coding_talent", "Possible coding talent")}{yn("cert_asked", "National-level certificate asked for")}{yn("drop_year", "Drop year")}
        {text("previous_jee", "Previous JEE (if drop year)", 200)}
        {pct("jee_pct", "JEE percentile")}{pct("jee_maths_pct", "JEE Maths percentile")}{pct("expected_jee_pct", "Expected JEE percentile")}
        {text("other_exams", "Other exams")}
        {pct("class10_pct", "Class 10 %")}{pct("class11_pct", "Class 11 %")}{pct("class12_pct", "Class 12 %")}
        <label className="block text-xs text-white/50">Financial capability
          <select className={input} value={extra.financial_capability ?? ""} onChange={(e) => setExtra({ ...extra, financial_capability: e.target.value })}>
            <option value="">—</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </label>
        {text("financial_reason", "Why (financial capability)", 500)}
      </div>
      <label className="block text-xs text-white/50">Why should Vedam accept you? (student&apos;s answer)
        <textarea className={input} rows={3} maxLength={1500} value={extra.why_accept ?? ""} onChange={(e) => setExtra({ ...extra, why_accept: e.target.value })} />
      </label>
      <p className="text-xs text-white/40">The score is calculated by the system from the five parts. If both the calculated verdict and yours are “Selected”, the student moves to Counselling automatically; otherwise admissions decides.</p>
      <button className={primary} disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit interview"}</button>
      <Msg text={msg} />
    </div>
  );
}

function CounsellingSection({ s, roles, team, onDone }: { s: Student; roles: VsatRoles; team: TeamMember[]; onDone: () => void }) {
  const st = s.pipeline.stage; const c = s.counselling;
  const isCounsellor = roles.roles.includes("counsellor");
  const canAssign = s.can_manage && (st === "pi_cleared" || st === "counselling_scheduled") && s.pipeline.status !== "not_selected";
  const canForm = st === "counselling_scheduled" && (s.can_manage || isCounsellor);
  if (!c && !canAssign) return null;

  return (
    <Section title="Counselling & scholarship">
      {c && <Grid items={[
        ["Counsellor", show(c.counsellor)], ["Slot (IST)", fmtIst(c.slot_datetime)],
        ["Meeting", c.zoom_link ? <a key="m" className="text-[#22d3ee] underline" href={c.zoom_link} target="_blank" rel="noopener noreferrer">Open link</a> : "—"],
        ["Attendance", show(c.attendance)], ["Scholarship score", show(c.calc_score)], ["Category", show(c.calc_category ?? c.scholarship_category)],
        ["Step", show(c.chosen_step, "%")], ["Calculated %", show(c.calculated_pct, "%")], ["Final %", show(c.actual_pct ?? c.scholarship_pct, "%")],
      ]} />}
      {c?.actual_reason && <p className="text-xs text-white/60">Reason for actual %: “{c.actual_reason}”</p>}
      {c && <ProfileBox applicationId={s.profile.application_id} saved={c.profile_analysis ?? null} savedAt={c.profile_generated_at ?? null}
        canGenerate={s.can_manage || isCounsellor} />}
      {canAssign && <AssignForm kind="counsellor" team={team} applicationId={s.profile.application_id} onDone={onDone} />}
      {canForm && c && <CounsellingFormBox applicationId={s.profile.application_id} onDone={onDone} />}
    </Section>
  );
}

/** "**bold**" → <strong>; everything else stays plain text (no HTML from the AI is ever rendered). */
function BriefingText({ text }: { text: string }) {
  return (
    <div className="space-y-1 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
      {text.split("\n").map((line, i) => (
        <p key={i}>{line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
          /^\*\*[^*]+\*\*$/.test(part) ? <strong key={j} className="text-white">{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>)}</p>
      ))}
    </div>
  );
}

/** Profile analyser (step 6): the AI briefing for the counsellor. Generated on the server (/api/vsat/profile). */
function ProfileBox({ applicationId, saved, savedAt, canGenerate }: { applicationId: string; saved: string | null; savedAt: string | null; canGenerate: boolean }) {
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
    <div className="space-y-2 rounded-lg border border-white/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#22d3ee]">Profile analysis</p>
        {canGenerate && <button className={primary} disabled={busy} onClick={generate}>{busy ? "Generating… (up to a minute)" : text ? "Regenerate profile" : "Generate profile"}</button>}
      </div>
      {text ? <>
        <BriefingText text={text} />
        <p className="text-xs text-white/40">Written by AI from this student&apos;s data{at ? ` on ${fmtIst(at)}` : ""}. Check it against the scores before you rely on it.</p>
      </> : <p className="text-xs text-white/50">No profile yet. It reads this student&apos;s application, VSAT and interview data and writes a short briefing for the counselling call.</p>}
      <Msg text={msg} />
    </div>
  );
}

function CounsellingFormBox({ applicationId, onDone }: { applicationId: string; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [pre, setPre] = useState<Preview | null>(null);
  const [remarks, setRemarks] = useState("");
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

  async function submit() {
    if (step === null) return setMsg(errorText("NO_BAND"));
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = { application_id: applicationId };
    if (remarks.trim()) p.remarks = remarks.trim();
    const { data, error } = await supabase.rpc("vsat_submit_counselling", { p });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    const d = data as { actual_pct: number };
    setMsg(`Saved ✓ Scholarship ${d.actual_pct}% → Counselled ✓`);
    onDone();
  }

  if (!pre) return <Msg text={msg} />;
  return (
    <div className="space-y-3 rounded-lg border border-[#34e2b0]/30 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#34e2b0]">Scholarship (calculated by the system)</p>
      <Grid items={[
        ["Case", pre.case.replace(/_/g, " ")], ["Score", String(pre.score)], ["Category", show(pre.category)],
        ["Range", pre.min_award === null ? "—" : `${pre.min_award}%–${pre.max_award}%`],
        ["Step (from the score)", step === null ? "—" : `${step}%`],
        ["JEE floor", pre.jee_floor === null ? "—" : `${pre.jee_floor}% (${pre.jee_floor_enabled ? "on" : "off for this campus"})`],
        ["Achievements (interview)", pre.special_rating === null ? "—" : `${pre.special_rating}/5${pre.special_rating === 5 ? " · +10% if 30% or less" : ""}`],
        ["Final scholarship", calc === null ? "—" : `${calc}%`],
        ["Programme fee", `₹${Number(pre.programme_fee).toLocaleString("en-IN")}`],
      ]} />
      {pre.missing.length > 0 && <p className="text-xs text-amber-200">Missing (counted as 0, like the sheet): {pre.missing.join(", ").replace(/_/g, " ")}</p>}
      {step === null && <p className="text-xs text-amber-200">{errorText("NO_BAND")}</p>}
      <textarea className={input} rows={2} maxLength={2000} placeholder="Counsellor remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} aria-label="Counsellor remarks" />
      <button className={primary} disabled={busy || step === null} onClick={submit}>{busy ? "Saving…" : "Save counselling"}</button>
      <Msg text={msg} />
    </div>
  );
}
