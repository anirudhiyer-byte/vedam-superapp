/**
 * VSAT interviews (Phase 2, migration 0140) · pure rules shared by the panels, the student
 * dashboard and the server jobs. No I/O here, so all of it is unit-tested.
 *
 * Times are shown in IST. The database decides who may do what; these helpers only
 * shape what the screens show and what the emails say.
 */

import { istSlot } from "./pipeline";

export const DEFAULT_DURATION_MIN = 30;
export const DURATION_CHOICES = [15, 20, 30, 45, 60] as const;
/** The student's Join button (and the link) opens this many minutes before the start. Same rule as vsat_my_interview(). */
export const JOIN_OPENS_MIN = 10;

const TZ = "Asia/Kolkata";

/** A list of application ids from a request: non-empty strings up to 64 characters, de-duplicated, 1..max. */
export function parseIdList(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  const out = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string" || x.length < 1 || x.length > 64) return null;
    out.add(x);
  }
  return [...out];
}

// ── formatting ───────────────────────────────────────────────────────────────

/** "Tue, 25 Nov 2026" in IST. */
export function istDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // built from parts: ICU versions differ in punctuation ("25 Nov, 2026" vs "25 Nov 2026"), and the
  // same text goes into emails (server) and the dashboard (browser)
  const parts = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: TZ })
    .formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? "";
  return `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")}`;
}

/** "11:00 am" in IST. */
export function istTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });
}

/** "11:00 am – 11:30 am IST". */
export function istTimeRange(startIso: string | null | undefined, durationMin: number | null | undefined): string {
  if (!startIso) return "—";
  const end = new Date(Date.parse(startIso) + (durationMin ?? DEFAULT_DURATION_MIN) * 60_000).toISOString();
  return `${istTime(startIso)} – ${istTime(end)} IST`;
}

/** Date + time inputs (IST) → ISO with +05:30, or null. One rule for every slot form (pipeline.istSlot). */
export const istSlotIso = istSlot;

/** ISO → { date: "2026-11-25", time: "11:00" } in IST, for prefilling the inputs. */
export function istParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(Date.parse(iso) + 330 * 60_000); // IST has no daylight saving
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` };
}

// ── Google Meet state (the grid's interview_meet value and the drawer) ───────

export type MeetState = "ready" | "creating" | "failed" | "own_link" | "cancelled";
export const MEET_LABEL: Record<MeetState, string> = {
  ready: "Meet ready",
  creating: "Creating Meet…",
  failed: "Meet failed",
  own_link: "Own link",
  cancelled: "Cancelled",
};
export const isMeetState = (v: unknown): v is MeetState => typeof v === "string" && v in MEET_LABEL;

/** The interview row as vsat_student() returns it (only what the screens use). */
export type InterviewRow = {
  interviewer_id?: string | null;
  interviewer?: string | null;
  slot_datetime?: string | null;
  duration_min?: number | null;
  meet_link?: string | null;
  meet_mode?: "auto" | "manual" | null;
  meet_sync?: "none" | "pending" | "syncing" | "ok" | "failed" | null;
  meet_error?: string | null;
  meet_attempts?: number | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  attendance?: "scheduled" | "done" | "no_show" | "rescheduled" | null;
  attendance_source?: "auto" | "manual" | null;
  attendance_detail?: { result?: string; reason?: string | null; people?: number | null; overlap_min?: number | null } | null;
  submitted_at?: string | null;
  reschedule_count?: number | null;
};

/** Same rule as the grid's interview_meet. */
export function meetState(iv: InterviewRow | null | undefined): MeetState | null {
  if (!iv) return null;
  if (iv.cancelled_at) return "cancelled";
  if (iv.meet_mode === "manual") return "own_link";
  if (iv.meet_sync === "ok") return "ready";
  if (iv.meet_sync === "pending" || iv.meet_sync === "syncing") return "creating";
  if (iv.meet_sync === "failed") return "failed";
  return null;
}

/** Plain-English reason for a Google failure (the raw error stays in the database). */
export function meetErrorText(err: string | null | undefined): string {
  const e = String(err ?? "");
  if (e.startsWith("test_mode")) return "Staging test mode: one of the emails is not on the test list, so no invite was sent.";
  if (e.startsWith("missing_email")) return "The student or the interviewer has no email, so the invite could not be made.";
  if (e.startsWith("time_passed")) return "The interview time had already passed.";
  if (e) return "Google did not accept the request. Try again, or use your own link.";
  return "";
}

/** A live interview: not cancelled and has a time and an interviewer. */
export const isLive = (iv: InterviewRow | null | undefined): boolean => !!iv && !iv.cancelled_at && !!iv.slot_datetime && !!iv.interviewer_id;

// ── attendance from Meet ─────────────────────────────────────────────────────

export type MeetVerdict =
  | { result: "completed"; people: number; overlapMin: number }
  | { result: "needs_marking"; reason: "nobody_joined" | "one_joined" | "too_short" | "group_partial" | "no_record" | "check_failed"; people: number; overlapMin: number };

/**
 * Meet's verdict → what we save. Decided by the owner: not joined → no-show (admins can change it).
 * Nobody or only one person in the call = the student did not join. A very short call or no Meet
 * record = we can't tell → an admin marks it.
 */
export function attendanceOutcome(v: MeetVerdict): "done" | "no_show" | "needs_marking" {
  if (v.result === "completed") return "done";
  if (v.reason === "nobody_joined" || v.reason === "one_joined") return "no_show";
  return "needs_marking";
}

/** Drawer wording for the interview's attendance (enum vm_attendance). */
export const ATTENDANCE_LABEL: Record<string, string> = { scheduled: "Not marked yet", done: "Joined", no_show: "No-show", rescheduled: "Rescheduled" };

export const ATTENDANCE_HINT: Record<string, string> = {
  nobody_joined: "Google Meet shows nobody joined.",
  one_joined: "Google Meet shows only one person joined.",
  too_short: "Google Meet shows a very short call. Did the interview happen?",
  no_record: "We couldn't find this interview in Google Meet. Please mark it.",
  check_failed: "We couldn't read Google Meet for this interview. Please mark it.",
};

// ── Google event ─────────────────────────────────────────────────────────────

/** Calendar event ids allow only a–v and 0–9: "vi" + the row id without dashes + "g" + generation. */
export const interviewEventId = (assignmentId: string, gen: number): string =>
  `vi${assignmentId.replace(/-/g, "").toLowerCase()}g${Math.max(0, Math.floor(gen))}`;

/**
 * Invite text. Guests can't see each other, but both see the title: the student's own name and
 * application number are fine to show to the student, and help the interviewer find the right person.
 */
export function eventText(args: { studentName: string | null; applicationNo: string | null; site: string }) {
  const who = [args.studentName?.trim(), args.applicationNo ? `(${args.applicationNo})` : ""].filter(Boolean).join(" ");
  const summary = who ? `Vedam admissions interview: ${who}` : "Vedam admissions interview";
  const description = [
    "Your Vedam admissions interview on Google Meet.",
    "Join with the Google Meet link in this invite. Students can also join from their dashboard; the Join button opens 10 minutes before the start.",
    args.site ? `Dashboard: ${args.site}/apply/dashboard` : "",
    "Please join on time from a quiet place, with your camera and microphone working.",
  ].filter(Boolean).join("\n\n");
  return { summary, description };
}

// ── the student's Join button ────────────────────────────────────────────────

export type MyInterview = {
  state: "none" | "upcoming" | "open" | "ended" | "missed";
  now: string;
  start?: string;
  end?: string;
  opens_at?: string;
  duration_min?: number;
  has_link?: boolean;
  meet_link?: string | null;
};

/** What the student's interview card says: no campus yet, loading / couldn't load, or one of the join phases. */
export type CardPhase = MyInterview["state"] | "no_campus" | "loading" | "error";

/** "Before you join" on the student's card (shown as icon chips while the interview is booked or starting). */
export const JOIN_TIPS = ["Camera on", "Mic on", "Quiet place"] as const;

/**
 * The interview card's heading and message (copy approved 23 Nov 2026; no emoji — the card shows an icon per state).
 * `hasLink` matters only while open: no link yet → the "being ready" message. The campus is shown under the heading.
 */
export function interviewCardCopy(phase: CardPhase, opts: { opensAt?: string | null; hasLink?: boolean } = {}): { title: string; text: string } {
  switch (phase) {
    case "no_campus": return { title: "Choose your campus first", text: "Pick your campus below to book your interview." };
    case "none": return { title: "You're selected for the interview", text: "We'll book your interview soon and email you the time." };
    case "upcoming": return {
      title: "Your interview is booked",
      text: `The Join button opens ${opts.opensAt ? `at ${istTime(opts.opensAt)} IST, ` : ""}${JOIN_OPENS_MIN} minutes before your interview.`,
    };
    case "open": return {
      title: "Your interview is starting",
      text: opts.hasLink ? "" : "Your meeting link will be ready in a minute. You can also join from the link in your email.",
    };
    case "missed": return { title: "You missed your interview", text: "The admissions team will contact you to book a new time." };
    case "ended": return { title: "Your interview is done", text: "We'll email you the result." };
    case "error": return { title: "Your interview", text: "We couldn't load your interview time. Please try again in a moment." };
    default: return { title: "Your interview", text: "" };
  }
}

/** The date tile on the student's card, in IST: "Mon" · "23" · "Nov", and "Monday, 23 November". */
export function istDay(iso: string | null | undefined): { weekday: string; day: string; month: string; long: string } | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  const d = new Date(iso);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { ...o, timeZone: TZ }).format(d);
  return { weekday: f({ weekday: "short" }), day: f({ day: "numeric" }), month: f({ month: "short" }), long: `${f({ weekday: "long" })}, ${f({ day: "numeric" })} ${f({ month: "long" })}` };
}

/** Time left, rounded up to the minute: "3 days" · "1 day 4 h" · "2 h 15 min" · "45 min". */
export function timeLeftText(ms: number): string {
  if (!(ms > 0)) return "a moment";
  const min = Math.ceil(ms / 60_000);
  if (min >= 2 * 1440) return `${Math.floor(min / 1440)} days`;
  if (min >= 1440) { const h = Math.floor((min - 1440) / 60); return h ? `1 day ${h} h` : "1 day"; }
  if (min >= 60) { const h = Math.floor(min / 60); const m = min % 60; return m ? `${h} h ${m} min` : `${h} h`; }
  return `${min} min`;
}

/** The server's clock minus the browser's, so the button opens on the server's time, not a wrong phone clock. */
export const clockSkewMs = (serverNowIso: string, clientNow = Date.now()): number => Date.parse(serverNowIso) - clientNow;

/** Where the student is right now, by the server's clock (client time + skew). */
export function joinPhase(mi: MyInterview, clientNow: number, skewMs: number): MyInterview["state"] {
  if (mi.state === "none" || mi.state === "missed" || !mi.opens_at || !mi.end) return mi.state;
  const now = clientNow + skewMs;
  if (now < Date.parse(mi.opens_at)) return "upcoming";
  if (now < Date.parse(mi.end)) return "open";
  return "ended";
}

/** Milliseconds until the next change of phase (to re-check with the server then), or null. */
export function msToNextPhase(mi: MyInterview, clientNow: number, skewMs: number): number | null {
  if (!mi.opens_at || !mi.end) return null;
  const now = clientNow + skewMs;
  const next = [Date.parse(mi.opens_at), Date.parse(mi.end)].find((t) => t > now);
  return next === undefined ? null : next - now;
}

/** A Google Meet link as Google gives it (checked before saving what Google returned). */
export const isMeetUrl = (v: unknown): v is string => typeof v === "string" && /^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test(v);

/**
 * The link the student's Join button may open: Google Meet, or a staff member's own https link
 * (Zoom / Teams; the database only stores https links). Anything else → null, so no other scheme reaches an href.
 */
export function joinUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 300) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".") ? u.href : null;
  } catch {
    return null;
  }
}

// ── emails ───────────────────────────────────────────────────────────────────

export type NoticeStep =
  | "interview_invite" | "interview_rescheduled" | "interview_cancelled"
  | "interviewer_invite" | "interviewer_rescheduled" | "interviewer_cancelled";

type Person = { id?: string; name: string | null; email: string | null };

/** One email job as vsat_interview_notices_claim() returns it. */
export type NoticeJob = {
  id: string;
  kind: "scheduled" | "rescheduled" | "cancelled";
  version: number;
  attempts: number;
  sent_to: string[];
  slot_start: string | null;
  duration_min: number | null;
  prev_slot_start: string | null;
  prev_duration_min: number | null;
  interviewer: (Person & { id: string }) | null;
  baseline: { kind: string; slot_start: string | null; duration_min: number | null; interviewer: (Person & { id: string }) | null } | null;
  student: { name: string | null; email: string | null; application_no: string | null; lead_id: string | null };
  meet_link: string | null;
  meet_mode: "auto" | "manual" | null;
};

export type PlannedNotice = {
  /** recipient key, stored in sent_to so a retry never sends twice: "student" or "interviewer:<id>" */
  key: string;
  step: NoticeStep;
  to: string;
  name: string | null;
  isStudent: boolean;
  /** the time this email is about (new time; for a cancel, the old one) and the time before */
  slot: string | null;
  duration: number | null;
  oldSlot: string | null;
  oldDuration: number | null;
};

/**
 * Who gets which email for one job. `baseline` is what people were last emailed, so:
 *   nothing sent yet            → invites (a "moved" before any invite is just an invite)
 *   cancelled                   → cancel emails only to people who were told about the old time
 *   moved, same interviewer     → "moved" to both (if the time changed)
 *   moved to another interviewer→ the old one gets "cancelled", the new one an invite; the student "moved" if the time changed
 * Recipients already in sent_to (an earlier, partly failed try) are left out.
 */
export function planNotices(job: NoticeJob): PlannedNotice[] {
  const out: PlannedNotice[] = [];
  const base = job.baseline && job.baseline.kind !== "cancelled" ? job.baseline : null;
  const st = job.student;
  const add = (p: Omit<PlannedNotice, "to"> & { to: string | null }) => {
    const to = (p.to ?? "").trim();
    if (!to || job.sent_to.includes(p.key)) return;
    out.push({ ...p, to });
  };
  const studentEmail = { key: "student", to: st.email, name: st.name, isStudent: true } as const;

  if (job.kind === "cancelled") {
    if (!base) return out;
    add({ ...studentEmail, step: "interview_cancelled", slot: base.slot_start, duration: base.duration_min, oldSlot: base.slot_start, oldDuration: base.duration_min });
    if (base.interviewer) {
      add({ key: `interviewer:${base.interviewer.id}`, to: base.interviewer.email, name: base.interviewer.name, isStudent: false,
        step: "interviewer_cancelled", slot: base.slot_start, duration: base.duration_min, oldSlot: base.slot_start, oldDuration: base.duration_min });
    }
    return out;
  }

  const timeChanged = !base || base.slot_start !== job.slot_start || (base.duration_min ?? null) !== (job.duration_min ?? null);
  const cur = job.interviewer;
  if (!base) {
    add({ ...studentEmail, step: "interview_invite", slot: job.slot_start, duration: job.duration_min, oldSlot: null, oldDuration: null });
  } else if (timeChanged) {
    add({ ...studentEmail, step: "interview_rescheduled", slot: job.slot_start, duration: job.duration_min, oldSlot: base.slot_start, oldDuration: base.duration_min });
  }
  const prev = base?.interviewer ?? null;
  if (prev && cur && prev.id !== cur.id) {
    add({ key: `interviewer:${prev.id}`, to: prev.email, name: prev.name, isStudent: false,
      step: "interviewer_cancelled", slot: base!.slot_start, duration: base!.duration_min, oldSlot: base!.slot_start, oldDuration: base!.duration_min });
  }
  if (cur) {
    const same = !!prev && prev.id === cur.id;
    if (!same) {
      add({ key: `interviewer:${cur.id}`, to: cur.email, name: cur.name, isStudent: false,
        step: "interviewer_invite", slot: job.slot_start, duration: job.duration_min, oldSlot: null, oldDuration: null });
    } else if (timeChanged) {
      add({ key: `interviewer:${cur.id}`, to: cur.email, name: cur.name, isStudent: false,
        step: "interviewer_rescheduled", slot: job.slot_start, duration: job.duration_min, oldSlot: base!.slot_start, oldDuration: base!.duration_min });
    }
  }
  return out;
}

const firstName = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] || "there";

/** The placeholder values for one email (all plain text; HTML-escaped when filled into the body). */
export function noticeVars(n: PlannedNotice, job: NoticeJob, site: string): Record<string, string> {
  const dashboard = `${site}/apply/dashboard`;
  const panel = `${site}/admin/vsat`; // the Interview panel lives here (menu: VSAT → Interview)
  // Google Meet, or the https link staff pasted (the database accepts nothing else)
  const meet = joinUrl(job.meet_link) ?? ""; // same rule as the dashboard's Join button
  return {
    name: firstName(n.name),
    student_name: (job.student.name ?? "").trim() || "the student",
    interviewer_name: (job.interviewer?.name ?? "").trim(),
    application_no: job.student.application_no ?? "",
    date: istDate(n.slot),
    time: istTimeRange(n.slot, n.duration),
    old_date: istDate(n.oldSlot),
    old_time: istTimeRange(n.oldSlot, n.oldDuration),
    meet_link: meet,
    join_link: meet || (n.isStudent ? dashboard : panel),
    dashboard_link: dashboard,
    panel_link: panel,
  };
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** Fill {{placeholders}}. HTML mode escapes every value (names are typed by students). Unknown placeholders become empty. */
export function fillTemplate(tpl: string, vars: Record<string, string>, mode: "html" | "text"): string {
  return (tpl || "").replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k] ?? "";
    return mode === "html" ? escapeHtml(v) : v.replace(/[\r\n]+/g, " ");
  });
}
