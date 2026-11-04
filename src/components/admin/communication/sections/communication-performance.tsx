"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, RefreshStamp, Button, FilterChips, useToast } from "../ui/primitives";
import { FilterPanel, toChips, type FilterField } from "../ui/filter-panel";
import { EmptyState, ErrorState, InlineError } from "../ui/states";
import { useOptions } from "../ui/use-options";
import { performanceApi, downloadCsv } from "../lib/mock-api";
import type { PerformanceSummary } from "../lib/types";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: PerformanceSummary };
const compact = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n));

/**
 * COMMUNICATION PERFORMANCE (v2)
 * Every number here is built from the jobs in Manage Communication Logs (see `performanceApi.summary` in lib/mock-api.ts),
 * so the two screens always agree. Swap that one call for the real endpoint.
 */
export function CommunicationPerformance() {
  const { toast, toastNode } = useToast({ safe: true });
  const opts = useOptions(performanceApi.options);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const ticket = useRef(0);

  const run = useCallback(() => {
    const mine = ++ticket.current;
    setLoad({ status: "loading" });
    performanceApi.summary({ filters })
      .then((data) => { if (mine === ticket.current) setLoad({ status: "ready", data }); })
      .catch((e: unknown) => { if (mine === ticket.current) setLoad({ status: "error", message: e instanceof Error && e.message ? e.message : "Could not load the performance numbers." }); });
  }, [filters]);
  // the cleanup must see the *latest* ticket value on purpose: it invalidates any request still in flight
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); return () => { ticket.current++; }; }, [run]);

  const o = opts.options;
  const fields: FilterField[] = [
    { kind: "select", key: "channel", placeholder: "Select Medium of Communication", options: o.channel ?? [] },
    { kind: "daterange", key: "startDate", placeholder: "Communication Date" },
    { kind: "select", key: "template", placeholder: "Select Template", options: o.template ?? [] },
    { kind: "select", key: "commFor", placeholder: "Select Communication For", options: o.commFor ?? [] },
    { kind: "select", key: "sentBy", placeholder: "Select Sent By", options: o.sentBy ?? [] },
  ];
  const filtered = Object.values(filters).some(Boolean);
  const clearAll = () => setFilters({});

  const data = load.status === "ready" ? load.data : null;
  const loading = load.status === "loading";
  const T = data?.totals;
  const rate = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const empty = !!data && data.basis.counted === 0;

  const funnel = T ? [
    { label: "Sent", value: T.sent, color: "#F97D03" },
    { label: "Delivered", value: T.delivered, color: "#4ade80" },
    { label: "Read", value: T.read, color: "#8A18FF" },
    { label: "Clicked", value: T.clicked, color: "#60a5fa" },
  ] : [];
  const trendMax = data ? Math.max(1, ...data.trend.map((p) => p.sent)) : 1;

  const download = () => {
    if (!data || empty) return;
    downloadCsv(`communication-performance-${Date.now()}.csv`,
      ["Channel", "Sent", "Delivered", "Read", "Clicked", "Delivery %", "Read %", "Click %"],
      data.byChannel.map((c) => [c.channel, c.sent, c.delivered, c.read, c.clicked, rate(c.delivered, c.sent), rate(c.read, c.sent), rate(c.clicked, c.sent)]));
    toast("Downloaded the channel summary");
  };

  const b = data?.basis;
  const skipped = b ? [
    b.scheduled ? `${b.scheduled} scheduled` : "", b.inProgress ? `${b.inProgress} in progress` : "", b.voice ? `${b.voice} Amplify voice` : "",
  ].filter(Boolean) : [];

  return (
    <>
      <PageHeader
        title="Communication Performance"
        meta={<RefreshStamp touch at={data?.refreshedAt ?? ""} onRefresh={run} busy={loading} />}
        actions={
          <>
            <Button touch icon="filter" active={filtered} onClick={() => setFilterOpen(true)}>Filter</Button>
            <Button touch variant="solid" icon="download" disabled={!data || empty} onClick={download}>Download</Button>
          </>
        }
      />

      {opts.state.status === "error" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
          <InlineError>{opts.state.message}</InlineError>
          <Button size="sm" touch icon="refresh" onClick={opts.reload}>Try again</Button>
        </div>
      )}

      <FilterChips touch chips={toChips(filters, fields)}
        onRemove={(k) => setFilters((f) => { const n = { ...f }; delete n[k]; return n; })}
        onClear={clearAll} />

      {b && !empty && (
        <p className="mb-4 font-body text-xs text-muted" data-basis>
          Built from <span className="font-semibold text-foreground">{b.counted}</span> of {b.matched} jobs in Manage Communication Logs.
          {skipped.length > 0 && <> Not counted: {skipped.join(", ")} (no delivery numbers yet).</>}
        </p>
      )}

      {load.status === "error" ? (
        <ErrorState title="Couldn’t load the performance numbers" message={load.message} onRetry={run} />
      ) : empty ? (
        <EmptyState icon="chart" title="No sends to show"
          body={filtered ? "No finished job in Manage Communication Logs matches these filters. Clear them to see every job." : "Numbers appear here once a job in Manage Communication Logs has finished sending."}
          action={filtered ? { label: "Clear filters", icon: "refresh", onClick: clearAll } : { label: "Refresh", icon: "refresh", onClick: run }} />
      ) : (
        <div aria-busy={loading || undefined}>
          {/* KPI row */}
          <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {(["sent", "delivered", "read", "clicked", "failed"] as const).map((k) => {
              const tone = { sent: "text-heading", delivered: "text-[#4ade80]", read: "text-accent", clicked: "text-[#60a5fa]", failed: "text-[#f87171]" }[k];
              return (
                <div key={k} className="rounded-2xl border border-border bg-surface p-4">
                  <dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
                  <dd className={`mt-1 font-display text-2xl font-extrabold ${tone}`}>
                    {loading || !T ? <span className="inline-block h-6 w-16 animate-pulse rounded bg-surface-warm" role="status" aria-label="Loading" /> : T[k].toLocaleString("en-IN")}
                  </dd>
                  {T && k !== "sent" && <div className="mt-0.5 font-mono text-[10px] text-muted">{rate(T[k], T.sent)}% of sent</div>}
                </div>
              );
            })}
          </dl>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* funnel */}
            <section aria-labelledby="perf-funnel" className="rounded-2xl border border-border bg-surface p-5">
              <h2 id="perf-funnel" className="mb-4 font-display text-base font-bold text-heading">Delivery funnel</h2>
              {loading || !T ? <Skeleton rows={4} /> : (
                <div className="space-y-4">
                  {funnel.map((f, i) => (
                    <div key={f.label}>
                      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 font-body text-[13px]">
                        <span className="font-semibold text-heading">{f.label}</span>
                        <span className="font-mono text-xs text-muted">
                          {f.value.toLocaleString("en-IN")}
                          {i > 0 && <span className="ml-2 text-foreground">{rate(f.value, funnel[i - 1].value)}% of {funnel[i - 1].label.toLowerCase()}</span>}
                        </span>
                      </div>
                      <div className="h-6 overflow-hidden rounded-lg bg-surface-warm" aria-hidden="true">
                        <div className="h-full rounded-lg transition-all" style={{ width: `${Math.max(rate(f.value, T.sent), 2)}%`, background: f.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* by channel */}
            <section aria-labelledby="perf-channel" className="rounded-2xl border border-border bg-surface p-5">
              <h2 id="perf-channel" className="mb-4 font-display text-base font-bold text-heading">By channel</h2>
              {loading || !data ? <Skeleton rows={3} /> : (
                <div className="space-y-4">
                  {data.byChannel.map((c) => (
                    <div key={c.channel}>
                      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 font-body text-[13px]">
                        <span className="font-semibold text-heading">{c.channel}</span>
                        <span className="font-mono text-xs text-muted">
                          {c.sent.toLocaleString("en-IN")} sent · <span className="text-[#4ade80]">{rate(c.delivered, c.sent)}% delivered</span> ·{" "}
                          <span className="text-accent">{rate(c.read, c.sent)}% read</span> · <span className="text-[#60a5fa]">{rate(c.clicked, c.sent)}% clicked</span>
                        </span>
                      </div>
                      <div className="flex h-6 overflow-hidden rounded-lg bg-surface-warm" aria-hidden="true">
                        <div className="h-full bg-[#4ade80]/80" style={{ width: `${rate(c.delivered - c.read, c.sent)}%` }} />
                        <div className="h-full bg-accent" style={{ width: `${rate(c.read - c.clicked, c.sent)}%` }} />
                        <div className="h-full bg-[#60a5fa]" style={{ width: `${rate(c.clicked, c.sent)}%` }} />
                      </div>
                    </div>
                  ))}
                  <Legend />
                </div>
              )}
            </section>
          </div>

          {/* trend */}
          <section aria-labelledby="perf-trend" className="mt-4 rounded-2xl border border-border bg-surface p-5">
            <h2 id="perf-trend" className="mb-4 font-display text-base font-bold text-heading">Volume trend</h2>
            {loading || !data ? <Skeleton rows={2} /> : (
              <ul className="flex h-52 items-end gap-2 sm:gap-6" aria-label="Sent and delivered per period">
                {data.trend.map((p) => (
                  <li key={p.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                    aria-label={`${p.label}: ${p.sent.toLocaleString("en-IN")} sent, ${p.delivered.toLocaleString("en-IN")} delivered`}>
                    <div className="flex min-h-0 w-full flex-1 items-end justify-center gap-1" aria-hidden="true">
                      <div className="w-1/3 rounded-t bg-surface-warm transition-all" style={{ height: `${Math.max((p.sent / trendMax) * 100, 2)}%` }} title={`Sent ${p.sent}`} />
                      <div className="w-1/3 rounded-t bg-brand-gradient transition-all" style={{ height: `${Math.max((p.delivered / trendMax) * 100, 2)}%` }} title={`Delivered ${p.delivered}`} />
                    </div>
                    <span className="font-mono text-[10px] text-foreground" aria-hidden="true">{compact(p.sent)} / {compact(p.delivered)}</span>
                    <span className="max-w-full truncate font-mono text-[10px] text-muted" aria-hidden="true">{p.label}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-center gap-4 font-body text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-surface-warm" /> Sent</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-gradient" /> Delivered</span>
            </div>
          </section>
        </div>
      )}

      <FilterPanel touch open={filterOpen} fields={fields} value={filters} onClose={() => setFilterOpen(false)} onApply={setFilters} />
      {toastNode}
    </>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 pt-1 font-body text-xs text-muted">
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#4ade80]/80" /> Delivered, not read</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Read</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#60a5fa]" /> Clicked</span>
    </div>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i}>
          <div className="mb-1 h-3 w-24 animate-pulse rounded bg-surface-warm" />
          <div className="h-6 animate-pulse rounded-lg bg-surface-warm" />
        </div>
      ))}
    </div>
  );
}
