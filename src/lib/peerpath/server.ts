/**
 * PeerPath · Talk to a Senior — server-side reads.
 * Everything goes through the pp_* database functions on Supabase (SECURITY
 * DEFINER, so the pp_* tables stay locked behind RLS). The admin read runs with
 * the signed-in user's session, so pp_is_admin() can check who is asking.
 */
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { PROOF_COOKIE, decodeProof } from "./proof";
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

/**
 * One booking, returned ONLY if the caller proves they own it (the email + phone
 * they booked with, read from the per-device proof cookie) or is an admin. A bare
 * UUID is no longer enough. Returns null for "not found" and "not yours" alike, so
 * nothing about a booking leaks to someone who only has its link.
 */
export async function loadBooking(id: string): Promise<Booking | null> {
  if (!isUuid(id)) return null;
  const jar = await cookies();
  const proof = decodeProof(jar.get(PROOF_COOKIE)?.value);
  const sb = await createClient();
  const { data, error } = await sb.rpc("pp_booking_by_id", {
    p_id: id,
    p_email: proof?.email ?? "",
    p_phone: proof?.phone ?? "",
  });
  if (error || !data) return null;
  return (data as Booking) ?? null;
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
