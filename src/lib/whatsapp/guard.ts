import { createClient } from "@/lib/supabase/server";
/** Returns the admin user or null. */
export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, supabase };
  const { data: isAdmin } = await supabase.rpc("is_admin");
  return { user: isAdmin ? user : null, supabase };
}
