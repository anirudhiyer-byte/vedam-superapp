import { createClient } from "@supabase/supabase-js";
import { parseBody, contactSchema } from "@/lib/validation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Pre-check before sending a phone OTP: { allowed: boolean }.
 *  Runs server-side so the limiter key uses the REAL client IP (per-phone AND
 *  per-IP buckets). The browser cannot know its own IP, and a client-supplied
 *  IP would be spoofable — so public.otp_allowed is service_role-only now.
 *
 *  IP source: Vercel sets x-real-ip / the first x-forwarded-for hop from the
 *  TCP connection and overwrites any client-sent value, so neither is spoofable
 *  on Vercel. Locally (next dev) there is no proxy; fall back to 127.0.0.1. */
function clientIp(req: Request): string | null {
  const real = (req.headers.get("x-real-ip") || "").trim();
  if (real) return real;
  const fwd = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (fwd) return fwd;
  return process.env.NODE_ENV === "development" ? "127.0.0.1" : null;
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return Response.json({ allowed: false, error: "not configured" }, { status: 500 });
  const parsed = await parseBody(req, contactSchema);
  const phone = parsed.ok ? (parsed.data.phone || "").trim() : "";
  if (!phone) return Response.json({ allowed: false, error: "phone required" }, { status: 400 });
  const ip = clientIp(req);
  if (!ip) return Response.json({ allowed: false, error: "client address unavailable" }, { status: 400 });
  try {
    const admin = createClient(url, svc);
    const { data, error } = await admin.rpc("otp_allowed", { p_phone: phone, p_ip: ip });
    if (error) return Response.json({ allowed: false, error: "limiter error" }, { status: 500 });
    return Response.json({ allowed: data === true }, { status: data === true ? 200 : 429 });
  } catch {
    return Response.json({ allowed: false, error: "limiter error" }, { status: 500 });
  }
}
