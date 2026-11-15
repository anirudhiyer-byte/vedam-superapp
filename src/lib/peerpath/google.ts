/**
 * PeerPath · Google Calendar + Meet, server-only.
 *
 * Auth = ONE organizer account's OAuth refresh token (no service account, no
 * domain-wide delegation). If the token leaks, only that one account's calendar
 * and its own Meet records are exposed — not the rest of the domain.
 * Scopes granted to the token (and nothing else):
 *   calendar.events          create / move / cancel the organizer's own events
 *   meetings.space.readonly  read attendance of the organizer's own meetings
 *
 * Env (Vercel, server only — never NEXT_PUBLIC; set separately per environment):
 *   PEERPATH_GOOGLE_CLIENT_ID      OAuth client id (Cloud project vedam-peerpath)
 *   PEERPATH_GOOGLE_CLIENT_SECRET  OAuth client secret
 *   PEERPATH_GOOGLE_REFRESH_TOKEN  refresh token of the organizer account
 *   PEERPATH_ORGANIZER_EMAIL       that account's email (staging: a TEST organizer)
 *   PEERPATH_INVITE_MODE           "live" on production only; anything else = test mode
 *   PEERPATH_TEST_EMAILS           test mode only: the ONLY emails that may be invited
 * If the four auth values are missing, the feature is off and bookings keep the
 * senior's own link.
 */
import { createHash } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

if (typeof window !== "undefined") throw new Error("peerpath/google is server-only");

export const SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar.events";
export const SCOPE_MEET_READ = "https://www.googleapis.com/auth/meetings.space.readonly";

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const MEET = "https://meet.googleapis.com/v2";

export function googleConfigured(): boolean {
  return !!(
    process.env.PEERPATH_GOOGLE_CLIENT_ID &&
    process.env.PEERPATH_GOOGLE_CLIENT_SECRET &&
    process.env.PEERPATH_GOOGLE_REFRESH_TOKEN &&
    process.env.PEERPATH_ORGANIZER_EMAIL
  );
}

// ── test mode: staging must never invite real people ─────────────────────────

/** Live only when explicitly switched on. Unset / anything else = test mode. */
export const inviteModeLive = () => process.env.PEERPATH_INVITE_MODE === "live";

function testEmails(): Set<string> {
  return new Set(
    (process.env.PEERPATH_TEST_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * May we send an invite to all of these people? In live mode, yes. In test mode,
 * only if EVERY address is on PEERPATH_TEST_EMAILS (an empty list allows nobody).
 */
export function invitesAllowed(emails: string[]): boolean {
  if (inviteModeLive()) return true;
  const ok = testEmails();
  return emails.length > 0 && emails.every((e) => ok.has(e.trim().toLowerCase()));
}

// ── auth ─────────────────────────────────────────────────────────────────────

let cached: { token: string; exp: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.exp - Date.now() > 120_000) return cached.token;
  const oauth = new OAuth2Client(process.env.PEERPATH_GOOGLE_CLIENT_ID, process.env.PEERPATH_GOOGLE_CLIENT_SECRET);
  oauth.setCredentials({ refresh_token: process.env.PEERPATH_GOOGLE_REFRESH_TOKEN });
  const { token: t, res } = await oauth.getAccessToken();
  if (!t) throw new GoogleError(0, "no access token");
  const exp = (res?.data as { expiry_date?: number } | undefined)?.expiry_date ?? Date.now() + 3_000_000;
  cached = { token: t, exp };
  return t;
}

export class GoogleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** `_scope` documents which granted scope a call relies on; one token carries both. */
async function call<T>(_scope: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throw new GoogleError(res.status, `${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

// ── Calendar ─────────────────────────────────────────────────────────────────

export type CalEvent = {
  id: string;
  etag?: string;
  status?: string;
  hangoutLink?: string;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  conferenceData?: { conferenceId?: string; createRequest?: { status?: { statusCode?: string } } };
};

export type EventInput = {
  id: string; // deterministic, so a retry can't create a duplicate
  summary: string;
  description: string;
  start: string; // ISO
  end: string; // ISO
  attendees: { email: string }[];
};

/** Calendar event ids allow only a–v and 0–9; a uuid without dashes fits. */
export const eventIdFor = (bookingId: string) => `pp${bookingId.replace(/-/g, "").toLowerCase()}`;

/**
 * One id per group session (senior + start time), so two people booking the same
 * group slot at once land on the SAME event instead of splitting the group.
 */
export const groupEventIdFor = (seniorId: string, startIso: string) =>
  `ppg${createHash("sha256").update(`${seniorId}|${new Date(startIso).toISOString()}`).digest("hex").slice(0, 40)}`;

/**
 * Create the event under `e.id`. If that id already exists and is live (an earlier
 * try, or another booking of the same group got there first) → return it. If it
 * exists but was cancelled (deleted events keep their id) → use the next id.
 */
export async function createEvent(e: EventInput): Promise<CalEvent> {
  for (let gen = 0; gen < 5; gen++) {
    const id = gen === 0 ? e.id : `${e.id}v${gen}`;
    try {
      return await insertEvent({ ...e, id });
    } catch (err) {
      if (!(err instanceof GoogleError && err.status === 409)) throw err;
      const existing = await getEvent(id);
      if (existing.status !== "cancelled") return existing;
    }
  }
  throw new GoogleError(409, "event id taken by cancelled events");
}

async function insertEvent(e: EventInput): Promise<CalEvent> {
  const body = {
    id: e.id,
    summary: e.summary,
    description: e.description,
    start: { dateTime: e.start, timeZone: "Asia/Kolkata" },
    end: { dateTime: e.end, timeZone: "Asia/Kolkata" },
    attendees: e.attendees,
    // guests don't see each other's email; they can't add people or edit the event
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    conferenceData: { createRequest: { requestId: e.id, conferenceSolutionKey: { type: "hangoutsMeet" } } },
  };
  return call<CalEvent>(SCOPE_CALENDAR, `${CAL}?conferenceDataVersion=1&sendUpdates=all`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Change an event's guest list safely when several requests touch it at once:
 * read → change → write with If-Match, and start over if someone else wrote first.
 * `change` gets the current guest emails and returns the new list.
 */
export async function updateGuests(id: string, change: (emails: string[]) => string[]): Promise<CalEvent> {
  for (let i = 0; i < 4; i++) {
    const ev = await getEvent(id);
    const current = (ev.attendees ?? []).map((a) => a.email.toLowerCase());
    const next = [...new Set(change(current).map((x) => x.toLowerCase()))];
    const same = next.length === current.length && next.every((x) => current.includes(x));
    if (same) return ev;
    try {
      return await call<CalEvent>(SCOPE_CALENDAR, `${CAL}/${encodeURIComponent(id)}?conferenceDataVersion=1&sendUpdates=all`, {
        method: "PATCH",
        headers: ev.etag ? { "If-Match": ev.etag } : {},
        body: JSON.stringify({ attendees: next.map((email) => ({ email })) }),
      });
    } catch (err) {
      if (err instanceof GoogleError && err.status === 412) continue; // someone else changed it → retry
      throw err;
    }
  }
  throw new GoogleError(412, "guest list kept changing");
}

export const getEvent = (id: string) => call<CalEvent>(SCOPE_CALENDAR, `${CAL}/${encodeURIComponent(id)}`);

export function patchEvent(id: string, patch: Partial<Pick<EventInput, "start" | "end" | "summary" | "description">>) {
  const body: Record<string, unknown> = {};
  if (patch.start) body.start = { dateTime: patch.start, timeZone: "Asia/Kolkata" };
  if (patch.end) body.end = { dateTime: patch.end, timeZone: "Asia/Kolkata" };
  if (patch.summary) body.summary = patch.summary;
  if (patch.description) body.description = patch.description;
  return call<CalEvent>(SCOPE_CALENDAR, `${CAL}/${encodeURIComponent(id)}?conferenceDataVersion=1&sendUpdates=all`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteEvent(id: string): Promise<void> {
  try {
    await call<void>(SCOPE_CALENDAR, `${CAL}/${encodeURIComponent(id)}?sendUpdates=all`, { method: "DELETE" });
  } catch (err) {
    // already gone → fine
    if (err instanceof GoogleError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}

// ── Meet attendance ──────────────────────────────────────────────────────────

export type ConferenceRecord = { name: string; startTime?: string; endTime?: string };
type MeetParticipant = {
  name: string;
  earliestStartTime?: string;
  latestEndTime?: string;
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
};
type MeetSession = { name: string; startTime?: string; endTime?: string };

async function pages<T>(url: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined;
  for (let i = 0; i < 10; i++) {
    const u = new URL(url);
    u.searchParams.set("pageSize", "100");
    if (next) u.searchParams.set("pageToken", next);
    const r = await call<Record<string, unknown>>(SCOPE_MEET_READ, u.toString());
    out.push(...(((r?.[key] as T[]) ?? []) as T[]));
    next = r?.nextPageToken as string | undefined;
    if (!next) break;
  }
  return out;
}

/** Conference records for a meeting code that started inside [from, to]. */
export function conferenceRecords(meetCode: string, from: Date, to: Date): Promise<ConferenceRecord[]> {
  const filter = `space.meeting_code = "${meetCode}" AND start_time>="${from.toISOString()}" AND start_time<="${to.toISOString()}"`;
  return pages<ConferenceRecord>(`${MEET}/conferenceRecords?filter=${encodeURIComponent(filter)}`, "conferenceRecords");
}

export type Attendee = { key: string; sessions: { start: number; end: number }[] };

/**
 * Everyone who joined a conference record, with each join/leave. A person still
 * in the call (no end time) counts until `now`. The key is the signed-in user id
 * or, for guests, the display name — enough to merge rejoins, never stored.
 */
export async function attendees(record: ConferenceRecord, now = Date.now()): Promise<Attendee[]> {
  const people = await pages<MeetParticipant>(`${MEET}/${record.name}/participants`, "participants");
  const out: Attendee[] = [];
  for (const p of people) {
    const key =
      p.signedinUser?.user ??
      `guest:${(p.anonymousUser?.displayName ?? p.phoneUser?.displayName ?? p.signedinUser?.displayName ?? p.name).toLowerCase()}`;
    let sessions: { start: number; end: number }[] = [];
    try {
      const ss = await pages<MeetSession>(`${MEET}/${p.name}/participantSessions`, "participantSessions");
      sessions = ss
        .filter((s) => s.startTime)
        .map((s) => ({ start: Date.parse(s.startTime!), end: s.endTime ? Date.parse(s.endTime) : now }));
    } catch {
      /* fall back to the participant's first join / last leave */
    }
    if (!sessions.length && p.earliestStartTime) {
      sessions = [{ start: Date.parse(p.earliestStartTime), end: p.latestEndTime ? Date.parse(p.latestEndTime) : now }];
    }
    out.push({ key, sessions });
  }
  return out;
}
