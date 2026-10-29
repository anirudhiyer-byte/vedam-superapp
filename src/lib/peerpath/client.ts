"use client";
/**
 * PeerPath · Talk to a Senior — browser-side writes, through the pp_* database
 * functions. Each returns { ok, error?, ... } and never throws.
 */
import { createClient } from "@/lib/supabase/client";
import { getProofClient } from "./proof";
import type { AvailabilityRule, Booking, DateBlock, SeniorProfileInput, SeniorSettings } from "./types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; message: string };

const MESSAGES: Record<string, string> = {
  taken: "Sorry, this time was just taken or is no longer open. Please pick another time.",
  limit: "You already have 2 upcoming chats. Please finish or cancel one before booking another.",
  invalid: "Some details look wrong. Please check and try again.",
  too_late: "This chat starts in less than 3 hours, so it can no longer be changed here.",
  reschedule_closed: "This chat can no longer be moved. Please book a new time instead.",
  not_found: "We couldn't find this. The link may be old.",
  not_yet: "Feedback opens once the chat has started.",
  email: "Please enter a valid email.",
  exists: "A senior with this email already exists. Please use your personal link.",
  busy: "Too many sign-ups right now. Please try again in a while.",
  forbidden: "Only Vedam admins can do this. Please sign in with your @vedam.org account.",
  offline: "You seem to be offline. Please check your internet and try again.",
  rate_limited: "Too many tries. Please wait a few minutes and try again.",
};
const fail = (error: string): { ok: false; error: string; message: string } => ({ ok: false, error, message: MESSAGES[error] ?? "Something went wrong. Please try again." });

async function call<T extends object>(fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  try {
    const sb = createClient();
    const { data, error } = await sb.rpc(fn, args);
    if (error) return fail(error.code === "PGRST301" ? "forbidden" : "server");
    if (data && typeof data === "object" && "ok" in data) {
      return data.ok ? (data as { ok: true } & T) : fail(String((data as { error?: string }).error ?? "server"));
    }
    return { ok: true, ...(data as T) };
  } catch {
    return fail("offline");
  }
}

export function book(p: {
  seniorId: string;
  start: string;
  type: string;
  duration: number;
  name: string;
  email: string;
  phone: string;
  question: string | null;
  rescheduleOf?: string | null;
}) {
  // through our server: trusted per-IP limit + calendar invite created server-side
  return post<{ id: string }>("/api/peerpath/book", p);
}

// cancel goes through our server too; it reads this device's ownership proof
// (email + phone) from the proof cookie and the database checks it.
export const cancelBooking = (id: string) => post("/api/peerpath/cancel", { id });

/** POST to one of our PeerPath API routes; same { ok, error, message } shape as call(). */
async function post<T extends object>(url: string, body: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
    if (!data) return fail("server");
    return data.ok ? ({ ok: true, ...data } as { ok: true } & T) : fail(String(data.error ?? "server"));
  } catch {
    return fail("offline");
  }
}

export const giveFeedback = (id: string, rating: number, recommend: boolean, promise: boolean, note: string | null) => {
  const pr = getProofClient();
  return call("pp_give_feedback", { p_id: id, p_email: pr?.email ?? "", p_phone: pr?.phone ?? "", p_rating: rating, p_recommend: recommend, p_promise: promise, p_note: note });
};

export async function findBookings(email: string, phone: string): Promise<Booking[] | null> {
  try {
    const { data, error } = await createClient().rpc("pp_find_bookings", { p_email: email, p_phone: phone });
    if (error) return null;
    return Array.isArray(data) ? (data as Booking[]) : [];
  } catch {
    return null;
  }
}

export const createSenior = (p: SeniorProfileInput) => call<{ id: string; token: string }>("pp_senior_create", { p });
export const saveProfile = (token: string, p: SeniorProfileInput) => call("pp_senior_save_profile", { p_token: token, p });
export const saveTimes = (token: string, rules: AvailabilityRule[], blocks: DateBlock[], settings: SeniorSettings) =>
  call("pp_senior_save_times", { p_token: token, p_rules: rules, p_blocks: blocks, p_settings: settings });
export const markBooking = (token: string, booking: string, status: "completed" | "no_show_applicant" | "confirmed") =>
  call("pp_senior_mark", { p_token: token, p_booking: booking, p_status: status });
export const adminSetStatus = (senior: string, status: "pending" | "active" | "paused") =>
  call("pp_admin_set_status", { p_senior: senior, p_status: status });
