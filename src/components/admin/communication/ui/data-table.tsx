"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, Button, Dash, Select, FOCUS_RING } from "./primitives";
import { ErrorState, Skeleton } from "./states";
import { useIsPhone } from "./use-media";
import type { Page, Query, SortDir } from "../lib/types";

/* ══════════════════════════════════════════════════════
   useTableQuery — one hook that owns search / filters /
   sort / page / selection and calls the data source.
   Swapping mock-api for a real API needs no change here.
   ══════════════════════════════════════════════════════ */
export function useTableQuery<T extends { id: string }>({
  fetcher, pageSize = 10, initialSort, initialFilters,
}: {
  fetcher: (q: Query) => Promise<Page<T>>;
  pageSize?: number;
  initialSort?: { key: string; dir: SortDir };
  /** v2: start with these filters, so the first request is already the right one. */
  initialFilters?: Record<string, string>;
}) {
  const [search, setSearchRaw] = useState("");
  const [filters, setFiltersRaw] = useState<Record<string, string>>(initialFilters ?? {});
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshedAt, setRefreshedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [nonce, setNonce] = useState(0);

  const latest = useRef(0);
  const quietNext = useRef(false); // v2: set by reload() so the next fetch keeps the rows on screen

  useEffect(() => {
    const ticket = ++latest.current;
    const quiet = quietNext.current;
    quietNext.current = false;
    if (!quiet) setLoading(true);
    setError(null);
    fetcher({ search, filters, sortKey: sort?.key, sortDir: sort?.dir, page, pageSize: size })
      .then((res) => {
        if (ticket !== latest.current) return; // a newer request won
        setRows(res.rows);
        setTotal(res.total);
        setRefreshedAt(res.refreshedAt);
        setSelected((sel) => sel.filter((id) => res.rows.some((r) => r.id === id)));
      })
      .catch((e: unknown) => {
        if (ticket !== latest.current) return;
        setError(e instanceof Error ? e.message : "Could not load this data.");
        setRows([]);
        setTotal(0);
      })
      .finally(() => { if (ticket === latest.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters, sort, page, size, nonce]);

  // any query change resets to page 1
  const setSearch = useCallback((v: string) => { setPage(1); setSearchRaw(v); }, []);
  const setFilters = useCallback((f: Record<string, string>) => { setPage(1); setFiltersRaw(f); }, []);
  const removeFilter = useCallback((key: string) => {
    setPage(1);
    setFiltersRaw((f) => { const n = { ...f }; delete n[key]; return n; });
  }, []);
  const clearFilters = useCallback(() => { setPage(1); setFiltersRaw({}); }, []);
  const toggleSort = useCallback((key: string) => {
    setPage(1);
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  }, []);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  /** v2: re-fetch in the background — rows stay on screen (no skeleton), so keyboard focus is not lost. */
  const reload = useCallback(() => { quietNext.current = true; setNonce((n) => n + 1); }, []);

  const pages = Math.max(1, Math.ceil(total / size));
  const activeFilters = useMemo(
    () => Object.entries(filters).filter(([, v]) => v).map(([k, v]) => ({ key: k, value: v })),
    [filters],
  );

  return {
    rows, total, loading, error, refreshedAt,
    search, setSearch,
    filters, setFilters, removeFilter, clearFilters, activeFilters,
    sort, toggleSort, setSort: (s: { key: string; dir: SortDir } | null) => { setPage(1); setSort(s); },
    page, setPage, pages, pageSize: size, setPageSize: (n: number) => { setPage(1); setSize(n); },
    selected, setSelected,
    refresh, reload,
  };
}

/* ══════════════════════════════════════════════════════
   COLUMN + TABLE
   ══════════════════════════════════════════════════════ */
/** Optional banded header above the column row (LEAD / PAID APPLICATIONS / …). */
export type ColumnGroup = { id: string; label: string; span: number; tone?: string; info?: boolean };

export type Column<T> = {
  id: string;                       // unique per column (also the sort key)
  header: ReactNode;
  align?: "left" | "right" | "center";
  width?: number;
  sortable?: boolean;
  sticky?: boolean;                 // pins the column while scrolling sideways
  cell: (row: T) => ReactNode;
};

export function DataTable<T extends { id: string }>({
  columns, groups, rows, loading, error, minWidth = 900,
  selectable, selected = [], onSelect,
  sort, onSort, onRetry, emptyTitle = "No records found", emptyBody, rowActions, rowClassName,
  touch, empty, rowLabel, label, card, onSortTo,
}: {
  columns: Column<T>[];
  groups?: ColumnGroup[];
  rows: T[];
  loading?: boolean;
  error?: string | null;
  minWidth?: number;
  selectable?: boolean;
  selected?: string[];
  onSelect?: (ids: string[]) => void;
  sort?: { key: string; dir: SortDir } | null;
  onSort?: (key: string) => void;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyBody?: string;
  rowActions?: (row: T) => ReactNode;
  rowClassName?: (row: T) => string;
  /** v2: 44px tap targets on phones, focus rings, keyboard-scrollable region, shared ErrorState. */
  touch?: boolean;
  /** v2: replaces the empty row's content (use <EmptyState/> with one main action). */
  empty?: ReactNode;
  /** v2: accessible name for a row's checkbox, e.g. (r) => `list ${r.name}`. */
  rowLabel?: (row: T) => string;
  /** v2: accessible name for the scrolling table region. */
  label?: string;
  /** v2: on phones, show each row as a card instead of a table. Return the card body; the checkbox and row actions are added around it. */
  card?: (row: T) => ReactNode;
  /** v2: lets the phone card view offer a "Sort by" dropdown (cards have no column headers). */
  onSortTo?: (s: { key: string; dir: SortDir } | null) => void;
}) {
  const phone = useIsPhone();
  const allOn = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const someOn = !allOn && rows.some((r) => selected.includes(r.id));
  const headRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (headRef.current) headRef.current.indeterminate = someOn; }, [someOn]);

  const toggleAll = () => onSelect?.(allOn ? [] : rows.map((r) => r.id));
  const toggleOne = (id: string) =>
    onSelect?.(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  const span = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);

  if (touch && card && phone) {
    const sortable = columns.filter((c) => c.sortable && typeof c.header === "string");
    const sortValue = sort ? `${sort.key}:${sort.dir}` : "";
    return (
      <section aria-label={label ?? "Data"} aria-busy={loading || undefined}>
        {(selectable || (onSortTo && sortable.length > 0)) && !loading && !error && rows.length > 0 && (
          <div className="mb-2 flex items-center gap-2">
            {selectable && (
              <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 rounded-lg pr-2 font-body text-sm text-foreground focus-within:outline focus-within:outline-2 focus-within:outline-accent-soft">
                <span className="grid h-11 w-11 place-items-center">
                  <input ref={headRef} type="checkbox" checked={allOn} onChange={toggleAll} className="h-4 w-4 cursor-pointer accent-[#8A18FF]" />
                </span>
                All
              </label>
            )}
            {onSortTo && sortable.length > 0 && (
              <div className="min-w-0 flex-1">
                <Select touch ariaLabel="Sort by" placeholder="Sort: default order" value={sortValue}
                  options={sortable.flatMap((c) => [
                    { value: `${c.id}:asc`, label: `${c.header as string} (A → Z)` },
                    { value: `${c.id}:desc`, label: `${c.header as string} (Z → A)` },
                  ])}
                  onChange={(v) => { if (!v) onSortTo(null); else { const [key, dir] = v.split(":"); onSortTo({ key, dir: dir as SortDir }); } }} />
              </div>
            )}
          </div>
        )}
        {loading ? (
          <ul className="space-y-2.5" aria-label="Loading">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="rounded-xl border border-border bg-surface p-4">
                <Skeleton className="h-4 w-40" /><Skeleton className="mt-3 h-3 w-56" /><Skeleton className="mt-3 h-8 w-full" />
              </li>
            ))}
          </ul>
        ) : error ? (
          onRetry ? <ErrorState title="Couldn’t load this data" message={error} onRetry={onRetry} /> : null
        ) : rows.length === 0 ? (
          empty
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => {
              const on = selected.includes(r.id);
              return (
                <li key={r.id} className={`rounded-xl border p-2 pr-1 transition-colors ${on ? "border-accent/60 bg-surface-warm/60" : "border-border bg-surface"} ${rowClassName?.(r) ?? ""}`}>
                  <div className="flex items-start gap-1">
                    {selectable && (
                      <label className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg focus-within:outline focus-within:outline-2 focus-within:outline-accent-soft">
                        <input type="checkbox" checked={on} onChange={() => toggleOne(r.id)}
                          aria-label={`Select ${rowLabel?.(r) ?? `row ${r.id}`}`} className="h-4 w-4 cursor-pointer accent-[#8A18FF]" />
                      </label>
                    )}
                    <div className="min-w-0 flex-1 pt-1">{card(r)}</div>
                    {rowActions && <div className="shrink-0">{rowActions(r)}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className={`overflow-x-auto rounded-2xl border border-border bg-surface ${touch ? FOCUS_RING : ""}`}
      {...(touch ? { role: "region", "aria-label": label ?? "Data table", tabIndex: 0 } : {})}>
      <table className="w-full border-collapse text-left" style={{ minWidth }} aria-busy={touch && loading ? true : undefined}>
        <thead className="sticky top-0 z-10 bg-surface">
          {groups && (
            <tr className="border-b border-border">
              {selectable && <th className="bg-surface" />}
              {groups.map((g) => (
                <th key={g.id} colSpan={g.span}
                  style={{ background: g.tone ? `${g.tone}1a` : undefined, color: g.tone }}
                  className={`border-l border-border px-4 py-2.5 text-center font-mono text-[10px] font-bold uppercase tracking-wider first:border-l-0 ${g.tone ? "" : "text-muted"}`}>
                  <span className="inline-flex items-center gap-1">
                    {g.label}
                    {g.info && <Icon name="info" className="h-3 w-3 opacity-60" />}
                  </span>
                </th>
              ))}
              {rowActions && <th className="bg-surface" />}
            </tr>
          )}
          <tr className="border-b border-border">
            {selectable && (
              <th className={touch ? "w-12 px-1" : "w-11 px-4 py-3"}>
                {touch ? (
                  <label className={`grid h-11 w-11 cursor-pointer place-items-center rounded-lg focus-within:outline focus-within:outline-2 focus-within:outline-accent-soft`}>
                    <input ref={headRef} type="checkbox" checked={allOn} onChange={toggleAll}
                      aria-label="Select all rows on this page" className="h-4 w-4 cursor-pointer accent-[#8A18FF]" />
                  </label>
                ) : (
                  <input ref={headRef} type="checkbox" checked={allOn} onChange={toggleAll}
                    aria-label="Select all rows on this page" className="h-3.5 w-3.5 cursor-pointer accent-[#8A18FF]" />
                )}
              </th>
            )}
            {columns.map((c) => {
              const on = sort?.key === c.id;
              return (
                <th key={c.id} style={{ textAlign: c.align ?? "left", width: c.width }}
                  aria-sort={touch && c.sortable ? (on ? (sort!.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
                  className={`whitespace-nowrap px-4 ${touch ? "py-0" : "py-3"} font-mono text-[10px] font-semibold uppercase tracking-wider text-muted ${c.sticky ? "sticky left-0 z-10 bg-surface" : ""}`}>
                  {c.sortable && onSort ? (
                    <button type={touch ? "button" : undefined} onClick={() => onSort(c.id)}
                      className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${touch ? `min-h-[44px] rounded sm:min-h-0 sm:py-3 ${FOCUS_RING}` : ""} ${on ? "text-accent" : ""}`}>
                      {c.header}
                      <Icon name={on ? (sort!.dir === "asc" ? "sortAsc" : "sortDesc") : "sort"} className="h-3 w-3" />
                    </button>
                  ) : c.header}
                </th>
              );
            })}
            {rowActions && <th className={`w-16 px-4 ${touch ? "sticky right-0 z-10 border-l border-border/60 bg-surface py-0" : "py-3"} text-right font-mono text-[10px] font-semibold uppercase tracking-wider text-muted`}>Action</th>}
          </tr>
        </thead>

        <tbody>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                {Array.from({ length: span }).map((__, j) => (
                  <td key={j} className="px-4 py-3.5">
                    <div className="h-3 animate-pulse rounded bg-surface-warm" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} />
                  </td>
                ))}
              </tr>
            ))
          ) : error ? (
            <tr>
              {touch && onRetry ? (
                <td colSpan={span} className="p-4"><ErrorState title="Couldn’t load this data" message={error} onRetry={onRetry} /></td>
              ) : (
              <td colSpan={span} className="px-4 py-16 text-center">
                <Icon name="alert" className="mx-auto h-7 w-7 text-[#f87171]" />
                <p className="mt-3 font-display text-base font-bold text-heading">Couldn&apos;t load this data</p>
                <p className="mt-1 font-body text-sm text-muted">{error}</p>
                {onRetry && <div className="mt-4 flex justify-center"><Button icon="refresh" onClick={onRetry}>Try again</Button></div>}
              </td>
              )}
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              {empty ? (
                <td colSpan={span} className="p-4">{empty}</td>
              ) : (
              <td colSpan={span} className="px-4 py-16 text-center">
                <Icon name="inbox" className="mx-auto h-7 w-7 text-muted" />
                <p className="mt-3 font-display text-base font-bold text-heading">{emptyTitle}</p>
                <p className="mt-1 font-body text-sm text-muted">{emptyBody ?? "Try changing your search or filters."}</p>
              </td>
              )}
            </tr>
          ) : (
            rows.map((r) => {
              const on = selected.includes(r.id);
              return (
                <tr key={r.id} className={`border-b border-border/60 transition-colors last:border-0 ${on ? "bg-surface-warm/60" : "hover:bg-surface-warm/35"} ${rowClassName?.(r) ?? ""}`}>
                  {selectable && (
                    <td className={touch ? "px-1" : "px-4 py-3"}>
                      {touch ? (
                        <label className="grid h-11 w-11 cursor-pointer place-items-center rounded-lg focus-within:outline focus-within:outline-2 focus-within:outline-accent-soft">
                          <input type="checkbox" checked={on} onChange={() => toggleOne(r.id)}
                            aria-label={`Select ${rowLabel?.(r) ?? `row ${r.id}`}`} className="h-4 w-4 cursor-pointer accent-[#8A18FF]" />
                        </label>
                      ) : (
                        <input type="checkbox" checked={on} onChange={() => toggleOne(r.id)}
                          aria-label={`Select row ${r.id}`} className="h-3.5 w-3.5 cursor-pointer accent-[#8A18FF]" />
                      )}
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.id} style={{ textAlign: c.align ?? "left" }}
                      className={`whitespace-nowrap px-4 ${touch ? "py-1.5" : "py-3"} font-body text-[13px] text-foreground ${c.sticky ? `sticky left-0 z-[5] ${on ? "bg-[#221a55]" : "bg-surface"}` : ""}`}>
                      {c.cell(r) ?? <Dash />}
                    </td>
                  ))}
                  {rowActions && <td className={`px-4 text-right ${touch ? `sticky right-0 z-[5] border-l border-border/60 py-1.5 ${on ? "bg-[#221a55]" : "bg-surface"}` : "py-3"}`}>{rowActions(r)}</td>}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   PAGINATION
   ══════════════════════════════════════════════════════ */
export function Pagination({ page, pages, total, pageSize, onPage, onPageSize, touch }: {
  page: number; pages: number; total: number; pageSize: number;
  onPage: (p: number) => void; onPageSize: (n: number) => void;
  /** v2: 44px buttons / select on phones + focus rings. */
  touch?: boolean;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 font-body text-sm text-muted">
      <span>Showing <span className="text-foreground">{from}–{to}</span> of <span className="text-foreground">{total.toLocaleString("en-IN")}</span></span>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">Rows
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}
            className={`rounded-md border border-border bg-surface px-2 py-1 text-foreground outline-none ${touch ? `min-h-[44px] sm:min-h-0 ${FOCUS_RING}` : ""}`}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"
            className={`grid place-items-center rounded-md border border-border text-muted transition-colors hover:text-foreground disabled:opacity-30 ${touch ? `h-11 w-11 sm:h-8 sm:w-8 ${FOCUS_RING}` : "h-8 w-8"}`}>
            <Icon name="chevronLeft" className="h-3.5 w-3.5" />
          </button>
          <span className="px-2 font-mono text-xs text-foreground" aria-live={touch ? "polite" : undefined}>{page} / {pages}</span>
          <button onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page"
            className={`grid place-items-center rounded-md border border-border text-muted transition-colors hover:text-foreground disabled:opacity-30 ${touch ? `h-11 w-11 sm:h-8 sm:w-8 ${FOCUS_RING}` : "h-8 w-8"}`}>
            <Icon name="chevronRight" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   BULK ACTION BAR — appears when rows are selected
   ══════════════════════════════════════════════════════ */
export function BulkBar({ count, onClear, children, touch }: { count: number; onClear: () => void; children: ReactNode; touch?: boolean }) {
  if (count === 0) return null;
  return (
    <div role={touch ? "region" : undefined} aria-label={touch ? "Bulk actions" : undefined} className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-surface-warm/60 px-4 py-2.5">
      <span className="font-body text-sm font-semibold text-heading">{count} selected</span>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <Button variant="ghost" size="sm" touch={touch} onClick={onClear}>Clear</Button>
      </div>
    </div>
  );
}
