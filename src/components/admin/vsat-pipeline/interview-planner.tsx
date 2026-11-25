"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { errorText, istSlot } from "@/lib/vsat/pipeline";
import {
  SEND_MAX, blockedText, cellValues, draftPayload, fillResultText, isEditable, lockedCells, lockedStatus, parsePlan, sameCells, selectionSummary, sendLabel,
  sendResultText, statusOf, toPlanRow, type CellValues, type FillResult, type PlanRow, type SendResult,
} from "@/lib/vsat/interview-plan";
import { syncInterviewsNow } from "./interview-tools";
import { TRACKS, inTrackWords, type Track } from "@/lib/vsat/tracks";
import type { TeamMember } from "./types";

/**
 * Interview panel (0143) and Counselling panel (0145): book from the rows, like the old sheet. `track` picks
 * the interview or counselling functions, team role and words; the rules are the same.
 * Admin / admissions type Interviewer, Date and Time on a student's row; it is saved as "not sent yet"
 * (shared with the team, checked for clashes by the database). Select rows → one Send books each row with
 * its own time, its own Google Meet and its own emails. "Fill times" types back-to-back times for the selection.
 */

const cell = "h-8 rounded-lg border border-vx-line2 bg-black/20 px-2 text-[13px] text-vx-ink [color-scheme:dark] " +
  "focus:border-vx-violet focus:outline-none focus:ring-2 focus:ring-vx-violet/30 disabled:cursor-not-allowed disabled:opacity-40";
const SAVE_AFTER_MS = 450;
const REPLAN_AFTER_MS = 700;

export type Planner = ReturnType<typeof useInterviewPlan>;

/** The plan for the rows on screen, the team's interviewers, and saving what is typed. Off for everyone but managers. */
export function useInterviewPlan(ids: string[], on: boolean, track: Track = TRACKS.interview) {
  const [supabase] = useState(() => createClient());
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [plan, setPlan] = useState<Map<string, PlanRow>>(new Map());
  const [edits, setEdits] = useState<Record<string, CellValues>>({});   // typed on screen, not saved yet
  const [waiting, setWaiting] = useState<Set<string>>(new Set());       // a save is queued or running
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadErr, setLoadErr] = useState("");
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const replanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const key = ids.join("\n");

  useEffect(() => {
    if (!on) return;
    let live = true;
    void supabase.rpc("vsat_team_list").then(({ data }) => { if (live) setTeam(Array.isArray(data) ? (data as TeamMember[]) : []); });
    return () => { live = false; };
  }, [supabase, on]);

  const replan = useCallback(async () => {
    const list = key ? key.split("\n") : [];
    if (!on || !list.length) { setPlan(new Map()); return; }
    const my = ++seq.current;
    const { data, error } = await supabase.rpc(track.rpc.plan, { p: { application_ids: list } });
    if (my !== seq.current) return;   // a newer plan is on its way
    if (error) { setLoadErr(errorText(error.message)); return; }
    setLoadErr("");
    setPlan(parsePlan(data));
  }, [supabase, on, key, track]);

  // a new page / filter: start clean
  useEffect(() => {
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    setEdits({}); setErrors({}); setWaiting(new Set());
    void replan();
  }, [replan]);
  useEffect(() => () => {
    for (const t of timers.current.values()) clearTimeout(t);
    if (replanTimer.current) clearTimeout(replanTimer.current);
  }, []);

  const replanSoon = useCallback(() => {
    if (replanTimer.current) clearTimeout(replanTimer.current);
    replanTimer.current = setTimeout(() => void replan(), REPLAN_AFTER_MS);
  }, [replan]);

  const mark = (app: string, busy: boolean) => setWaiting((s) => { const n = new Set(s); if (busy) n.add(app); else n.delete(app); return n; });

  const save = useCallback(async (app: string, p: Exclude<ReturnType<typeof draftPayload>, "partial">, sent: CellValues) => {
    // the host is "interviewer_id" in the shared helpers; each track's function names it its own way
    const { data, error } = await supabase.rpc(track.rpc.draftSet, {
      p: { application_id: p.application_id, [track.hostParam]: p.interviewer_id, slot_datetime: p.slot_datetime },
    });
    if (!timers.current.has(app)) mark(app, false);
    if (error) { setErrors((e) => ({ ...e, [app]: inTrackWords(errorText(error.message), track) })); return; }
    const r = toPlanRow(data);
    if (r) setPlan((m) => new Map(m).set(app, r));
    // keep the on-screen copy if something newer was typed meanwhile
    setEdits((e) => { if (!e[app] || !sameCells(e[app], sent)) return e; const n = { ...e }; delete n[app]; return n; });
    replanSoon();   // one row's change can make or clear a clash on another
  }, [supabase, replanSoon, track]);

  const cells = useCallback((app: string): CellValues => edits[app] ?? cellValues(plan.get(app)), [edits, plan]);

  const setCell = useCallback((app: string, patch: Partial<CellValues>) => {
    const next = { ...(edits[app] ?? cellValues(plan.get(app))), ...patch };
    setEdits((e) => ({ ...e, [app]: next }));
    setErrors((e) => { if (!e[app]) return e; const n = { ...e }; delete n[app]; return n; });
    const old = timers.current.get(app);
    if (old) clearTimeout(old);
    timers.current.delete(app);
    const p = draftPayload(app, next);
    if (p === "partial") { if (!old) return; mark(app, false); return; }
    mark(app, true);
    timers.current.set(app, setTimeout(() => { timers.current.delete(app); void save(app, p, next); }, SAVE_AFTER_MS));
  }, [edits, plan, save]);

  /** Back to the booking (or empty for a new row): the typed values are dropped. */
  const undo = useCallback((app: string) => {
    const b = plan.get(app)?.booked;
    const back: CellValues = b ? cellValues({ ...plan.get(app)!, draft: null }) : { interviewer_id: "", date: "", time: "" };
    const old = timers.current.get(app);
    if (old) clearTimeout(old);
    timers.current.delete(app);
    setEdits((e) => ({ ...e, [app]: back }));
    mark(app, true);
    void save(app, { application_id: app, interviewer_id: b ? b.interviewer_id : null, slot_datetime: b ? b.slot : null }, back);
  }, [plan, save]);

  const interviewers = useMemo(() => team.filter((t) => t.roles.includes(track.host))
    .sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "")), [team, track]);

  return { plan, cells, setCell, undo, waiting, errors, loadErr, replan, interviewers, track };
}

const who = (t: TeamMember, track: Track) => t.name ?? t.email ?? track.Host;
/** "Interview" / "Counselling" (the aria labels of the date and time cells). */
const short = (track: Track) => track.Noun.split(" ")[0];

type LockProps = { stage?: string; status?: string };

/** A small padlock (decorative: the words beside it say what is locked). */
function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0">
      <path fill="currentColor" d="M4 7V5a4 4 0 0 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm1.5 0h5V5a2.5 2.5 0 0 0-5 0v2Z" />
    </svg>
  );
}

/**
 * A locked row (stage past booking, Not selected, or already done) shows its booking as plain words with a
 * padlock and the reason on hover, not a greyed-out dropdown that looks broken (owner's review, 24 Nov 2026).
 */
function LockedCell({ width, text, planner, stage, status }: { width: string; text: string; planner: Planner } & LockProps) {
  const why = lockedStatus(planner.track, stage, status);
  return (
    <span className={cx("inline-flex h-8 cursor-help items-center gap-1.5 text-[13px] text-vx-faint", width)} title={why.title}>
      <LockIcon /><span className="sr-only">Locked: </span><span className="truncate">{text}</span>
    </span>
  );
}

/** Interviewer dropdown of one row. */
export function PlanInterviewer({ app, name, planner, stage, status }: { app: string; name: string; planner: Planner } & LockProps) {
  const row = planner.plan.get(app);
  const v = planner.cells(app);
  const known = planner.interviewers.find((t) => t.user_id === v.interviewer_id);
  if (row?.state === "locked") {
    const text = !v.interviewer_id ? "—" : known ? who(known, planner.track) : `Inactive ${planner.track.host}`;
    return <LockedCell width="w-44" text={text} planner={planner} stage={stage} status={status} />;
  }
  return (
    <select className={cx(cell, "w-44")} value={v.interviewer_id} disabled={!isEditable(row)} aria-label={`${planner.track.Host} for ${name}`}
      onChange={(e) => planner.setCell(app, { interviewer_id: e.target.value })}>
      <option value="">—</option>
      {v.interviewer_id && !known && <option value={v.interviewer_id}>Inactive {planner.track.host}</option>}
      {planner.interviewers.map((t) => <option key={t.user_id} value={t.user_id}>{who(t, planner.track)}{t.campus ? ` (${t.campus})` : ""}</option>)}
    </select>
  );
}

/** Date (IST) of one row. */
export function PlanDate({ app, name, planner, stage, status }: { app: string; name: string; planner: Planner } & LockProps) {
  const row = planner.plan.get(app);
  const v = planner.cells(app);
  if (row?.state === "locked") return <LockedCell width="w-[9.5rem]" text={lockedCells(v).date} planner={planner} stage={stage} status={status} />;
  return (
    <input type="date" className={cx(cell, "w-[9.5rem]")} value={v.date} disabled={!isEditable(row)}
      aria-label={`${short(planner.track)} date for ${name} (IST)`} onChange={(e) => planner.setCell(app, { date: e.target.value })} />
  );
}

/** Time (IST) of one row, 5-minute steps. */
export function PlanTime({ app, name, planner, stage, status }: { app: string; name: string; planner: Planner } & LockProps) {
  const row = planner.plan.get(app);
  const v = planner.cells(app);
  if (row?.state === "locked") return <LockedCell width="w-[7.5rem]" text={lockedCells(v).time} planner={planner} stage={stage} status={status} />;
  return (
    <input type="time" step={300} className={cx(cell, "w-[7.5rem]")} value={v.time} disabled={!isEditable(row)}
      aria-label={`${short(planner.track)} time for ${name} (IST)`} onChange={(e) => planner.setCell(app, { time: e.target.value })} />
  );
}

/**
 * What will happen to the row: not sent / booked / a problem in words, and Undo for typed changes.
 * A locked row says why (its stage / status from the grid row), with what would allow it on hover.
 */
export function PlanStatus({ app, planner, stage, status }: { app: string; planner: Planner; stage?: string; status?: string }) {
  const row = planner.plan.get(app);
  const err = planner.errors[app];
  const v = planner.cells(app);
  if (err) return <span className={cx(vx.badge, vx.tone.red)} role="status">{err}</span>;
  if (planner.waiting.has(app)) return <span className="text-xs text-vx-faint">Saving…</span>;
  // half typed (a date without a time): only on this screen until the time is picked
  if (draftPayload(app, v) === "partial") return <span className={cx(vx.badge, vx.tone.orange)}>Pick the {v.date ? "time" : "date"}</span>;
  const raw = statusOf(row);
  const s = row?.state === "locked" ? lockedStatus(planner.track, stage, status)
    : { ...raw, label: inTrackWords(raw.label, planner.track), title: raw.title ? inTrackWords(raw.title, planner.track) : undefined };
  const canUndo = !!row?.draft && isEditable(row);
  if (s.tone === "neutral" && !canUndo) return <span className={cx("text-vx-faint", s.title && "cursor-help")} title={s.title}>{s.label}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cx(vx.badge, vx.tone[s.tone])} title={s.title}>{s.label}</span>
      {canUndo && (
        <button type="button" className="text-xs text-vx-faint underline-offset-2 hover:text-vx-ink hover:underline" onClick={() => planner.undo(app)}>
          {row?.booked ? "Undo" : "Clear"}
        </button>
      )}
    </span>
  );
}

export type PlanMessage = { text: string; ok: boolean };

/**
 * Selection bar: Send (with a short confirm, no popup) and Fill times. Rows go in the table's order.
 * Only rows the database marked ready / changed are sent; the database checks each one again.
 * The Send result goes to `onSent` (the panel shows it: the reload after a send clears the selection and this bar).
 */
export function PlanBar({ ids, planner, onDone, onSent }:
  { ids: string[]; planner: Planner; onDone: () => void; onSent: (m: PlanMessage) => void }) {
  const [supabase] = useState(() => createClient());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"" | "send" | "fill">("");
  const [msg, setMsg] = useState<PlanMessage | null>(null);
  const [fillWho, setFillWho] = useState("");
  const [fillDate, setFillDate] = useState("");
  const [fillTime, setFillTime] = useState("");

  const sum = useMemo(() => selectionSummary(ids, planner.plan), [ids, planner.plan]);
  const toSend = [...sum.invites, ...sum.updates].sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
  const saving = ids.some((id) => planner.waiting.has(id));
  const tooMany = toSend.length > SEND_MAX;
  const blocked = (() => { const b = blockedText(sum); return b ? inTrackWords(b, planner.track) : b; })();
  const idsKey = ids.join("\n");
  useEffect(() => { setConfirming(false); }, [idsKey]);   // a different selection needs a fresh confirm

  async function send() {
    setBusy("send"); setMsg(null);
    const { data, error } = await supabase.rpc(planner.track.rpc.draftsSend, { p: { application_ids: toSend } });
    setConfirming(false);
    if (error) { setBusy(""); setMsg({ text: inTrackWords(errorText(error.message), planner.track), ok: false }); return; }
    const r = data as SendResult;
    onSent({ text: inTrackWords(sendResultText(r), planner.track), ok: r.skipped.length === 0 && r.sent.length > 0 });
    // Google Meet + emails for the booked ones now (the cron does it anyway)
    const booked = r.sent.filter((s) => s.kind).map((s) => s.application_id);
    onDone();   // the rows show "Booked" right away
    if (booked.length) { await syncInterviewsNow(booked, planner.track); onDone(); }   // then the Meet state
    setBusy("");
  }

  async function fill() {
    const start = istSlot(fillDate, fillTime);
    if (!fillWho) return setMsg({ text: `Pick the ${planner.track.host} to fill with.`, ok: false });
    if (!start) return setMsg({ text: "Pick the start date and time.", ok: false });
    if (Date.parse(start) < Date.now()) return setMsg({ text: "Pick a start time in the future.", ok: false });
    if (ids.length > SEND_MAX) return setMsg({ text: `Select at most ${SEND_MAX} students to fill.`, ok: false });
    setBusy("fill"); setMsg(null);
    const { data, error } = await supabase.rpc(planner.track.rpc.draftsFill, { p: { application_ids: ids, [planner.track.hostParam]: fillWho, start } });
    setBusy("");
    if (error) return setMsg({ text: inTrackWords(errorText(error.message), planner.track), ok: false });
    const r = data as FillResult;
    setMsg({ text: inTrackWords(fillResultText(r), planner.track), ok: r.skipped.length === 0 && r.filled.length > 0 });
    void planner.replan();
  }

  return (
    <div className="space-y-2 border-b border-vx-violet/20 pb-2">
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-sm text-vx-ink">
              Book {toSend.length} {planner.track.noun}{toSend.length === 1 ? "" : "s"}?{" "}
              {planner.track.key === "counselling"
                // 0184 / 0186: online on the counsellor's Zoom link; offline is recorded only
                ? "Online students get a calendar invite with their counsellor's Zoom link and emails; offline students are recorded only (no invite or email)."
                : `Each one gets its own Google Meet and emails to the student and the ${planner.track.host}.`}
            </span>
            <button className={cx(vx.btn, vx.primary)} disabled={busy !== ""} onClick={() => void send()}>{busy === "send" ? "Sending…" : "Yes, send"}</button>
            <button className={cx(vx.btn, vx.secondary)} disabled={busy !== ""} onClick={() => setConfirming(false)}>Back</button>
          </>
        ) : (
          <>
            <button className={cx(vx.btn, vx.primary)} disabled={busy !== "" || saving || toSend.length === 0 || tooMany}
              title={tooMany ? `At most ${SEND_MAX} at a time` : saving ? "Saving your changes…" : undefined}
              onClick={() => { setMsg(null); setConfirming(true); }}>
              {sendLabel(sum)}
            </button>
            {saving && <span className="text-xs text-vx-faint">Saving…</span>}
            {blocked && <span className="text-xs text-vx-orange-t">{blocked}</span>}
            {tooMany && <span className="text-xs text-vx-orange-t">At most {SEND_MAX} at a time.</span>}
          </>
        )}
      </div>
      {!confirming && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-vx-mut">Fill times</span>
          <select className={cell} value={fillWho} onChange={(e) => setFillWho(e.target.value)} aria-label={`${planner.track.Host} to fill with`}>
            <option value="">{planner.track.Host}…</option>
            {planner.interviewers.map((t) => <option key={t.user_id} value={t.user_id}>{who(t, planner.track)}{t.campus ? ` (${t.campus})` : ""}</option>)}
          </select>
          <input type="date" className={cell} value={fillDate} onChange={(e) => setFillDate(e.target.value)} aria-label="Fill from date (IST)" />
          <input type="time" step={300} className={cell} value={fillTime} onChange={(e) => setFillTime(e.target.value)} aria-label="Fill from time (IST)" />
          <button className={cx(vx.btn, vx.secondary, vx.sm)} disabled={busy !== ""} onClick={() => void fill()}>{busy === "fill" ? "Filling…" : "Fill times"}</button>
          <span className="text-xs text-vx-faint">30 min each, back to back, busy times skipped. Only fills the rows; nothing is sent.</span>
        </div>
      )}
      {msg && <p role="status" className={`text-sm ${msg.ok ? "text-vx-green" : "text-vx-ink"}`}>{msg.text}</p>}
    </div>
  );
}
