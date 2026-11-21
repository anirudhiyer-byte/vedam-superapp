import type { createClient } from "@/lib/supabase/client";
import { consError } from "@/lib/growth/consultants";

export type Client = ReturnType<typeof createClient>;
export type Res<T> = { data: T | null; error: string | null; code: string | null; detail: string | null };

/**
 * One call to a growth_cons_* RPC (migration 0130). Every check (admin, values, duplicate UTM) runs in the
 * database; this only turns its error code into a sentence for the banner.
 */
export async function call<T>(sb: Client, fn: string, p: Record<string, unknown>, labelOf?: (k: string) => string | undefined): Promise<Res<T>> {
  try {
    const { data, error } = await sb.rpc(fn, { p });
    if (error) {
      const detail = (error as { details?: string | null }).details ?? null;
      return { data: null, error: consError(error.message, detail, labelOf), code: error.message, detail };
    }
    return { data: data as T, error: null, code: null, detail: null };
  } catch {
    return { data: null, error: "Could not reach the server. Check your connection and try again.", code: "NETWORK", detail: null };
  }
}
