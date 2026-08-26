import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 * Scoped to the `app` schema so the superapp never touches the CRM/events
 * tables living in `public`. Change the schema name here if you rename it.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
