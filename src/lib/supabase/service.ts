import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Standalone service-role client. Bypasses RLS — use only in trusted server code
 * (webhooks, crons). Kept dependency-free so routes that need it don't drag in
 * unrelated modules.
 */
export function adminDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}
