/**
 * One Google organizer account → Calendar events with a Meet link, and Meet attendance.
 * Server-only. Same model as PeerPath (src/lib/peerpath/google.ts, left unchanged): ONE
 * account's OAuth refresh token, no service account, no domain-wide delegation. If the
 * token leaks, only that account's own calendar and its own Meet records are exposed.
 *
 * Scopes the token needs (and nothing else):
 *   https://www.googleapis.com/auth/calendar.events          create / move / delete its own events
 *   https://www.googleapis.com/auth/meetings.space.readonly  read attendance of its own meetings
 *
 * Env for prefix P (Vercel, server only — never NEXT_PUBLIC; set per environment):
 *   P_GOOGLE_CLIENT_ID, P_GOOGLE_CLIENT_SECRET, P_GOOGLE_REFRESH_TOKEN, P_ORGANIZER_EMAIL
 *   P_INVITE_MODE   "live" on production only; anything else = test mode
 *   P_TEST_EMAILS   test mode only: the ONLY emails that may be invited (comma separated)
 * Missing auth values → configured() is false and callers skip Google entirely.
 */
import { OAuth2Client } from "google-auth-library";

if (typeof window !== "undefined") throw new Error("google/account is server-only");

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const MEET = "https://meet.googleapis.com/v2";
const TZ = "Asia/Kolkata";

export class GoogleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GoogleError";
  }
}

export type CalEvent = {
  id: string;
  etag?: string;
  status?: string;
  hangoutLink?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { email: string; responseStatus?: string }[];
  conferenceData?: { conferenceId?: string };
};

export type EventInput = {
  /** deterministic (letters a–v and digits only), so a retry can't create a duplicate */
  id: string;
  summary: string;
  description: string;
  start: string; // ISO
  end: string; // ISO
  attendees: string[];
};

export type EventPatch = Partial<Omit<EventInput, "id">>;

export type ConferenceRecord = { name: string; startTime?: string; endTime?: string };
export type Attendee = { key: string; sessions: { start: number; end: number }[] };

type MeetParticipant = {
  name: string;
  earliestStartTime?: string;
  latestEndTime?: string;
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
};
type MeetSession = { startTime?: string; endTime?: string };

export type GoogleAccount = ReturnType<typeof createGoogleAccount>;

type Deps = {
  /** for tests: replaces the network */
  fetch?: typeof fetch;
  /** for tests: replaces the OAuth refresh */
  accessToken?: () => Promise<string>;
};

/** Calendar event ids allow only a–v and 0–9 (5–1024 chars). */
export const isEventId = (id: string) => /^[a-v0-9]{5,1024}$/.test(id);

const lowerSet = (list: string[]) => [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))];

export function createGoogleAccount(prefix: string, deps: Deps = {}) {
  const env = (k: string) => process.env[`${prefix}_${k}`] ?? "";
  const doFetch = deps.fetch ?? fetch;

  const configured = () =>
    !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET") && env("GOOGLE_REFRESH_TOKEN") && env("ORGANIZER_EMAIL"));

  /** Live only when explicitly switched on. Unset / anything else = test mode. */
  const inviteModeLive = () => env("INVITE_MODE") === "live";

  /** Live: anyone. Test mode: only if EVERY address is on P_TEST_EMAILS (an empty list allows nobody). */
  function invitesAllowed(emails: string[]): boolean {
    if (inviteModeLive()) return true;
    const ok = new Set(lowerSet(env("TEST_EMAILS").split(",")));
    const list = lowerSet(emails);
    return list.length > 0 && list.every((e) => ok.has(e));
  }

  let cached: { token: string; exp: number } | null = null;
  async function token(): Promise<string> {
    if (deps.accessToken) return deps.accessToken();
    if (cached && cached.exp - Date.now() > 120_000) return cached.token;
    const oauth = new OAuth2Client(env("GOOGLE_CLIENT_ID"), env("GOOGLE_CLIENT_SECRET"));
    oauth.setCredentials({ refresh_token: env("GOOGLE_REFRESH_TOKEN") });
    const { token: t, res } = await oauth.getAccessToken();
    if (!t) throw new GoogleError(0, "no access token");
    const exp = (res?.data as { expiry_date?: number } | undefined)?.expiry_date ?? Date.now() + 3_000_000;
    cached = { token: t, exp };
    return t;
  }

  async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await doFetch(url, {
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

  const eventUrl = (id: string, q = "") => `${CAL}/${encodeURIComponent(id)}${q}`;

  function eventBody(e: EventPatch): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (e.summary !== undefined) body.summary = e.summary;
    if (e.description !== undefined) body.description = e.description;
    if (e.start) body.start = { dateTime: e.start, timeZone: TZ };
    if (e.end) body.end = { dateTime: e.end, timeZone: TZ };
    if (e.attendees) body.attendees = lowerSet(e.attendees).map((email) => ({ email }));
    return body;
  }

  const getEvent = (id: string) => call<CalEvent>(eventUrl(id));

  async function insertEvent(e: EventInput): Promise<CalEvent> {
    const body = {
      id: e.id,
      ...eventBody(e),
      // guests don't see each other's email; they can't add people or edit the event
      guestsCanSeeOtherGuests: false,
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      conferenceData: { createRequest: { requestId: e.id, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    };
    return call<CalEvent>(`${CAL}?conferenceDataVersion=1&sendUpdates=all`, { method: "POST", body: JSON.stringify(body) });
  }

  /**
   * Create the event under `e.id`. If that id already exists and is live (an earlier try
   * that timed out after Google saved it) → return it. A cancelled event keeps its id, so
   * the caller must use a new id after deleting one (see the generation in the caller).
   */
  async function createEvent(e: EventInput): Promise<CalEvent> {
    if (!isEventId(e.id)) throw new GoogleError(0, "bad event id");
    try {
      return await insertEvent(e);
    } catch (err) {
      if (!(err instanceof GoogleError && err.status === 409)) throw err;
      const existing = await getEvent(e.id);
      if (existing.status === "cancelled") throw new GoogleError(409, "event id belongs to a deleted event");
      return existing;
    }
  }

  /** Move / rename / re-guest an event in one call. Keeps its Meet link. */
  function patchEvent(id: string, patch: EventPatch): Promise<CalEvent> {
    return call<CalEvent>(eventUrl(id, "?conferenceDataVersion=1&sendUpdates=all"), { method: "PATCH", body: JSON.stringify(eventBody(patch)) });
  }

  async function deleteEvent(id: string): Promise<void> {
    try {
      await call<void>(eventUrl(id, "?sendUpdates=all"), { method: "DELETE" });
    } catch (err) {
      if (err instanceof GoogleError && (err.status === 404 || err.status === 410)) return; // already gone
      throw err;
    }
  }

  async function pages<T>(url: string, key: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined;
    for (let i = 0; i < 10; i++) {
      const u = new URL(url);
      u.searchParams.set("pageSize", "100");
      if (next) u.searchParams.set("pageToken", next);
      const r = await call<Record<string, unknown>>(u.toString());
      out.push(...((r?.[key] as T[]) ?? []));
      next = r?.nextPageToken as string | undefined;
      if (!next) break;
    }
    return out;
  }

  /** Conference records for a meeting code that started inside [from, to]. */
  function conferenceRecords(meetCode: string, from: Date, to: Date): Promise<ConferenceRecord[]> {
    if (!/^[a-z0-9-]{3,40}$/i.test(meetCode)) return Promise.reject(new GoogleError(0, "bad meeting code"));
    const filter = `space.meeting_code = "${meetCode}" AND start_time>="${from.toISOString()}" AND start_time<="${to.toISOString()}"`;
    return pages<ConferenceRecord>(`${MEET}/conferenceRecords?filter=${encodeURIComponent(filter)}`, "conferenceRecords");
  }

  /**
   * Everyone who joined a conference record, with each join / leave. Someone still in the
   * call counts until `now`. The key is the signed-in user id or, for guests, the display
   * name — enough to merge rejoins; it is never stored.
   */
  async function attendees(record: ConferenceRecord, now = Date.now()): Promise<Attendee[]> {
    const people = await pages<MeetParticipant>(`${MEET}/${record.name}/participants`, "participants");
    const out: Attendee[] = [];
    for (const p of people) {
      const key =
        p.signedinUser?.user ??
        `guest:${(p.anonymousUser?.displayName ?? p.phoneUser?.displayName ?? p.signedinUser?.displayName ?? p.name).toLowerCase()}`;
      let sessions: { start: number; end: number }[] = [];
      try {
        const ss = await pages<MeetSession>(`${MEET}/${p.name}/participantSessions`, "participantSessions");
        sessions = ss.filter((s) => s.startTime).map((s) => ({ start: Date.parse(s.startTime!), end: s.endTime ? Date.parse(s.endTime) : now }));
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

  return {
    configured,
    inviteModeLive,
    invitesAllowed,
    organizerEmail: () => env("ORGANIZER_EMAIL").toLowerCase(),
    createEvent,
    getEvent,
    patchEvent,
    deleteEvent,
    conferenceRecords,
    attendees,
  };
}
