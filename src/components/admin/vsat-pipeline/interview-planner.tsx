"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { errorText, istSlot } from "@/lib/vsat/pipeline";
import {
  SEND_MAX, blockedText, cellValues, draftPayload, fillResultText, isEditable, parsePlan, sameCells, selectionSummary, sendLabel,
  sendResultText, statusOf, toPlanRow, type CellValues, type FillResult, type PlanRow, type SendResult,
} from "@/lib/vsat/interview-plan";
import { syncInterviewsNow } from "./interview-tools";
import type { TeamMember } from "./types";

/**
 * Interview panel (0143): book interviews from the rows, like the old sheet.
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
export function useInterviewPlan(ids: string[], on: boolean) {
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
    const { data, error } = await supabase.rpc("vsat_interview_plan", { p: { application_ids: list } });
    if (my !== seq.current) return;   // a newer plan is on its way
    if (error) { setLoadErr(errorText(error.message)); return; }
    setLoadErr("");
    setPlan(parsePlan(data));
  }, [supabase, on, key]);

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
    const { data, error } = await supabase.rpc("vsat_interview_draft_set", { p });
    if (!timers.current.has(app)) mark(app, false);
    if (error) { setErrors((e) => ({ ...e, [app]: errorText(error.message) })); return; }
    const r = toPlanRow(data);
    if (r) setPlan((m) => new Map(m).set(app, r));
    // keep the on-screen copy if something newer was typed meanwhile
    setEdits((e) => { if (!e[app] || !sameCells(e[app], sent)) return e; const n = { ...e }; delete n[app]; return n; });
    replanSoon();   // one row's change can make or clear a clash on another
  }, [supabase, replanSoon]);

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

  const interviewers = useMemo(() => team.filter((t) => t.roles.includes("interviewer"))
    .sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "")), [team]);

  return { plan, cells, setCell, undo, waiting, errors, loadErr, replan, interviewers };
}

const who = (t: TeamMember) => t.name ?? t.email ?? "Interviewer";

/** Interviewer dropdown of one row. */
export function PlanInterviewer({ app, name, planner }: { app: string; name: string; planner: Planner }) {
  const row = planner.plan.get(app);
  const v = planner.cells(app);
  const known = planner.interviewers.some((t) => t.user_id === v.interviewer_id);
  return (
    <select className={cx(cell, "w-44")} value={v.interviewer_id} disabled={!isEditable(row)} aria-label={`Interviewer for ${name}`}
      onChange={(e) => planner.setCell(app, { interviewer_id: e.target.value })}>
      <option value="">—</option>
      {v.interviewer_id && !known && <option value={v.interviewer_id}>Inactive interviewer</option>}
      {planner.interviewers.map((t) => <option key={t.user_id} value={t.user_id}>{who(t)}{t.campus ? ` (${t.campus})` : ""}</option>)}
    </select>
  );
}

/** Date (IST) of one row. */
export function PlanDate({ app, name, planner }: { app: string; name: string; planner: Planner }) {
  const v = planner.cells(app);
  return (
    <input type="date" className={cx(cell, "w-[9.5rem]")} value={v.date} disabled={!isEditable(planner.plan.get(app))}
      aria-label={`Interview date for ${name} (IST)`} onChange={(e) => planner.setCell(app, { date: e.target.value })} />
  );
}

/** Time (IST) of one row, 5-minute steps. */
export function PlanTime({ app, name, planner }: { app: string; name: string; planner: Planner }) {
  const v = planner.cells(app);
  return (
    <input type="time" step={300} className={cx(cell, "w-[7.5rem]")} value={v.time} disabled={!isEditable(planner.plan.get(app))}
      aria-label={`Interview time for ${name} (IST)`} onChange={(e) => planner.setCell(app, { time: e.target.value })} />
  );
}

/** What will happen to the row: not sent / booked / a problem in words, and Undo for typed changes. */
export function PlanStatus({ app, planner }: { app: string; planner: Planner }) {
  const row = planner.plan.get(app);
  const err = planner.errors[app];
  const v = planner.cells(app);
  if (err) return <span className={cx(vx.badge, vx.tone.red)} role="status">{err}</span>;
  if (planner.waiting.has(app)) return <span className="text-xs text-vx-faint">Saving…</span>;
  // half typed (a date without a time): only on this screen until the time is picked
  if (draftPayload(app, v) === "partial") return <span className={cx(vx.badge, vx.tone.orange)}>Pick the {v.date ? "time" : "date"}</span>;
  const s = statusOf(row);
  const canUndo = !!row?.draft && isEditable(row);
  if (s.tone === "neutral" && !canUndo) return <span className="text-vx-faint">{s.label}</span>;
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
  const blocked = blockedText(sum);
  const idsKey = ids.join("\n");
  useEffect(() => { setConfirming(false); }, [idsKey]);   // a different selection needs a fresh confirm

  async function send() {
    setBusy("send"); setMsg(null);
    const { data, error } = await supabase.rpc("vsat_interview_drafts_send", { p: { application_ids: toSend } });
    setConfirming(false);
    if (error) { setBusy(""); setMsg({ text: errorText(error.message), ok: false }); return; }
    const r = data as SendResult;
    onSent({ text: sendResultText(r), ok: r.skipped.length === 0 && r.sent.length > 0 });
    // Google Meet + emails for the booked ones now (the cron does it anyway)
    const booked = r.sent.filter((s) => s.kind).map((s) => s.application_id);
    onDone();   // the rows show "Booked" right away
    if (booked.length) { await syncInterviewsNow(booked); onDone(); }   // then the Meet state
    setBusy("");
  }

  async function fill() {
    const start = istSlot(fillDate, fillTime);
    if (!fillWho) return setMsg({ text: "Pick the interviewer to fill with.", ok: false });
    if (!start) return setMsg({ text: "Pick the start date and time.", ok: false });
    if (Date.parse(start) < Date.now()) return setMsg({ text: "Pick a start time in the future.", ok: false });
    if (ids.length > SEND_MAX) return setMsg({ text: `Select at most ${SEND_MAX} students to fill.`, ok: false });
    setBusy("fill"); setMsg(null);
    const { data, error } = await supabase.rpc("vsat_interview_drafts_fill", { p: { application_ids: ids, interviewer_id: fillWho, start } });
    setBusy("");
    if (error) return setMsg({ text: errorText(error.message), ok: false });
    const r = data as FillResult;
    setMsg({ text: fillResultText(r), ok: r.skipped.length === 0 && r.filled.length > 0 });
    void planner.replan();
  }

  return (
    <div className="space-y-2 border-b border-vx-violet/20 pb-2">
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-sm text-vx-ink">
              Book {toSend.length} interview{toSend.length === 1 ? "" : "s"}? Each one gets its own Google Meet and emails to the student and the interviewer.
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
          <select className={cell} value={fillWho} onChange={(e) => setFillWho(e.target.value)} aria-label="Interviewer to fill with">
            <option value="">Interviewer…</option>
            {planner.interviewers.map((t) => <option key={t.user_id} value={t.user_id}>{who(t)}{t.campus ? ` (${t.campus})` : ""}</option>)}
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
