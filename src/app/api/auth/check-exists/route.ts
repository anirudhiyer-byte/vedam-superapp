import { createClient } from "@supabase/supabase-js";
import { parseBody, contactSchema } from "@/lib/validation";
export const dynamic = "force-dynamic";

/** Returns { conflict: "phone" | "email" | null } — whether a real account
 *  already owns this phone/email. Call AFTER /api/auth/reclaim clears ghosts. */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return Response.json({ conflict: null });
  const parsed = await parseBody(req, contactSchema);
  if (!parsed.ok) return Response.json({ conflict: null });
  const body = parsed.data;
  try {
    const admin = createClient(url, svc);
    // per-IP rate limit — don't let this be used as an account-enumeration oracle
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const { data: allowed } = await admin.rpc("rate_limit_hit", { p_key: `check-exists:${ip}`, p_max: 30, p_window: 60 });
    if (allowed === false) return Response.json({ conflict: null });
    const { data } = await admin.rpc("signup_conflict", { p_phone: (body.phone || "").trim() || null, p_email: (body.email || "").trim() || null });
    return Response.json({ conflict: (data as string) || null });
  } catch { return Response.json({ conflict: null }); }
}
