import { scError } from "@/lib/growth/schoolconnect";
import type { Client, Res } from "../consultants/api";

export type { Client, Res };

/**
 * One call to a growth_sc_* RPC (migration 0144). Every check (admin, values, duplicate UTM per VSAT) runs in the
 * database; this only turns its error code into a sentence for the banner.
 */
export async function call<T>(sb: Client, fn: string, p: Record<string, unknown>, labelOf?: (k: string) => string | undefined): Promise<Res<T>> {
  try {
    const { data, error } = await sb.rpc(fn, { p });
    if (error) {
      const detail = (error as { details?: string | null }).details ?? null;
      return { data: null, error: scError(error.message, detail, labelOf), code: error.message, detail };
    }
    return { data: data as T, error: null, code: null, detail: null };
  } catch {
    return { data: null, error: "Could not reach the server. Check your connection and try again.", code: "NETWORK", detail: null };
  }
}
