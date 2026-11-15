/**
 * PeerPath · Talk to a Senior — server-side reads.
 * Everything goes through the pp_* database functions on Supabase (SECURITY
 * DEFINER, so the pp_* tables stay locked behind RLS). The admin read runs with
 * the signed-in user's session, so pp_is_admin() can check who is asking.
 */
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { buildSlots, type BusyRange } from "./slots";
import type { AdminData, AvailabilityRule, Booking, DateBlock, Senior, SeniorPortal, SeniorSettings, SeniorWithSlots } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | undefined | null): v is string => !!v && UUID.test(v);

type PublicPayload = {
  seniors: Senior[];
  rules: Record<string, AvailabilityRule[]>;
  blocks: Record<string, DateBlock[]>;
  settings: Record<string, SeniorSettings>;
  busy: (BusyRange & { seniorId: string })[];
  now: string;
};

/** Live seniors with their bookable times, built from their own weekly times, days off, limits and existing bookings. */
export async function loadSeniors(): Promise<{ seniors: SeniorWithSlots[]; ok: boolean }> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("pp_public");
  if (error || !data) return { seniors: [], ok: false };
  const p = data as PublicPayload;
  const now = p.now ? new Date(p.now) : new Date();
  const seniors = p.seniors
    .filter((s) => !p.settings[s.id]?.paused)
    .map((s) => ({
      ...s,
      slots: buildSlots({
        seniorId: s.id,
        rules: p.rules[s.id] ?? [],
        blocks: p.blocks[s.id] ?? [],
        settings: p.settings[s.id] ?? { dailyCap: 2, weeklyCap: 4, minNoticeHours: 12, paused: false },
        durations: s.durations,
        busy: p.busy.filter((b) => b.seniorId === s.id),
        now,
      }).filter((slot) => s.sessionTypes.includes(slot.type)),
    }));
  return { seniors, ok: true };
}

export async function loadSenior(id: string): Promise<SeniorWithSlots | null> {
  if (!isUuid(id)) return null;
  const { seniors } = await loadSeniors();
  return seniors.find((s) => s.id === id) ?? null;
}

/** The logged-in user (verified with Supabase Auth), or null. */
export async function getSessionUser(): Promise<User | null> {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  return data?.user ?? null;
}

/**
 * One booking, returned ONLY to the login that made it (or an admin) — checked in
 * pp_booking_by_id from auth.uid(). Returns null for "not found" and "not yours"
 * alike, so a booking link alone reveals nothing.
 */
export async function loadBooking(id: string): Promise<Booking | null> {
  if (!isUuid(id)) return null;
  const sb = await createClient();
  const { data, error } = await sb.rpc("pp_booking_by_id", { p_id: id });
  if (error || !data) return null;
  return (data as Booking) ?? null;
}

/** The logged-in user's own bookings (newest first, max 50). */
export async function loadMyBookings(): Promise<Booking[] | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("pp_my_bookings");
  if (error) return null;
  return Array.isArray(data) ? (data as Booking[]) : [];
}

/** Name / email / phone exactly as pp_book will store them (read-only on the booking page). */
export type MyContact = { name: string; email: string | null; phone: string | null; complete: boolean };
export async function loadMyContact(): Promise<MyContact | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("pp_my_contact");
  if (error || !data || typeof data !== "object") return null;
  return data as MyContact;
}

export async function loadPortal(token: string): Promise<SeniorPortal | null> {
  if (!isUuid(token)) return null;
  const sb = await createClient();
  const { data, error } = await sb.rpc("pp_senior_me", { p_token: token });
  if (error || !data || !data.ok) return null;
  return data as SeniorPortal;
}

export async function loadAdmin(): Promise<AdminData | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("pp_admin_all");
  if (error || !data || !data.ok) return null;
  return data as AdminData;
}

/** Same rule the rest of the superapp uses: confirmed @vedam.org account, or is_admin(). */
export async function isAdminUser(): Promise<boolean> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return false;
  const email = (user.email ?? "").toLowerCase();
  if (email.endsWith("@vedam.org") && !!user.email_confirmed_at) return true;
  const { data } = await sb.rpc("is_admin");
  return !!data;
}
