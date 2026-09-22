import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";

/** Returns { conflict: "phone" | "email" | null } — whether a real account
 *  already owns this phone/email. Call AFTER /api/auth/reclaim clears ghosts. */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return Response.json({ conflict: null });
  let body: { phone?: string; email?: string };
  try { body = await req.json(); } catch { return Response.json({ conflict: null }); }
  try {
    const admin = createClient(url, svc);
    const { data } = await admin.rpc("signup_conflict", { p_phone: (body.phone || "").trim() || null, p_email: (body.email || "").trim() || null });
    return Response.json({ conflict: (data as string) || null });
  } catch { return Response.json({ conflict: null }); }
}
