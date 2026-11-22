"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { errorText, fmtIst, isHttpsLink, istSlot } from "@/lib/vsat/pipeline";
import {
  ATTENDANCE_HINT, ATTENDANCE_LABEL, DEFAULT_DURATION_MIN, DURATION_CHOICES, MEET_LABEL, istDate, istParts, istTimeRange,
  isLive, meetErrorText, meetState, type InterviewRow, type MeetState,
} from "@/lib/vsat/interviews";
import type { TeamMember } from "./types";
import { TRACKS, inTrackWords, type Track } from "@/lib/vsat/tracks";

/**
 * VSAT interviews (0140) and counselling sessions (0145, `track`): schedule / move / cancel one student, Google Meet state and
 * attendance (many students: the Interview panel rows, interview-planner.tsx). Every action is a database function that checks the caller again; after a
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

/** Run the queued Google + email work for these students now (interviews or counselling). Never throws: if it fails the cron does it. */
export async function syncInterviewsNow(ids: string[], track: Track = TRACKS.interview): Promise<boolean> {
  if (!ids.length) return true;
  try {
    const res = await fetch(track.syncRoute, {
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
export function InterviewScheduleForm({ team, applicationId, current, onDone, track = TRACKS.interview }:
  { team: TeamMember[]; applicationId: string; current: InterviewRow | null; onDone: () => void; track?: Track }) {
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

  const people = team.filter((t) => t.roles.includes(track.host));
  const missing = live && current?.interviewer_id && !people.some((t) => t.user_id === current.interviewer_id);

  async function save() {
    const slot = istSlot(date, time);
    if (!who) return setMsg(track.host === "interviewer" ? "Pick an interviewer." : `Pick a ${track.host}.`);
    if (!slot) return setMsg("Pick a date and time.");
    if (Date.parse(slot) < Date.now()) return setMsg("Pick a time in the future.");
    if (mode === "own" && !isHttpsLink(link)) return setMsg("Paste the meeting link (it must start with https://).");
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = { application_id: applicationId, [track.hostParam]: who, slot_datetime: slot, duration_min: dur };
    if (mode === "own") p[track.linkParam] = link.trim(); else p.auto_meet = true;
    const { error } = await supabase.rpc(track.rpc.assign, { p });
    if (error) { setBusy(false); return setMsg(errorText(error.message)); }
    setMsg(live ? "Rescheduled ✓" : "Scheduled ✓");
    onDone();
    // Google event + emails now, then show the new Meet state
    await syncInterviewsNow([applicationId], track);
    setBusy(false);
    onDone();
  }

  return (
    <div className="space-y-2 rounded-lg border border-vx-line p-3">
      <p className="text-xs font-semibold text-vx-faint">{live ? "Reschedule (IST)" : `Schedule ${track.noun} (IST)`}</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={`${input} sm:col-span-2`} value={who} onChange={(e) => setWho(e.target.value)} aria-label={track.Host}>
          <option value="">Pick {track.host}…</option>
          {missing && <option value={current?.interviewer_id ?? ""}>{current?.interviewer ?? `Current ${track.host}`} (inactive)</option>}
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
          ? `A Google Calendar invite with a Meet link goes to the student and the ${track.host}.`
          : `No Google invite is made. The student and the ${track.host} get the link by email.`}
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
export function InterviewStatus({ iv, applicationId, manager, isInterviewer, atInterviewStage, studentAbsent, onDone, track = TRACKS.interview }: {
  iv: InterviewRow; applicationId: string; manager: boolean; isInterviewer: boolean; atInterviewStage: boolean; studentAbsent: boolean; onDone: () => void;
  /** interview (default) or counselling: which functions and words; isInterviewer / atInterviewStage then mean the counsellor / the counselling stage */
  track?: Track;
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
        The last {track.noun} was cancelled on {fmtIst(iv.cancelled_at)}{iv.cancel_reason ? `: “${iv.cancel_reason}”` : "."}
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
  const hint = iv.attendance_detail?.reason ? inTrackWords(ATTENDANCE_HINT[iv.attendance_detail.reason] ?? "", track) : "";

  /** One action; true when the database accepted it. */
  async function call(fn: string, p: Record<string, unknown>, ok: string, sync = false): Promise<boolean> {
    setBusy(true); setMsg("");
    const { error } = await supabase.rpc(fn, { p });
    if (error) { setBusy(false); setMsg(errorText(error.message)); return false; }
    setMsg(ok); onDone();
    if (sync) { await syncInterviewsNow([applicationId], track); onDone(); }
    setBusy(false);
    return true;
  }
  function mark(v: "done" | "no_show") {
    if (needReason && reason.trim().length < 3) return setMsg("Please add a reason (at least 3 characters).");
    const p: Record<string, unknown> = { application_id: applicationId, attendance: v };
    if (reason.trim()) p.reason = reason.trim();
    void call(track.rpc.attendance, p, v === "done" ? "Marked joined ✓" : "Marked no-show ✓").then((ok) => { if (ok) setReason(""); });
  }
  function cancel() {
    if (cancelReason.trim().length < 3) return setMsg("Please add a reason (at least 3 characters).");
    void call(track.rpc.cancel, { application_id: applicationId, reason: cancelReason.trim() }, `${track.key === "interview" ? "Interview" : "Counselling session"} cancelled ✓`, true)
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
            onClick={() => void call(track.rpc.meetRetry, { application_id: applicationId }, "Trying again ✓", true)}>Try again</button>
        )}
      </div>
      {state === "failed" && <p className="text-xs text-[#ffb3bf]">{inTrackWords(meetErrorText(iv.meet_error), track)}</p>}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-vx-faint">Attendance</span>
        <span className={att === "done" ? "text-vx-green" : att === "no_show" ? "text-vx-orange-t" : ""}>{ATTENDANCE_LABEL[att] ?? att}</span>
        {!firstMark && iv.attendance_source && (
          <span className="text-xs text-vx-faint">{iv.attendance_source === "auto" ? "from Google Meet" : "marked by staff"}</span>
        )}
      </div>
      {hint && <p className="text-xs text-vx-mut">{hint}{att === "no_show" && manager ? " Change it if the student did join." : ""}</p>}
      {open && !started && <p className="text-xs text-vx-faint">Attendance can be marked once the {track.noun} starts{iv.meet_mode === "auto" ? `. Google Meet fills it in after the ${track.noun} ends` : ""}.</p>}

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
            <p className="text-xs text-vx-mut">The Google invite is removed, the student and the {track.host} are told, and the student goes back to {track.fromStageLabel}.</p>
            <input className={input} placeholder="Reason (required)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
              maxLength={450} aria-label="Cancel reason" />
            <div className="flex flex-wrap gap-2">
              <button className={danger} disabled={busy} onClick={cancel}>{busy ? "Cancelling…" : `Cancel ${track.noun}`}</button>
              <button className={ghost} disabled={busy} onClick={() => { setCancelling(false); setCancelReason(""); }}>Keep it</button>
            </div>
          </div>
        ) : (
          <button className={cx(vx.btn, vx.ghost, vx.sm)} onClick={() => setCancelling(true)}>Cancel {track.noun}…</button>
        )
      )}
      <Msg text={msg} />
    </div>
  );
}
