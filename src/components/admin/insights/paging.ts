/* Progressive paging for the Insights people list (D4): hand over each page as soon as it
 * arrives, so the first rows show at once instead of after the whole list has loaded.
 * Same paging rules as src/lib/supabase/rpc-all.ts (keep reading .range() pages until one
 * comes back empty), which stays as it is for its other users. */

/** The one call this helper makes: rows [from, to] (inclusive) of a set-returning RPC. */
export type FetchPage<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Read every page in order, calling onPage with each non-empty page as it arrives.
 * Stops at the first empty page, on an error, or when isLive() turns false (the drawer
 * closed or the filter changed) — no further requests are made after that.
 * Only use with RPCs whose ORDER BY ends in a unique column (ins_people does).
 */
export async function loadPages<T>(
  fetchPage: FetchPage<T>,
  onPage: (rows: T[]) => void,
  isLive: () => boolean = () => true,
  pageSize = 1000,
): Promise<{ error: string | null; total: number; stopped: boolean }> {
  let from = 0;
  for (let guard = 0; guard < 500; guard++) {
    if (!isLive()) return { error: null, total: from, stopped: true };
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (!isLive()) return { error: null, total: from, stopped: true };
    if (error) return { error: error.message, total: from, stopped: false };
    const chunk = data ?? [];
    if (chunk.length === 0) break;
    onPage(chunk);
    from += chunk.length;
  }
  return { error: null, total: from, stopped: false };
}
