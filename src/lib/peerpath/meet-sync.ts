/**
 * PeerPath · keeps each booking's Google Calendar event in step with the booking,
 * and turns Meet attendance into a result. Server-only (service role).
 *
 *   booked      → create event (senior + applicant invited, own Meet link)
 *   group seat  → everyone on the same group time shares ONE event (fixed id)
 *   rescheduled → move the old event to the new time (same senior, same link)
 *   cancelled   → remove the applicant, or delete the event if nobody is left
 *   chat ended  → read Meet attendance → completed, or "needs marking"
 *
 * Google never blocks a booking: if anything fails, the booking keeps the senior's
 * own Meet link and the cron tries again (up to MEET_RULES.maxSyncAttempts).
 *
 * Every run first CLAIMS the row (compare-and-set on meet_sync), so the browser-
 * triggered sync and the cron can never work on the same booking at once, and a
 * slow, stale run can't overwrite a newer result.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decideAttendance, type Participant } from "./attendance";
import { MEET_RULES, TTS } from "./constants";
import {
  attendees,
  conferenceRecords,
  createEvent,
  deleteEvent,
  eventIdFor,
  getEvent,
  googleConfigured,
  groupEventIdFor,
  invitesAllowed,
  patchEvent,
  updateGuests,
  type CalEvent,
} from "./google";

if (typeof window !== "undefined") throw new Error("peerpath/meet-sync is server-only");

type Sync = "none" | "syncing" | "pending" | "ok" | "failed" | "moved" | "removed" | "legacy";

type Row = {
  id: string;
  senior_id: string;
  start_at: string;
  end_at: string;
  type: "1:1" | "Group";
  applicant_email: string;
  status: string;
  moved_from: string | null;
  moved_to: string | null;
  calendar_event_id: string | null;
  meet_code: string | null;
  meet_sync: Sync;
  meet_claimed_at: string | null;
  meet_attempts: number;
  auto_check_attempts: number;
  created_at: string;
  updated_at: string;
  senior: { first_name: string; contact_email: string } | null;
};

const COLS =
  "id, senior_id, start_at, end_at, type, applicant_email, status, moved_from, moved_to, calendar_event_id, meet_code, meet_sync, meet_claimed_at, meet_attempts, auto_check_attempts, created_at, updated_at, senior:pp_seniors(first_name, contact_email)";

/** A claim older than this is treated as abandoned (the run crashed or timed out). */
const STALE_CLAIM_MS = 3 * 60_000;
/** Most invites one applicant email can get from us in 24h (stops invite spam to a stranger's inbox). */
const INVITES_PER_EMAIL_PER_DAY = 3;

/**
 * Service-role client. `clientIp` (from Vercel's trusted header) is passed to the
 * database as x-pp-client-ip; pp_request_ip() trusts it only on service-role calls.
 * The per-IP limits themselves run in the API routes (allowIp, trusted Vercel IP).
 * pp_book / pp_cancel are called AS THE USER, so the ip they log (pp_book_attempts
 * source='db') is not the visitor's IP; route-logged rows (source='route') are.
 */
export function adminDb(clientIp?: string | null): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    global: clientIp ? { headers: { "x-pp-client-ip": clientIp } } : undefined,
  });
}

/**
 * The visitor's IP as Vercel sees it. Vercel overwrites X-Forwarded-For and sets
 * x-vercel-forwarded-for itself, so neither can be faked by the browser.
 * (Supabase does NOT do this — a browser can prepend its own X-Forwarded-For there.)
 */
export function trustedIp(req: Request): string | null {
  const raw = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for");
  const ip = raw?.split(",")[0]?.trim();
  return ip || null;
}

/**
 * Per-IP limit checked on the server with the trusted IP, on PeerPath's private
 * limiter (pp_rate_hit: service role only, so nobody can fill up someone else's
 * bucket). Fails closed if the DB says no or errors.
 */
export async function allowIp(db: SupabaseClient, key: string, ip: string | null, max: number, windowSec: number): Promise<boolean> {
  if (!ip) return !process.env.VERCEL; // local dev only; on Vercel the header is always set, so a missing IP fails closed
  const { data, error } = await db.rpc("pp_rate_hit", { p_key: `${key}:ip:${ip}`, p_max: max, p_window: windowSec });
  if (error) return false;
  return data !== false;
}

export async function load(db: SupabaseClient, id: string): Promise<Row | null> {
  const { data, error } = await db.from("pp_bookings").select(COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(`load: ${error.message}`);
  return (data as unknown as Row) ?? null;
}

/** Is there (probably) a live Google event behind this row? */
const hasEvent = (b: Row) => !!b.calendar_event_id && !["moved", "removed", "legacy"].includes(b.meet_sync);

const site = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

/**
 * Event text is fixed: nothing the applicant typed (name, question) goes into an
 * invite, so the invite can't be used to send someone else a message.
 */
function eventText(b: Row) {
  const senior = b.senior?.first_name ?? "a Vedam senior";
  const summary = b.type === "Group" ? `PeerPath group chat with ${senior} (Vedam senior)` : `PeerPath chat with ${senior} (Vedam senior)`;
  const description = [
    "A free chat booked on Vedam PeerPath · Talk to a Senior.",
    "Join with the Google Meet link in this invite.",
    site() ? `Session guidelines: ${site()}${TTS}/guidelines` : "",
    "To change or cancel, use your PeerPath booking page (applicant) or your senior page (senior).",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { summary, description };
}

// ── claim / release ─────────────────────────────────────────────────────────

/** Take the row for this run. Returns false if someone else holds it or it changed. */
async function claim(db: SupabaseClient, b: Row): Promise<boolean> {
  let q = db
    .from("pp_bookings")
    .update({ meet_sync: "syncing", meet_claimed_at: new Date().toISOString(), meet_attempts: (b.meet_attempts ?? 0) + 1 })
    .eq("id", b.id)
    .eq("meet_sync", b.meet_sync)
    .eq("meet_attempts", b.meet_attempts ?? 0);
  if (b.meet_sync === "syncing") q = q.lt("meet_claimed_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString());
  const { data, error } = await q.select("id");
  if (error) throw new Error(`claim: ${error.message}`);
  return (data ?? []).length === 1;
}

/** Write the result, but only while this run still holds the claim. */
async function release(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("pp_bookings").update({ meet_claimed_at: null, ...patch }).eq("id", id).eq("meet_sync", "syncing");
  if (error) throw new Error(`release: ${error.message}`);
}

const errText = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 300);

function linkFields(ev: CalEvent) {
  const ok = !!ev.hangoutLink;
  return {
    calendar_event_id: ev.id,
    meet_url: ev.hangoutLink ?? null,
    meet_code: ev.conferenceData?.conferenceId ?? null,
    meet_sync: ok ? "ok" : "pending", // Meet link still being made → read it again next run
    meet_error: null,
    ...(ok ? { meet_attempts: 0 } : {}), // fresh budget for a later cancel/move
  };
}

/** Too many invites to this email in the last day? (counts every booking that got an event) */
async function overInviteCap(db: SupabaseClient, b: Row): Promise<boolean> {
  const { count, error } = await db
    .from("pp_bookings")
    .select("id", { count: "exact", head: true })
    .ilike("applicant_email", b.applicant_email)
    .not("calendar_event_id", "is", null)
    .gt("created_at", new Date(Date.now() - 86_400_000).toISOString())
    .neq("id", b.id);
  if (error) throw new Error(`cap: ${error.message}`);
  return (count ?? 0) >= INVITES_PER_EMAIL_PER_DAY;
}

// ── sync one booking ────────────────────────────────────────────────────────

/** Bring one booking's calendar event in line with the booking. Safe to call repeatedly, from anywhere. */
export async function syncBooking(db: SupabaseClient, id: string, depth = 0): Promise<void> {
  if (!googleConfigured() || depth > 2) return;
  const b = await load(db, id);
  if (!b || !b.senior || ["legacy", "moved", "removed"].includes(b.meet_sync)) return;
  if (b.meet_sync === "syncing" && b.meet_claimed_at && Date.now() - Date.parse(b.meet_claimed_at) < STALE_CLAIM_MS) return;
  if (b.meet_attempts >= MEET_RULES.maxSyncAttempts) return;

  // moved or cancelled: the old event has to go (a reschedule first lets the new booking take it over)
  if (b.status === "rescheduled" || b.status === "cancelled") {
    if (b.status === "rescheduled" && b.moved_to) await syncBooking(db, b.moved_to, depth + 1);
    const fresh = b.status === "rescheduled" ? await load(db, id) : b;
    if (fresh && hasEvent(fresh)) await removeBooking(db, fresh);
    else if (fresh && fresh.meet_sync !== "removed" && fresh.meet_sync !== "moved" && !fresh.calendar_event_id && ["none", "failed", "pending"].includes(fresh.meet_sync)) {
      // never got an event → nothing to remove; close it so the cron stops looking
      if (await claim(db, fresh)) await release(db, fresh.id, { meet_sync: "removed" });
    }
    return;
  }

  if (b.status !== "confirmed" || Date.parse(b.end_at) < Date.now() || b.meet_sync === "ok") return;
  if (!(await claim(db, b))) return;

  try {
    // event made earlier but the Meet link wasn't ready → read it again
    if (b.calendar_event_id) {
      const ev = await getEvent(b.calendar_event_id);
      if (ev.status !== "cancelled") {
        await release(db, b.id, linkFields(ev));
        return;
      }
      // the event was deleted on Google's side → make a fresh one below
    }

    if (await overInviteCap(db, b)) {
      await release(db, b.id, { meet_sync: "failed", meet_attempts: MEET_RULES.maxSyncAttempts, meet_error: "invite_limit: too many invites to this email today" });
      return;
    }

    const { summary, description } = eventText(b);
    const senior = b.senior.contact_email.toLowerCase();
    const applicant = b.applicant_email.toLowerCase();

    // test mode (anything but PEERPATH_INVITE_MODE=live): only listed test emails may get an invite
    if (!invitesAllowed([senior, applicant])) {
      await release(db, b.id, {
        meet_sync: "failed",
        meet_attempts: MEET_RULES.maxSyncAttempts,
        meet_error: "test_mode: an attendee is not on PEERPATH_TEST_EMAILS, no invite sent",
      });
      return;
    }

    if (b.type === "Group") {
      // same fixed id for everyone on this group time → one event, one Meet link
      const ev = await createEvent({
        id: groupEventIdFor(b.senior_id, b.start_at),
        summary,
        description,
        start: b.start_at,
        end: b.end_at,
        attendees: [{ email: senior }, { email: applicant }],
      });
      const withMe = await updateGuests(ev.id, (emails) => [...emails, senior, applicant]);
      await release(db, b.id, linkFields({ ...withMe, id: ev.id }));
      return;
    }

    // 1:1 reschedule with the same senior: move the old event, keep its Meet link
    if (b.moved_from) {
      const old = await load(db, b.moved_from);
      if (old && old.senior_id === b.senior_id && old.type === "1:1" && old.meet_sync === "ok" && old.calendar_event_id) {
        // take the old event over atomically, so a cleanup run can't delete it while we move it
        const { data: took } = await db.from("pp_bookings").update({ meet_sync: "moved" }).eq("id", old.id).eq("meet_sync", "ok").select("id");
        if ((took ?? []).length === 1) {
          try {
            const moved = await patchEvent(old.calendar_event_id, { start: b.start_at, end: b.end_at, summary, description });
            await release(db, b.id, linkFields({ ...moved, id: old.calendar_event_id }));
            return;
          } catch (err) {
            // give the old event back so it gets cleaned up, then fail this try
            await db.from("pp_bookings").update({ meet_sync: "ok" }).eq("id", old.id).eq("meet_sync", "moved");
            throw err;
          }
        }
      }
    }

    const ev = await createEvent({
      id: eventIdFor(b.id),
      summary,
      description,
      start: b.start_at,
      end: b.end_at,
      attendees: [{ email: senior }, { email: applicant }],
    });
    await release(db, b.id, linkFields(ev));

    // moved from a booking whose event couldn't be reused → tidy the old one now
    if (b.moved_from) {
      const old = await load(db, b.moved_from);
      if (old && old.status === "rescheduled" && hasEvent(old)) await removeBooking(db, old);
    }
  } catch (err) {
    await release(db, b.id, { meet_sync: "failed", meet_error: errText(err) }).catch(() => {});
  }
}

/**
 * Take a cancelled/moved booking off its event: drop the applicant from the guest
 * list (unless another live seat on this event uses the same email), and delete
 * the event once no applicant is left on it.
 */
async function removeBooking(db: SupabaseClient, b: Row) {
  if (!(await claim(db, b))) return;
  const eventId = b.calendar_event_id!;
  try {
    // who else is on this chat? For a group, look at every live seat on the same
    // senior + time — including one still being synced — so we never delete an
    // event someone is joining right now.
    let q = db.from("pp_bookings").select("id, applicant_email").eq("status", "confirmed").neq("id", b.id);
    q =
      b.type === "Group"
        ? q.eq("senior_id", b.senior_id).eq("type", "Group").eq("start_at", b.start_at).not("meet_sync", "in", "(removed,legacy)")
        : q.eq("calendar_event_id", eventId).not("meet_sync", "in", "(moved,removed,legacy)");
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const others = (data ?? []) as { id: string; applicant_email: string }[];
    const me = b.applicant_email.toLowerCase();
    const senior = (b.senior?.contact_email ?? "").toLowerCase();

    if (!others.length) {
      await deleteEvent(eventId);
    } else if (!others.some((o) => o.applicant_email.toLowerCase() === me) && me !== senior) {
      // others still booked → keep the chat, just take this applicant off the invite
      await updateGuests(eventId, (emails) => emails.filter((e) => e !== me));
    }
    await release(db, b.id, { meet_sync: "removed", meet_error: null });
  } catch (err) {
    // stays "failed" with its event id → retried until the attempt cap, then visible to admin
    await release(db, b.id, { meet_sync: "failed", meet_error: errText(err) }).catch(() => {});
  }
}

// ── cron ────────────────────────────────────────────────────────────────────

/** Cron step 1: finish calendar work left over (new, failed, pending, stale claims, cancelled, moved). */
export async function syncPending(db: SupabaseClient, limit = 25): Promise<number> {
  if (!googleConfigured()) return 0;
  const now = new Date().toISOString();
  const [todo, cleanup] = await Promise.all([
    db
      .from("pp_bookings")
      .select("id")
      .eq("status", "confirmed")
      .in("meet_sync", ["none", "syncing", "pending", "failed"])
      .lt("meet_attempts", MEET_RULES.maxSyncAttempts)
      .gt("end_at", now)
      .order("start_at")
      .limit(limit),
    db
      .from("pp_bookings")
      .select("id")
      .in("status", ["cancelled", "rescheduled"])
      .not("calendar_event_id", "is", null)
      .not("meet_sync", "in", "(moved,removed,legacy)")
      .lt("meet_attempts", MEET_RULES.maxSyncAttempts)
      .order("updated_at")
      .limit(limit),
  ]);
  const ids = [...(todo.data ?? []), ...(cleanup.data ?? [])].map((r) => r.id as string);
  for (const id of ids) {
    try {
      await syncBooking(db, id);
    } catch {
      /* one bad row must not stop the rest */
    }
  }
  return ids.length;
}

/** Cron step 2: read Meet attendance for chats that ended, and set the result. */
export async function checkAttendance(db: SupabaseClient, limit = 20): Promise<{ completed: number; flagged: number }> {
  const out = { completed: 0, flagged: 0 };
  if (!googleConfigured()) return out;
  const now = Date.now();
  const { data, error } = await db
    .from("pp_bookings")
    .select(COLS)
    .eq("status", "confirmed")
    .eq("meet_sync", "ok")
    .is("auto_result", null)
    .not("meet_code", "is", null)
    .lt("end_at", new Date(now - MEET_RULES.checkAfterMinutes * 60_000).toISOString())
    .order("end_at")
    .limit(limit);
  if (error) return out;
  const rows = (data as unknown as Row[]) ?? [];

  // one Meet per event: a group's bookings are decided together
  const byEvent = new Map<string, Row[]>();
  for (const r of rows) byEvent.set(r.calendar_event_id ?? r.id, [...(byEvent.get(r.calendar_event_id ?? r.id) ?? []), r]);

  for (const list of byEvent.values()) {
    const b = list[0];
    const start = Date.parse(b.start_at);
    const end = Date.parse(b.end_at);
    const lastTry = list.some((r) => (r.auto_check_attempts ?? 0) + 1 >= MEET_RULES.maxCheckAttempts) || now - end > 24 * 3_600_000;
    try {
      const records = await conferenceRecords(b.meet_code!, new Date(start - 30 * 60_000), new Date(end + 30 * 60_000));
      const stillOn = records.some((r) => !r.endTime);
      const tooEarly = !records.length && now - end < MEET_RULES.noRecordFlagHours * 3_600_000;
      if ((stillOn || tooEarly) && !lastTry) {
        await bump(db, list); // call still going, or Meet hasn't published the record yet
        continue;
      }
      if (stillOn) {
        await flag(db, list, { people: 0, overlapMin: 0, records: records.length, reason: "check_failed" }, now);
        out.flagged += list.length;
        continue;
      }
      const participants: Participant[] = [];
      for (const r of records) participants.push(...(await attendees(r, now)));
      // every seat on this event counts, not only the ones fetched in this batch
      let bookings = 1;
      if (b.type === "Group") {
        const { count } = await db
          .from("pp_bookings")
          .select("id", { count: "exact", head: true })
          .eq("calendar_event_id", b.calendar_event_id!)
          .in("status", ["confirmed", "completed", "no_show_applicant"]);
        bookings = Math.max(count ?? list.length, list.length);
      }
      const verdict = decideAttendance({ bookings, window: { start, end }, participants, hasRecord: records.length > 0 });
      const attendance = {
        people: verdict.people,
        overlapMin: verdict.overlapMin,
        records: records.length,
        reason: verdict.result === "needs_marking" ? verdict.reason : null,
      };
      if (verdict.result === "completed") {
        for (const r of list) {
          // only if nobody marked it meanwhile
          await db
            .from("pp_bookings")
            .update({ status: "completed", auto_result: "completed", attendance: { ...attendance, checkedAt: new Date(now).toISOString() }, auto_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", r.id)
            .eq("status", "confirmed");
        }
        out.completed += list.length;
      } else {
        await flag(db, list, attendance, now);
        out.flagged += list.length;
      }
    } catch {
      if (lastTry) {
        await flag(db, list, { people: 0, overlapMin: 0, records: 0, reason: "check_failed" }, now);
        out.flagged += list.length;
      } else await bump(db, list);
    }
  }
  return out;
}

async function flag(db: SupabaseClient, list: Row[], attendance: Record<string, unknown>, now: number) {
  for (const r of list) {
    await db
      .from("pp_bookings")
      .update({ auto_result: "needs_marking", attendance: { ...attendance, checkedAt: new Date(now).toISOString() }, auto_checked_at: new Date().toISOString() })
      .eq("id", r.id)
      .eq("status", "confirmed");
  }
}

async function bump(db: SupabaseClient, list: Row[]) {
  for (const r of list) await db.from("pp_bookings").update({ auto_check_attempts: (r.auto_check_attempts ?? 0) + 1 }).eq("id", r.id);
}

/** For the public sync route: only act on bookings that changed in the last half hour. */
export function changedRecently(b: Pick<Row, "created_at" | "updated_at">, withinMs = 30 * 60_000): boolean {
  const t = Math.max(Date.parse(b.created_at), Date.parse(b.updated_at ?? b.created_at));
  return Date.now() - t < withinMs;
}
