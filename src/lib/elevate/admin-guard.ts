import { createClient } from "@/lib/supabase/server";

/** True when the signed-in user is a Vedam admin — same rule as /admin/vsat. */
export async function isAdminRequest(): Promise<boolean> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  const email = (user.email ?? "").toLowerCase();
  if (email.endsWith("@vedam.org") && user.email_confirmed_at) return true;
  const { data } = await sb.rpc("is_admin");
  return !!data;
}
