import type { createClient } from "@/lib/supabase/client";

type Client = ReturnType<typeof createClient>;

/**
 * Call a set-returning RPC page by page and return every row.
 *
 * The Supabase API caps each response (~1000 rows), so a single `.rpc()` call
 * silently drops the rest. This reads `.range()` pages until one comes back empty.
 * Only use it with RPCs whose ORDER BY ends in a unique column — otherwise pages
 * can overlap or skip rows (see migrations 0052 / 0054).
 */
export async function rpcAll<T>(
  supabase: Client,
  fn: string,
  args?: Record<string, unknown>,
  pageSize = 1000,
): Promise<{ data: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0, guard = 0; guard < 500; guard++) {
    const { data, error } = await supabase.rpc(fn, args).range(from, from + pageSize - 1);
    if (error) return { data: rows, error: error.message };
    const chunk = (data as T[] | null) ?? [];
    if (chunk.length === 0) break;
    rows.push(...chunk);
    from += chunk.length;
  }
  return { data: rows, error: null };
}
