import { z } from "zod";

/**
 * Defense-in-depth input validation for API route bodies. The app writes via the
 * Supabase query-builder / RPCs (no string SQL), so this isn't the only guard —
 * but it rejects malformed, wrong-typed, or oversized payloads before they reach
 * the DB, and strips unknown keys so nothing unexpected is forwarded.
 */

export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false }> {
  try {
    const raw = await req.json();
    const r = schema.safeParse(raw);
    return r.success ? { ok: true, data: r.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

// bounded contact fields — permissive on exact format (the OTP flow validates
// separately), strict on type + length so junk/huge payloads are rejected.
const phone = z.string().trim().max(20).optional();
const email = z.string().trim().max(254).optional();

/** /api/auth/reclaim and /api/auth/check-exists */
export const contactSchema = z.object({ phone, email }).strip();

/** /api/vsat/lead */
export const vsatLeadSchema = z.object({
  accessToken: z.string().max(4096).optional(),
  lead: z.object({
    name: z.string().trim().max(200).optional(),
    email,
    phone,
    hearAbout: z.string().trim().max(200).optional(),
    campusPref: z.string().trim().max(120).optional(),
    lead_source: z.string().trim().max(200).optional(),
    full_utm: z.string().trim().max(500).optional(),
    utm_source: z.string().trim().max(200).optional(),
    utm_medium: z.string().trim().max(200).optional(),
    utm_campaign: z.string().trim().max(200).optional(),
    utm_content: z.string().trim().max(200).optional(),
    utm_term: z.string().trim().max(200).optional(),
  }).strip().default({}),
}).strip();
