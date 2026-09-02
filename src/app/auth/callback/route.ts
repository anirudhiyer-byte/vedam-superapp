import { NextResponse } from "next/server";
import { createClient as createServer } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** Google OAuth is RE-LOGIN ONLY — it must match an account that fully signed up
 *  via OTP (has phone/stream/consent). If Google creates a fresh/stub account, we
 *  reject it, delete the stub, and send them to sign up with OTP first. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/";
  if (!code) return NextResponse.redirect(`${origin}/login?error=oauth`);

  const supabase = await createServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=oauth`);

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: p } = await supabase.from("profiles").select("phone, stream, consent").eq("id", user.id).maybeSingle();
    const completed = !!(p?.phone || p?.stream || p?.consent);
    if (!completed) {
      await supabase.auth.signOut();
      // best-effort: remove the stub Google account so it doesn't linger
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (svc) { const admin = createAdmin(url, svc); await admin.auth.admin.deleteUser(user.id); }
      } catch { /* ignore */ }
      return NextResponse.redirect(`${origin}/login?error=signup-first`);
    }
  }
  return NextResponse.redirect(`${origin}${next}`);
}
