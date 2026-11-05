/**
 * Communication Manager · shared guard for the read-only GET routes under /api/admin/comm/.
 *
 * Order (cheap and safe first):
 *   1. cross-site browser request (Sec-Fetch-Site: cross-site) → 403
 *   2. per-IP limit on the trusted Vercel IP (before any login check, so junk tokens never reach Auth) → 429
 *   3. login: cookie session, or `Authorization: Bearer <token>` for API clients → 401
 *   4. per-user limit → 429
 *   5. strict query validation (unknown or repeated keys, bad values, > 90 days) → 400
 *   6. the comm_* database function runs AS THE USER; it checks admin itself (42501 → 403)
 *
 * The service-role key is used for ONE thing only: the private limiter pp_rate_hit
 * (not callable by browsers). It never reads or returns page data.
 * Errors never echo database messages back to the browser or into logs.
 */
import { NextResponse } from "next/server";
import { createClient as createSupabase, type SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { bearerToken } from "@/lib/peerpath/book-request";
import { parseQuery, type RangeResult } from "./params";

export const PER_IP_PER_MIN = 300;
export const PER_USER_PER_MIN = 120;

type Code = "FORBIDDEN" | "NOT_LOGGED_IN" | "RATE_LIMITED" | "INVALID" | "RANGE_TOO_LONG" | "NOT_FOUND" | "SERVER" | "UNAVAILABLE" | "LOCKED";

const HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
export const fail = (status: number, code: Code) => NextResponse.json({ ok: false, code }, { status, headers: HEADERS });
const done = (data: unknown) => NextResponse.json({ ok: true, data }, { status: 200, headers: HEADERS });
/** success answer, shared with the write guard (write.ts) */
export const ok = done;

/** Visitor IP as Vercel sets it (cannot be faked by the browser on Vercel). */
export function trustedIp(req: Request): string | null {
  const raw = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for");
  const ip = raw?.split(",")[0]?.trim();
  return ip || null;
}

type Hit = "ok" | "limited" | "error";
/** one hit on the private limiter pp_rate_hit (60-second window). Shared with write.ts. */
export async function hit(key: string, max: number): Promise<Hit> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return "error";
  try {
    const db = createSupabase(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc("pp_rate_hit", { p_key: key, p_max: max, p_window: 60 });
    if (error) return "error";
    return data === false ? "limited" : "ok";
  } catch {
    return "error";
  }
}

/** What a route asks the database for: function name + named args, or a 400 code. */
export type Plan = { ok: true; fn: string; args: Record<string, unknown> } | { ok: false; code: "INVALID" | "RANGE_TOO_LONG" };

export const fromRange = (r: Extract<RangeResult, { ok: false }>): Plan => ({ ok: false, code: r.code });

export async function commGet<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
  plan: (q: z.infer<S>) => Plan,
  opts: { notFound?: (data: unknown) => boolean } = {},
): Promise<Response> {
  if ((req.headers.get("sec-fetch-site") ?? "").toLowerCase() === "cross-site") return fail(403, "FORBIDDEN");

  const ip = trustedIp(req);
  if (!ip) {
    // on Vercel the header is always set, so a missing IP fails closed; local dev only otherwise
    if (process.env.VERCEL) return fail(429, "RATE_LIMITED");
  } else {
    const h = await hit(`comm_read:ip:${ip}`, PER_IP_PER_MIN);
    if (h === "error") return fail(503, "UNAVAILABLE");
    if (h === "limited") return fail(429, "RATE_LIMITED");
  }

  const token = bearerToken(req);
  const sb: SupabaseClient = token
    ? createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : ((await createCookieClient()) as unknown as SupabaseClient);
  const { data: auth } = token ? await sb.auth.getUser(token) : await sb.auth.getUser();
  const user = auth?.user;
  if (!user) return fail(401, "NOT_LOGGED_IN");

  const u = await hit(`comm_read:user:${user.id}`, PER_USER_PER_MIN);
  if (u === "error") return fail(503, "UNAVAILABLE");
  if (u === "limited") return fail(429, "RATE_LIMITED");

  const q = parseQuery(new URL(req.url), schema);
  if (!q.ok) return fail(400, "INVALID");
  const p = plan(q.data);
  if (!p.ok) return fail(400, p.code);

  const { data, error } = await sb.rpc(p.fn, p.args);
  if (error) {
    if (error.code === "42501") return fail(403, "FORBIDDEN");
    if (error.code === "22023") return fail(400, error.message === "range_too_long" ? "RANGE_TOO_LONG" : "INVALID");
    if (error.code === "P0002") return fail(404, "NOT_FOUND");   // Slice 3b: comm_list_count of an unknown / deleted list
    console.error(`[comm] ${p.fn} failed (code ${String(error.code ?? "unknown")})`);
    return fail(500, "SERVER");
  }
  if (opts.notFound?.(data)) return fail(404, "NOT_FOUND");
  return done(data);
}
