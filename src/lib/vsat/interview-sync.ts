/**
 * VSAT interviews and counselling sessions · server jobs (service role). Server-only.
 * Every job takes a Track (src/lib/vsat/tracks.ts): the interview (0140) or counselling (0145); same rules.
 *
 *   syncInterviews            make / move / remove the Google Calendar event (with its Meet link; counselling since
 *                             0184: no Meet, the counsellor's Zoom link is on the event)
 *   checkInterviewAttendance  after the slot, read Meet attendance → joined / no-show / "please mark"
 *   sendInterviewNotices      the invite / moved / cancelled emails through the VSAT comms steps
 *
 * Every write goes through a database function (migration 0140) that checks the work is still
 * current (claim token + version), so the cron and the "sync now" route can never undo a newer
 * change, and nothing on Google is ever lost track of. Google and email failures never block the
 * staff: the row keeps its state, the cron retries (5 tries for Google), and the drawer shows it.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createGoogleAccount, GoogleError, type CalEvent, type GoogleAccount } from "@/lib/google/account";
import { decideAttendance, type Participant } from "@/lib/peerpath/attendance";
import { deliverEmail } from "@/lib/email/deliver";
import { MEETING_STEP_KEYS, TRACKS, withHost, type Track } from "./tracks";
import {
  attendanceOutcome, eventText, fillTemplate, interviewEventId, isMeetUrl, joinUrl, noticeVars, planNotices,
  type NoticeJob, type NoticeStep,
} from "./interviews";

if (typeof window !== "undefined") throw new Error("vsat/interview-sync is server-only");

/** The admissions Google account (ADMISSIONS_* env). Separate from PeerPath's account. */
export const admissionsGoogle = createGoogleAccount("ADMISSIONS");

export function serviceDb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://one.vedam.org").replace(/\/$/, "");

const MAX_TRIES = 5; // same as the database (meet_attempts < 5)
const errText = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 300);

// ── Google Calendar / Meet ───────────────────────────────────────────────────

type Person = { id?: string; name: string | null; email: string | null };
export type SyncRow = {
  id: string;
  version: number;
  claimed_at: string;
  attempts: number;
  application_id: string;
  slot_start: string | null;
  duration_min: number;
  /** "zoom" (counselling, 0184): the event carries the counsellor's Zoom link and no Google Meet */
  meet_mode: "auto" | "manual" | "zoom";
  /** counselling on Zoom only: the counsellor's link (0184) */
  zoom_link?: string | null;
  cancelled: boolean;
  calendar_event_id: string | null;
  event_gen: number;
  event_version: number | null;
  student: Person & { application_no: string | null };
  interviewer: (Person & { id: string }) | null;
};

export type SyncResult = {
  outcome: "ok" | "pending" | "failed" | "none";
  final?: boolean;
  error?: string;
  calendar_event_id?: string;
  meet_link?: string;
  meet_code?: string;
  event_gen?: number;
  deleted_event_id?: string;
};

/** The event as it is on Google, or null if it is gone (deleted there, or never existed). */
async function liveEvent(g: GoogleAccount, id: string): Promise<CalEvent | null> {
  try {
    const ev = await g.getEvent(id);
    return ev.status === "cancelled" ? null : ev;
  } catch (err) {
    if (err instanceof GoogleError && (err.status === 404 || err.status === 410)) return null;
    throw err;
  }
}

function linkResult(ev: CalEvent, id: string): SyncResult {
  const link = isMeetUrl(ev.hangoutLink) ? ev.hangoutLink : undefined;
  const code = ev.conferenceData?.conferenceId && /^[a-z0-9-]{3,40}$/.test(ev.conferenceData.conferenceId) ? ev.conferenceData.conferenceId : undefined;
  // no link yet = Google is still making the Meet → read it again on the next run
  return { outcome: link ? "ok" : "pending", calendar_event_id: id, meet_link: link, meet_code: code };
}

/** A Zoom booking's event is done once it exists: there is no Meet link to wait for (0184). */
const zoomResult = (id: string): SyncResult => ({ outcome: "ok", calendar_event_id: id });

/** Decide and do the Google work for one claimed interview. Never throws. */
export async function syncOne(g: GoogleAccount, row: SyncRow, now = Date.now(), track: Track = TRACKS.interview): Promise<SyncResult> {
  const zoom = row.meet_mode === "zoom" ? joinUrl(row.zoom_link) : null;
  const wantEvent = !row.cancelled && !!row.slot_start && !!row.interviewer && (row.meet_mode === "auto" || !!zoom);
  try {
    if (!wantEvent) {
      // cancelled (or an old booking with a pasted link: Google Meet only since 0167) → the Google event (if any) goes
      if (!row.calendar_event_id) return { outcome: "none" };
      await g.deleteEvent(row.calendar_event_id);
      return { outcome: "none", deleted_event_id: row.calendar_event_id };
    }
    const start = row.slot_start!;
    const end = new Date(Date.parse(start) + row.duration_min * 60_000).toISOString();
    if (Date.parse(end) < now) return { outcome: "failed", final: true, error: "time_passed" };
    const emails = [row.student.email, row.interviewer!.email].map((e) => (e ?? "").trim().toLowerCase());
    if (emails.some((e) => !e)) return { outcome: "failed", final: true, error: "missing_email" };
    // staging: only listed test emails may get an invite (ADMISSIONS_INVITE_MODE=live on production only)
    if (!g.invitesAllowed(emails)) {
      return { outcome: "failed", final: true, error: "test_mode: an attendee is not on ADMISSIONS_TEST_EMAILS, no invite sent" };
    }
    const { summary, description } = eventText(
      { studentName: row.student.name, applicationNo: row.student.application_no, site: siteUrl(), zoomLink: zoom }, track);
    // 0184: a Zoom booking gets the link as the event's place and no Google Meet
    const want = zoom ? { summary, description, start, end, attendees: emails, location: zoom } : { summary, description, start, end, attendees: emails };

    let gone: string | undefined;
    if (row.calendar_event_id) {
      const ev = await liveEvent(g, row.calendar_event_id);
      if (ev && zoom && ev.hangoutLink) {
        // a Google Meet event from before 0184 (the booking moved to Zoom): a Meet can't be taken off an event, so the
        // event goes and a new one (no Meet, the Zoom link) is made under the next id
        await g.deleteEvent(row.calendar_event_id);
        gone = row.calendar_event_id;
      } else if (ev) {
        // already in step with this version → only the Meet link was missing; otherwise move / re-guest it
        const out = row.event_version === row.version ? ev : await g.patchEvent(row.calendar_event_id, want);
        return zoom ? zoomResult(row.calendar_event_id) : linkResult(out, row.calendar_event_id);
      } else {
        gone = row.calendar_event_id; // deleted on Google's side → make a new one under the next id
      }
    }
    let gen = row.event_gen + (gone ? 1 : 0);
    for (let i = 0; i < 4; i++, gen++) {
      try {
        const ev = await g.createEvent({ id: interviewEventId(row.id, gen, track.eventPrefix), ...want, ...(zoom ? { meet: false } : {}) });
        return { ...(zoom ? zoomResult(ev.id) : linkResult(ev, ev.id)), event_gen: gen, deleted_event_id: gone };
      } catch (err) {
        // that id belongs to an event deleted earlier → try the next generation
        if (!(err instanceof GoogleError && err.status === 409)) throw err;
      }
    }
    return { outcome: "failed", final: true, error: "event ids used up" };
  } catch (err) {
    return { outcome: "failed", final: row.attempts >= MAX_TRIES, error: errText(err) };
  }
}

const compact = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * Claim Google work and do it. `ids` limits it to some students (the "sync now" route after a save).
 * Stops claiming after `deadline` (a claim not finished is taken over by the cron after 3 minutes).
 */
export async function syncInterviews(
  db: SupabaseClient,
  opts: { ids?: string[]; limit?: number; deadline?: number } = {},
  g: GoogleAccount = admissionsGoogle,
  track: Track = TRACKS.interview,
): Promise<{ claimed: number; ok: number; failed: number; skipped?: string }> {
  const out = { claimed: 0, ok: 0, failed: 0 };
  if (!g.configured()) return { ...out, skipped: "google_not_configured" };
  const p: Record<string, unknown> = { limit: opts.limit ?? 20 };
  if (opts.ids) p.application_ids = opts.ids;
  const { data, error } = await db.rpc(track.rpc.syncClaim, { p });
  if (error) throw new Error(`sync_claim: ${error.message}`);
  const rows = (Array.isArray(data) ? data : []).map((x) => withHost(x as Record<string, unknown>, track)) as unknown as SyncRow[];
  out.claimed = rows.length;
  for (const row of rows) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const r = await syncOne(g, row, Date.now(), track);
    const { error: e2 } = await db.rpc(track.rpc.syncRelease, {
      p: compact({ id: row.id, version: row.version, claimed_at: row.claimed_at, ...r }),
    });
    if (e2 || r.outcome === "failed") out.failed++;
    else out.ok++;
  }
  return out;
}

// ── attendance from Meet ─────────────────────────────────────────────────────

type DueRow = { id: string; version: number; application_id: string; slot_datetime: string; duration_min: number; meet_code: string; attendance_check_attempts: number };

const MAX_CHECKS = 12;          // same as the database
const NO_RECORD_WAIT_MS = 2 * 3_600_000;

/** After each Google interview: read Meet and save joined / no-show / "please mark". */
export async function checkInterviewAttendance(
  db: SupabaseClient,
  limit = 20,
  g: GoogleAccount = admissionsGoogle,
  now = Date.now(),
  track: Track = TRACKS.interview,
): Promise<{ checked: number; done: number; no_show: number; marking: number; retry: number; skipped?: string }> {
  const out = { checked: 0, done: 0, no_show: 0, marking: 0, retry: 0 };
  if (!g.configured()) return { ...out, skipped: "google_not_configured" };
  const { data, error } = await db.rpc(track.rpc.attendanceDue, { p_limit: limit });
  if (error) throw new Error(`attendance_due: ${error.message}`);
  const apply = (row: DueRow, result: string, detail?: Record<string, unknown>) =>
    db.rpc(track.rpc.attendanceApply, { p: compact({ id: row.id, version: row.version, result, detail }) });

  for (const row of (Array.isArray(data) ? data : []) as DueRow[]) {
    out.checked++;
    const start = Date.parse(row.slot_datetime);
    const end = start + row.duration_min * 60_000;
    const lastTry = row.attendance_check_attempts + 1 >= MAX_CHECKS || now - end > 24 * 3_600_000;
    try {
      const records = await g.conferenceRecords(row.meet_code, new Date(start - 30 * 60_000), new Date(end + 60 * 60_000));
      const stillOn = records.some((r) => !r.endTime);
      const tooEarly = !records.length && now - end < NO_RECORD_WAIT_MS;
      if ((stillOn || tooEarly) && !lastTry) {
        await apply(row, "retry"); // the call is still going, or Meet hasn't published the record yet
        out.retry++;
        continue;
      }
      if (stillOn) {
        await apply(row, "needs_marking", { reason: "check_failed", records: records.length });
        out.marking++;
        continue;
      }
      const participants: Participant[] = [];
      for (const r of records) participants.push(...(await g.attendees(r, now)));
      const v = decideAttendance({ bookings: 1, window: { start, end }, participants, hasRecord: records.length > 0 });
      const result = attendanceOutcome(v);
      await apply(row, result, {
        people: v.people, overlap_min: v.overlapMin, records: records.length,
        reason: v.result === "needs_marking" ? v.reason : undefined,
      });
      if (result === "done") out.done++;
      else if (result === "no_show") out.no_show++;
      else out.marking++;
    } catch {
      if (lastTry) {
        await apply(row, "needs_marking", { reason: "check_failed", records: 0 }).then(() => undefined, () => undefined);
        out.marking++;
      } else {
        await apply(row, "retry").then(() => undefined, () => undefined);
        out.retry++;
      }
    }
  }
  return out;
}

// ── emails (VSAT comms steps) ────────────────────────────────────────────────

type StepCfg = { step_key: string; title: string; enabled: boolean; test_mode: boolean; email_enabled: boolean; email_subject: string; email_body: string };
export type NoticeConfig = { master: boolean; testEmail: string; steps: Map<string, StepCfg> };

const STEP_KEYS = MEETING_STEP_KEYS as NoticeStep[];   // both tracks (interview + counselling)

export async function loadNoticeConfig(db: SupabaseClient): Promise<NoticeConfig> {
  const [{ data: steps }, { data: settings }] = await Promise.all([
    db.from("vsat_comm_steps").select("step_key, title, enabled, test_mode, email_enabled, email_subject, email_body").in("step_key", STEP_KEYS),
    db.from("vsat_comm_settings").select("master, test_email").eq("id", true).maybeSingle(),
  ]);
  const s = settings as { master?: boolean; test_email?: string } | null;
  return {
    master: !!s?.master,
    testEmail: (s?.test_email ?? "").trim(),
    steps: new Map(((steps ?? []) as StepCfg[]).map((x) => [x.step_key, x])),
  };
}

type Deliver = typeof deliverEmail;

/**
 * Claim email jobs and send them. Each job = one schedule / move / cancel; planNotices() decides who
 * gets what. A step that is off (or the comms master switch) sends nothing; test mode sends to the
 * comms test address instead. Partly failed jobs remember who already got their email.
 */
export async function sendInterviewNotices(
  db: SupabaseClient,
  opts: { ids?: string[]; limit?: number; waitForMeet?: boolean } = {},
  deps: { deliver?: Deliver; config?: NoticeConfig } = {},
  track: Track = TRACKS.interview,
): Promise<{ jobs: number; sent: number; failed: number; off: number }> {
  const out = { jobs: 0, sent: 0, failed: 0, off: 0 };
  const p: Record<string, unknown> = { limit: opts.limit ?? 20, wait_for_meet: opts.waitForMeet ?? admissionsGoogle.configured() };
  if (opts.ids) p.application_ids = opts.ids;
  const { data, error } = await db.rpc(track.rpc.noticesClaim, { p });
  if (error) throw new Error(`notices_claim: ${error.message}`);
  const jobs = (Array.isArray(data) ? data : []).map((x) => withHost(x as Record<string, unknown>, track)) as unknown as NoticeJob[];
  if (!jobs.length) return out;
  const cfg = deps.config ?? (await loadNoticeConfig(db));
  const deliver = deps.deliver ?? deliverEmail;
  const site = siteUrl();

  for (const job of jobs) {
    out.jobs++;
    const sentTo = [...(job.sent_to ?? [])];
    let failed = false;
    let sentNow = 0;
    for (const n of planNotices(job, track)) {
      const step = cfg.steps.get(n.step);
      if (!cfg.master || !step || !step.enabled || !step.email_enabled) { out.off++; continue; }
      const to = step.test_mode ? cfg.testEmail : n.to;
      if (!to) { out.off++; continue; }
      const vars = noticeVars(n, job, site);
      try {
        const r = await deliver({
          to,
          subject: fillTemplate(step.email_subject, vars, "text"),
          html: fillTemplate(step.email_body, vars, "html"),
          kind: `vsat_${n.step}`,
          userId: !step.test_mode && n.isStudent ? job.student.lead_id : null,
          refId: job.id,
          refName: step.title,
        });
        if (r.ok) { sentTo.push(n.key); sentNow++; out.sent++; }
        else { failed = true; out.failed++; }
      } catch {
        failed = true;
        out.failed++;
      }
    }
    const status = failed ? "failed" : sentTo.length > 0 ? "sent" : "skipped";
    await db.rpc(track.rpc.noticeDone, { p: { id: job.id, status, detail: { sent_to: sentTo, sent_now: sentNow } } });
  }
  return out;
}
