"use client";
/**
 * PeerPath · Talk to a Senior — browser-side writes, through the pp_* database
 * functions. Each returns { ok, error?, ... } and never throws.
 */
import { createClient } from "@/lib/supabase/client";
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
  return call<{ id: string }>("pp_book", { p });
}

export const cancelBooking = (id: string) => call("pp_cancel", { p_id: id });

export const giveFeedback = (id: string, rating: number, recommend: boolean, promise: boolean, note: string | null) =>
  call("pp_give_feedback", { p_id: id, p_rating: rating, p_recommend: recommend, p_promise: promise, p_note: note });

export async function bookingsByIds(ids: string[]): Promise<Booking[]> {
  if (!ids.length) return [];
  try {
    const { data } = await createClient().rpc("pp_bookings_by_ids", { p_ids: ids.slice(0, 50) });
    return Array.isArray(data) ? (data as Booking[]) : [];
  } catch {
    return [];
  }
}

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

/** Bookings made on this device, so "My bookings" works without an account. */
const KEY = "pp_my_bookings";
export function rememberBooking(id: string) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]") as string[];
    localStorage.setItem(KEY, JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 50)));
  } catch {
    /* storage off: My bookings can still look up by email + phone */
  }
}
export function rememberedBookings(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
