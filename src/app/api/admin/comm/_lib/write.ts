/**
 * Communication Manager · guard for admin routes that WRITE (POST / PATCH / DELETE) or take a JSON body.
 *
 * Order:
 *   1. cross-site browser request (Sec-Fetch-Site: cross-site) → 403
 *   2. CSRF: a cookie request must carry this site's Origin (missing / foreign / "null" → 403).
 *      Bearer-token requests skip this (browsers never add that header by themselves), same as PeerPath.
 *   3. JSON content type for requests with a body → 415
 *   4. per-IP limit on the trusted Vercel IP → 429 (limiter down → 503)
 *   5. login (cookie or Bearer) → 401
 *   6. per-user limit for this action → 429
 *   7. body: one JSON object, at most 8 KB, strict schema (unknown keys refused) → 400
 *   8. the comm_* function runs AS THE USER and checks admin itself:
 *      42501 → 403, 22023 → 400, P0002 → 404, 55000 → 409 LOCKED, 23505 → 409 CONFLICT (Slice 6: flow name taken),
 *      anything else → 500 (DB message never returned or logged)
 */
import { createClient as createSupabase, type SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { bearerToken, readJsonObject, sameOrigin } from "@/lib/peerpath/book-request";
import { fail, hit, ok, trustedIp } from "./guard";

/**
 * Slice 4 additions (both optional, nothing changes for the other routes):
 *   extra  – fields added to the success answer next to the database result (e.g. the cleaned HTML + removed counts)
 *   reason – a fixed reason code sent with a 400 (e.g. "unknown_merge_field"); never the user's text
 */
export type WritePlan =
  | { ok: true; fn: string; args: Record<string, unknown>; extra?: Record<string, unknown> }
  | { ok: false; code: "INVALID"; reason?: string };

export async function commWrite<S extends z.ZodTypeAny>(
  req: Request,
  opts: {
    action: "comm_write" | "comm_preview" | "comm_suppress" | "comm_import" | "comm_doctpl" | "comm_flow"; perUser: number; perIp: number; body: S | null;
    /** Slice 3b: a bigger body limit for one route (default 8 KB); a larger Content-Length is refused before reading */
    maxBytes?: number;
  },
  plan: (body: z.infer<S>) => WritePlan,
): Promise<Response> {
  if ((req.headers.get("sec-fetch-site") ?? "").toLowerCase() === "cross-site") return fail(403, "FORBIDDEN");
  const token = bearerToken(req);
  if (!token && !sameOrigin(req)) return fail(403, "FORBIDDEN");
  if (opts.body && !(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return fail(415, "INVALID");

  const ip = trustedIp(req);
  if (!ip) {
    if (process.env.VERCEL) return fail(429, "RATE_LIMITED");
  } else {
    const h = await hit(`${opts.action}:ip:${ip}`, opts.perIp);
    if (h === "error") return fail(503, "UNAVAILABLE");
    if (h === "limited") return fail(429, "RATE_LIMITED");
  }

  const sb: SupabaseClient = token
    ? createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : ((await createCookieClient()) as unknown as SupabaseClient);
  const { data: auth } = token ? await sb.auth.getUser(token) : await sb.auth.getUser();
  const user = auth?.user;
  if (!user) return fail(401, "NOT_LOGGED_IN");

  const u = await hit(`${opts.action}:user:${user.id}`, opts.perUser);
  if (u === "error") return fail(503, "UNAVAILABLE");
  if (u === "limited") return fail(429, "RATE_LIMITED");

  let body: unknown = undefined;
  if (opts.body) {
    if (opts.maxBytes && Number(req.headers.get("content-length") ?? 0) > opts.maxBytes) return fail(400, "INVALID");
    const raw = opts.maxBytes ? await readJsonObject(req, opts.maxBytes) : await readJsonObject(req);
    if (!raw) return fail(400, "INVALID");
    const parsed = opts.body.safeParse(raw);
    if (!parsed.success) return fail(400, "INVALID");
    body = parsed.data;
  }
  const p = plan(body as z.infer<S>);
  if (!p.ok) return fail(400, p.code, p.reason);

  const { data, error } = await sb.rpc(p.fn, p.args);
  if (error) {
    if (error.code === "42501") return fail(403, "FORBIDDEN");
    if (error.code === "22023") return fail(400, "INVALID");
    if (error.code === "P0002") return fail(404, "NOT_FOUND");
    if (error.code === "55000") return fail(409, "LOCKED");   // Slice 2: suppression not added in the admin panel
    if (error.code === "23505") return fail(409, "CONFLICT"); // Slice 6: a live flow already has this name
    console.error(`[comm] ${p.fn} failed (code ${String(error.code ?? "unknown")})`);
    return fail(500, "SERVER");
  }
  return ok(p.extra && data && typeof data === "object" && !Array.isArray(data) ? { ...(data as Record<string, unknown>), ...p.extra } : data);
}
