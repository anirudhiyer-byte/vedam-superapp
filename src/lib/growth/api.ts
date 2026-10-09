import { NextResponse } from "next/server";
import { createClient as createServer } from "@/lib/supabase/server";
import { createClient as createSvc } from "@supabase/supabase-js";

/** Service-role Supabase client — bypasses RLS; server-only. Used for all Growth reads/writes
 *  (the Growth tables/views are locked to anon/authenticated). */
export function svc() {
  return createSvc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** Gate: returns the signed-in admin user, or a NextResponse error to return early.
 *  Admin = user_roles row 'admin' OR confirmed @vedam.org (same as the rest of /admin). */
export async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; res: NextResponse }
> {
  const sb = await createServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: roleRow } = await sb.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  const isAdmin = !!roleRow || (!!user.email?.toLowerCase().endsWith("@vedam.org") && !!user.email_confirmed_at);
  if (!isAdmin) return { ok: false, res: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  return { ok: true, userId: user.id };
}
