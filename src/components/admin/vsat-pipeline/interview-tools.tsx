"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { errorText, fmtIst, isHttpsLink, istSlot } from "@/lib/vsat/pipeline";
import {
  ATTENDANCE_HINT, ATTENDANCE_LABEL, BULK_MAX, DEFAULT_DURATION_MIN, DURATION_CHOICES, MEET_LABEL, istDate, istParts, istTime, istTimeRange,
  isLive, meetErrorText, meetState, type InterviewRow, type MeetState,
} from "@/lib/vsat/interviews";
import type { TeamMember } from "./types";

/**
 * VSAT interviews (Phase 2, migration 0140): schedule / move / cancel, Google Meet state, attendance,
 * and the bulk scheduler. Every action is a database function that checks the caller again; after a
 * save the panel asks the server to run the Google + email work now (the cron does it within 10 minutes anyway).
 */

const input = vx.input;
const primary = cx(vx.btn, vx.primary);
const ghost = cx(vx.btn, vx.secondary);
const danger = cx(vx.btn, vx.danger);

function Msg({ text }: { text: string }) {
  if (!text) return null;
  const ok = text.endsWith("✓");
  return <p role="status" className={`rounded-lg px-3 py-2 text-sm ${ok ? "bg-vx-green/10 text-vx-green" : "bg-vx-red/10 text-[#ffb3bf]"}`}>{text}</p>;
}

/** Run the queued Google + email work for these students now. Never throws: if it fails the cron does it. */
export async function syncInterviewsNow(ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  try {
    const res = await fetch("/api/vsat/interviews/sync", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ application_ids: ids.slice(0, 50) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const MEET_TONE: Record<MeetState, string> = {
  ready: vx.tone.green, creating: vx.tone.teal, failed: vx.tone.red, own_link: vx.tone.neutral, cancelled: vx.tone.neutral,
};
export function MeetBadge({ state }: { state: MeetState }) {
  return <span className={cx(vx.badge, MEET_TONE[state])}>{MEET_LABEL[state]}</span>;
}

const durationOptions = (current: number | null | undefined) =>
  [...new Set([...DURATION_CHOICES, ...(current ? [current] : [])])].sort((a, b) => a - b);

/** "Wed, 25 Nov 2026 · 11:00 am – 11:30 am IST" */
export const slotText = (iso: string | null | undefined, dur: number | null | undefined) =>
  iso ? `${istDate(iso)} · ${istTimeRange(iso, dur)}` : "—";

// ── schedule / reschedule one student ─────────────────────────────────────────

/** Admin / admissions: interviewer, date and time (IST), length, Google Meet or own link. Reschedule when one is booked. */
export function InterviewScheduleForm({ team, applicationId, current, onDone }:
  { team: TeamMember[]; applicationId: string; current: InterviewRow | null; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const live = isLive(current);
  const start = live ? istParts(current?.slot_datetime) : { date: "", time: "" };
  const [who, setWho] = useState(live ? current?.interviewer_id ?? "" : "");
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [dur, setDur] = useState<number>(live ? current?.duration_min ?? DEFAULT_DURATION_MIN : DEFAULT_DURATION_MIN);
  const ownBefore = live && current?.meet_mode === "manual";
  const [mode, setMode] = useState<"google" | "own">(ownBefore ? "own" : "google");
  const [link, setLink] = useState(ownBefore ? current?.meet_link ?? "" : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const people = team.filter((t) => t.roles.includes("interviewer"));
  const missing = live && current?.interviewer_id && !people.some((t) => t.user_id === current.interviewer_id);

  async function save() {
    const slot = istSlot(date, time);
    if (!who) return setMsg("Pick an interviewer.");
    if (!slot) return setMsg("Pick a date and time.");
    if (Date.parse(slot) < Date.now()) return setMsg("Pick a time in the future.");
    if (mode === "own" && !isHttpsLink(link)) return setMsg("Paste the meeting link (it must start with https://).");
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = { application_id: applicationId, interviewer_id: who, slot_datetime: slot, duration_min: dur };
    if (mode === "own") p.meet_link = link.trim(); else p.auto_meet = true;
    const { error } = await supabase.rpc("vsat_assign_interview", { p });
    if (error) { setBusy(false); return setMsg(errorText(error.message)); }
    setMsg(live ? "Rescheduled ✓" : "Scheduled ✓");
    onDone();
    // Google event + emails now, then show the new Meet state
    await syncInterviewsNow([applicationId]);
    setBusy(false);
    onDone();
  }

  return (
    <div className="space-y-2 rounded-lg border border-vx-line p-3">
      <p className="text-xs font-semibold text-vx-faint">{live ? "Reschedule (IST)" : "Schedule interview (IST)"}</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={`${input} sm:col-span-2`} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Interviewer">
          <option value="">Pick interviewer…</option>
          {missing && <option value={current?.interviewer_id ?? ""}>{current?.interviewer ?? "Current interviewer"} (inactive)</option>}
          {people.map((t) => <option key={t.user_id} value={t.user_id}>{t.name ?? t.email}{t.campus ? ` (${t.campus})` : ""}</option>)}
        </select>
        <input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <input className={input} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-vx-faint">Length</span>
          <select className={vx.field} value={dur} onChange={(e) => setDur(Number(e.target.value))} aria-label="Length in minutes">
            {durationOptions(current?.duration_min).map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <fieldset className="flex flex-wrap items-center gap-3 text-sm">
          <legend className="sr-only">Meeting</legend>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" name={`meet-${applicationId}`} className="accent-[#8a18ff]" checked={mode === "google"} onChange={() => setMode("google")} />
            Google Meet (automatic)
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" name={`meet-${applicationId}`} className="accent-[#8a18ff]" checked={mode === "own"} onChange={() => setMode("own")} />
            Own link
          </label>
        </fieldset>
      </div>
      {mode === "own" && (
        <input className={input} placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} maxLength={300} aria-label="Meeting link" />
      )}
      <p className="text-xs text-vx-faint">
        {mode === "google"
          ? "A Google Calendar invite with a Meet link goes to the student and the interviewer."
          : "No Google invite is made. The student and the interviewer get the link by email."}
      </p>
      <button className={primary} disabled={busy} onClick={save}>{busy ? "Saving…" : live ? "Reschedule" : "Schedule"}</button>
      <Msg text={msg} />
    </div>
  );
}

// ── Meet state, attendance, cancel ────────────────────────────────────────────

/**
 * What happened to a booked interview: the Google Meet, attendance (from Meet or marked by staff),
 * and the actions. Interviewers may mark attendance once; changing a mark is admin / admissions, with a reason.
 */
export function InterviewStatus({ iv, applicationId, manager, isInterviewer, atInterviewStage, studentAbsent, onDone }: {
  iv: InterviewRow; applicationId: string; manager: boolean; isInterviewer: boolean; atInterviewStage: boolean; studentAbsent: boolean; onDone: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const state = meetState(iv);
  if (iv.cancelled_at) {
    return (
      <p className="text-sm text-vx-mut">
        The last interview was cancelled on {fmtIst(iv.cancelled_at)}{iv.cancel_reason ? `: “${iv.cancel_reason}”` : "."}
      </p>
    );
  }
  if (!isLive(iv)) return null;

  const started = !!iv.slot_datetime && Date.parse(iv.slot_datetime) <= now;
  const open = atInterviewStage && !iv.submitted_at;
  const att = iv.attendance ?? "scheduled";
  const firstMark = att === "scheduled";
  const canMark = open && started && (manager || (isInterviewer && firstMark));
  const needReason = !firstMark || studentAbsent;
  const hint = iv.attendance_detail?.reason ? ATTENDANCE_HINT[iv.attendance_detail.reason] : "";

  /** One action; true when the database accepted it. */
  async function call(fn: string, p: Record<string, unknown>, ok: string, sync = false): Promise<boolean> {
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc(fn, { p });
    if (error) { setBusy(false); setMsg(errorText(error.message)); return false; }
    setMsg(ok); onDone();
    if (sync) { await syncInterviewsNow([applicationId]); onDone(); }
    setBusy(false);
    return true;
  }
  function mark(v: "done" | "no_show") {
    if (needReason && reason.trim().length < 3) return setMsg("Please add a reason (at least 3 characters).");
    const p: Record<string, unknown> = { application_id: applicationId, attendance: v };
    if (reason.trim()) p.reason = reason.trim();
    void call("vsat_set_interview_attendance", p, v === "done" ? "Marked joined ✓" : "Marked no-show ✓").then((ok) => { if (ok) setReason(""); });
  }
  function cancel() {
    if (cancelReason.trim().length < 3) return setMsg("Please add a reason (at least 3 characters).");
    void call("vsat_cancel_interview", { application_id: applicationId, reason: cancelReason.trim() }, "Interview cancelled ✓", true)
      .then((ok) => { if (ok) { setCancelling(false); setCancelReason(""); } });
  }

  return (
    <div className="space-y-3 rounded-lg border border-vx-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-vx-faint">Meeting</span>
        {state && <MeetBadge state={state} />}
        {iv.meet_link && isHttpsLink(iv.meet_link) && (
          <a className="text-sm text-vx-violet-t underline" href={iv.meet_link} target="_blank" rel="noopener noreferrer">Open meeting</a>
        )}
        {state === "creating" && (iv.meet_attempts ?? 0) > 0 && <span className="text-xs text-vx-faint">Google is retrying (try {iv.meet_attempts} of 5)</span>}
        {state === "failed" && manager && (
          <button className={cx(vx.btn, vx.secondary, vx.sm)} disabled={busy}
            onClick={() => void call("vsat_interview_meet_retry", { application_id: applicationId }, "Trying again ✓", true)}>Try again</button>
        )}
      </div>
      {state === "failed" && <p className="text-xs text-[#ffb3bf]">{meetErrorText(iv.meet_error)}</p>}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-vx-faint">Attendance</span>
        <span className={att === "done" ? "text-vx-green" : att === "no_show" ? "text-vx-orange-t" : ""}>{ATTENDANCE_LABEL[att] ?? att}</span>
        {!firstMark && iv.attendance_source && (
          <span className="text-xs text-vx-faint">{iv.attendance_source === "auto" ? "from Google Meet" : "marked by staff"}</span>
        )}
      </div>
      {hint && <p className="text-xs text-vx-mut">{hint}{att === "no_show" && manager ? " Change it if the student did join." : ""}</p>}
      {open && !started && <p className="text-xs text-vx-faint">Attendance can be marked once the interview starts{iv.meet_mode === "auto" ? ". Google Meet fills it in after the interview ends" : ""}.</p>}

      {canMark && (
        <div className="space-y-2">
          {needReason && (
            <input className={input} placeholder={firstMark ? "Reason (required: the student is marked absent)" : "Reason for changing the attendance (required)"}
              value={reason} onChange={(e) => setReason(e.target.value)} maxLength={450} aria-label="Attendance reason" />
          )}
          <div className="flex flex-wrap gap-2">
            {att !== "done" && <button className={ghost} disabled={busy} onClick={() => mark("done")}>Student joined</button>}
            {att !== "no_show" && <button className={ghost} disabled={busy} onClick={() => mark("no_show")}>Student didn&apos;t join</button>}
          </div>
        </div>
      )}

      {manager && open && (
        cancelling ? (
          <div className="space-y-2 rounded-lg border border-vx-red/25 bg-vx-red/[0.05] p-3">
            <p className="text-xs text-vx-mut">The Google invite is removed, the student and the interviewer are told, and the student goes back to VSAT cleared.</p>
            <input className={input} placeholder="Reason (required)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
              maxLength={450} aria-label="Cancel reason" />
            <div className="flex flex-wrap gap-2">
              <button className={danger} disabled={busy} onClick={cancel}>{busy ? "Cancelling…" : "Cancel interview"}</button>
              <button className={ghost} disabled={busy} onClick={() => { setCancelling(false); setCancelReason(""); }}>Keep it</button>
            </div>
          </div>
        ) : (
          <button className={cx(vx.btn, vx.ghost, vx.sm)} onClick={() => setCancelling(true)}>Cancel interview…</button>
        )
      )}
      <Msg text={msg} />
    </div>
  );
}

// ── bulk ──────────────────────────────────────────────────────────────────────

type BulkPlan = {
  dry_run: boolean; duration_min: number; start: string; ends_at: string | null;
  scheduled: { application_id: string; name: string | null; slot: string }[];
  skipped: { application_id: string; name: string | null; code: string }[];
};

/**
 * Admin / admissions: up to 40 selected students with one interviewer, back to back from a start time.
 * Preview first (nothing saved), then confirm. Times the interviewer is already busy are skipped by the database.
 */
export function BulkScheduleDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [who, setWho] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [dur, setDur] = useState<number>(DEFAULT_DURATION_MIN);
  const [plan, setPlan] = useState<BulkPlan | null>(null);
  const [done, setDone] = useState<BulkPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const tooMany = ids.length > BULK_MAX;

  useEffect(() => {
    void supabase.rpc("vsat_team_list").then(({ data }) => setTeam(Array.isArray(data) ? (data as TeamMember[]) : []));
  }, [supabase]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  // any change to the inputs makes the preview stale
  useEffect(() => { setPlan(null); }, [who, date, time, dur]);

  const people = useMemo(() => (team ?? []).filter((t) => t.roles.includes("interviewer")), [team]);
  const whoName = people.find((t) => t.user_id === who)?.name ?? people.find((t) => t.user_id === who)?.email ?? "";

  async function run(dry: boolean) {
    const start = istSlot(date, time);
    if (!who) return setMsg("Pick an interviewer.");
    if (!start) return setMsg("Pick a start date and time.");
    if (Date.parse(start) < Date.now()) return setMsg("Pick a start time in the future.");
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("vsat_schedule_interviews_bulk", {
      p: { application_ids: ids, interviewer_id: who, start, duration_min: dur, dry_run: dry },
    });
    if (error) { setBusy(false); return setMsg(errorText(error.message)); }
    const res = data as BulkPlan;
    if (dry) { setPlan(res); setBusy(false); return; }
    setDone(res); setPlan(null);
    onDone();
    await syncInterviewsNow(res.scheduled.map((s) => s.application_id));
    setBusy(false);
    onDone();
  }

  const shown = done ?? plan;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby="bulk-iv-title"
        className="fixed left-1/2 top-6 z-50 flex max-h-[calc(100vh-3rem)] w-[min(720px,94%)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-vx-line bg-[#0e0b29] text-vx-ink shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-vx-line px-5 py-4">
          <div>
            <h2 id="bulk-iv-title" className="text-base font-bold">Schedule interviews</h2>
            <p className="text-xs text-vx-faint">{ids.length} selected · one interviewer, back to back from the start time (IST). Busy times are skipped.</p>
          </div>
          <button className={cx(vx.btn, vx.ghost, vx.sm)} onClick={onClose} disabled={busy}>Close</button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4 text-sm">
          {tooMany && <p className={vx.error}>Pick at most {BULK_MAX} students at a time.</p>}
          {!done && (
            <div className="grid gap-2 sm:grid-cols-4">
              <select className={`${input} sm:col-span-2`} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Interviewer" disabled={!team}>
                <option value="">{team ? "Pick interviewer…" : "Loading…"}</option>
                {people.map((t) => <option key={t.user_id} value={t.user_id}>{t.name ?? t.email}{t.campus ? ` (${t.campus})` : ""}</option>)}
              </select>
              <input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Start date" />
              <input className={input} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Start time" />
              <label className="flex items-center gap-2 sm:col-span-4">
                <span className="text-vx-faint">Each interview</span>
                <select className={vx.field} value={dur} onChange={(e) => setDur(Number(e.target.value))} aria-label="Length in minutes">
                  {DURATION_CHOICES.map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
                <span className="text-xs text-vx-faint">Google Meet for each, invites to the student and {whoName || "the interviewer"}.</span>
              </label>
            </div>
          )}

          {shown && (
            <div className="space-y-2">
              <p className="font-medium">
                {done
                  ? `Scheduled ${done.scheduled.length} interview${done.scheduled.length === 1 ? "" : "s"} ✓`
                  : `Preview: ${shown.scheduled.length} will be scheduled${shown.skipped.length ? `, ${shown.skipped.length} skipped` : ""}`}
                {shown.scheduled.length > 0 && shown.ends_at && <span className="font-normal text-vx-faint"> · last one ends {istTime(shown.ends_at)} IST</span>}
              </p>
              {shown.scheduled.length > 0 && (
                <ul className="max-h-60 overflow-y-auto rounded-lg border border-vx-line">
                  {shown.scheduled.map((r) => (
                    <li key={r.application_id} className="flex flex-wrap justify-between gap-2 border-b border-vx-line-soft px-3 py-2 last:border-0">
                      <span>{r.name ?? r.application_id}</span>
                      <span className="tabular-nums text-vx-mut">{slotText(r.slot, shown.duration_min)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {shown.skipped.length > 0 && (
                <div className="rounded-lg border border-vx-orange/25 bg-vx-orange/[0.05] p-3">
                  <p className="mb-1 text-xs font-semibold text-vx-orange-t">Skipped</p>
                  <ul className="space-y-1 text-xs text-vx-mut">
                    {shown.skipped.map((r) => <li key={r.application_id}>{r.name ?? r.application_id}: {errorText(r.code)}</li>)}
                  </ul>
                </div>
              )}
              {done && <p className="text-xs text-vx-faint">Google Meet invites are being made now. Emails go out once each Meet link is ready (within 20 minutes at most).</p>}
            </div>
          )}
          <Msg text={msg} />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-vx-line px-5 py-4">
          {done ? (
            <button className={primary} onClick={onClose} disabled={busy}>{busy ? "Making invites…" : "Done"}</button>
          ) : (
            <>
              <button className={ghost} disabled={busy || tooMany || !team} onClick={() => void run(true)}>{busy && !plan ? "Checking…" : "Preview"}</button>
              <button className={primary} disabled={busy || tooMany || !plan || plan.scheduled.length === 0} onClick={() => void run(false)}>
                {busy && plan ? "Scheduling…" : plan ? `Schedule ${plan.scheduled.length}` : "Schedule"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
