"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PageHeader, RefreshStamp, SearchBox, Button, Icon, Drawer, Select, TextArea,
  ConfirmDialog, FilterChips, Menu, FOCUS_RING, useToast,
} from "../ui/primitives";
import { DataTable, Pagination, BulkBar, useTableQuery, type Column } from "../ui/data-table";
import { FilterPanel, toChips, type FilterField } from "../ui/filter-panel";
import { Field } from "../ui/form";
import { EmptyState } from "../ui/states";
import { tabId, tabPanelProps } from "../ui/tabs";
import { rangeLabel } from "../ui/date-range-field";
import { suppressionsApi, downloadCsv } from "../lib/mock-api";
import type { SuppressionRow } from "../lib/types";

type Reason = SuppressionRow["reason"];
const REASONS: Reason[] = ["Unsubscribe", "Bounce", "Block", "Spam", "Invalid"];
const CHANNELS = [
  { key: "Email", sub: "Manage your Email suppressions" },
  { key: "WhatsApp", sub: "Manage your WhatsApp opt-out" },
] as const;
const MAX_AT_ONCE = 10;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
const DATE_FIELDS: FilterField[] = [{ kind: "daterange", key: "addedDate", placeholder: "Date" }];

/** Splits what was typed into separate contacts (commas, semicolons or new lines). */
const parse = (text: string) => text.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
const validNumber = (v: string) => /^\d{10,15}$/.test(v.replace(/[\s+()-]/g, ""));

/**
 * SUPPRESSIONS (v2)
 * Email has five lists (Unsubscribe, Bounce, Block, Spam, Invalid); WhatsApp has one (Opt-Out, with the keyword the person replied).
 * A date range narrows every list. Add takes up to 10 contacts at once with inline checks; Remove asks first.
 * Data comes from `suppressionsApi` (lib/mock-api.ts), which keeps changes in memory — swap it for the real endpoint.
 */
export function Suppressions() {
  const t = useTableQuery<SuppressionRow>({ fetcher: suppressionsApi.list, pageSize: 10, initialFilters: { channel: "Email", reason: "Unsubscribe" } });
  const { toast, toastNode } = useToast({ safe: true });

  const [channel, setChannel] = useState<"Email" | "WhatsApp">("Email");
  const [reason, setReason] = useState<Reason>("Unsubscribe");
  const [date, setDate] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ text: "", reason: "Unsubscribe" as Reason });
  const [tried, setTried] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isEmail = channel === "Email";
  const reasons = isEmail ? REASONS : (["Unsubscribe"] as Reason[]);
  const reasonName = (r: Reason) => (isEmail ? r : "Opt-Out");

  // channel + reason + date are the query, so the table always matches the tabs
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; } // the table already started with these filters
    t.setFilters({ channel, reason, ...(date ? { addedDate: date } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, reason, date]);

  useEffect(() => {
    let live = true;
    suppressionsApi.counts(channel, t.search, date || undefined).then((c) => live && setCounts(c)).catch(() => live && setCounts(null));
    return () => { live = false; };
  }, [channel, t.search, date, t.refreshedAt]);

  const filtered = !!t.search || !!date;
  const clearAll = () => { t.setSearch(""); setDate(""); };

  // ---- add: inline checks ----
  const items = useMemo(() => parse(draft.text), [draft.text]);
  const bad = useMemo(() => items.filter((x) => (isEmail ? !EMAIL.test(x) : !validNumber(x))), [items, isEmail]);
  const addIssue =
    items.length === 0 ? (isEmail ? "Enter at least one email address." : "Enter at least one mobile number.")
      : items.length > MAX_AT_ONCE ? `You can add up to ${MAX_AT_ONCE} at a time. You entered ${items.length}.`
        : bad.length > 0 ? `${isEmail ? "Not a valid email address" : "Not a valid mobile number"}: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? ` and ${bad.length - 3} more` : ""}.`
          : null;

  const openAdd = () => { setDraft({ text: "", reason }); setTried(false); setAddError(null); setAddOpen(true); };
  const submitAdd = async () => {
    setTried(true);
    if (addIssue) return;
    setAdding(true); setAddError(null);
    try {
      const r = await suppressionsApi.add(channel, items, isEmail ? draft.reason : "Unsubscribe");
      setAddOpen(false);
      if (isEmail && draft.reason !== reason) setReason(draft.reason); else t.reload();
      toast(`${r.added} added${r.duplicates ? ` · ${r.duplicates} already on the list` : ""}`);
    } catch (e) {
      setAddError(e instanceof Error && e.message ? e.message : "Could not add. Try again.");
    } finally { setAdding(false); }
  };

  // ---- remove ----
  const askRemove = (ids: string[], label: string) => { setRemoveError(null); setConfirm({ ids, label }); };
  const doRemove = async () => {
    if (!confirm) return;
    setRemoving(true); setRemoveError(null);
    try {
      const r = await suppressionsApi.remove(confirm.ids);
      setConfirm(null); t.setSelected([]); t.reload();
      toast(`Removed ${r.removed} ${r.removed === 1 ? "entry" : "entries"}`);
      requestAnimationFrame(() => listRef.current?.focus());
    } catch (e) {
      setRemoveError(e instanceof Error && e.message ? e.message : "Could not remove. Try again.");
    } finally { setRemoving(false); }
  };

  const columns: Column<SuppressionRow>[] = [
    { id: "contact", header: isEmail ? "Email Id" : "Mobile Number", sortable: true, sticky: true, width: 280, cell: (r) => <span className="font-body">{r.contact}</span> },
    isEmail
      ? { id: "source", header: "Source", cell: (r) => <span className="text-muted">{r.source}</span> }
      : { id: "keyword", header: "Opt-Out Keyword", sortable: true, cell: (r) => r.keyword ?? "—" },
    { id: "stamp", header: isEmail ? `${reason} Date` : "Opt-Out Date", sortable: true, align: "right", cell: (r) => r.addedOn },
  ];

  const exportRows = (rows: SuppressionRow[]) =>
    downloadCsv(`suppressions-${channel.toLowerCase()}-${reasonName(reason).toLowerCase()}.csv`,
      [isEmail ? "Email Id" : "Mobile Number", "Channel", "List", isEmail ? "Source" : "Opt-Out Keyword", "Added On"],
      rows.map((r) => [r.contact, r.channel, reasonName(r.reason), isEmail ? r.source : r.keyword ?? "", r.addedOn]));

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const moveTab = (to: number) => {
    const r = reasons[(to + reasons.length) % reasons.length];
    setReason(r); t.setSelected([]); tabRefs.current[r]?.focus();
  };
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") { e.preventDefault(); moveTab(i + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); moveTab(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); moveTab(0); }
    else if (e.key === "End") { e.preventDefault(); moveTab(reasons.length - 1); }
  };

  const dateChips = toChips(date ? { addedDate: date } : {}, DATE_FIELDS);
  const trash = (r: SuppressionRow) => (
    <button type="button" onClick={() => askRemove([r.id], r.contact)} aria-label={`Remove ${r.contact}`}
      className={`grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-[#3d1414] hover:text-[#f87171] sm:h-8 sm:w-8 ${FOCUS_RING}`}>
      <Icon name="trash" className="h-4 w-4" />
    </button>
  );

  return (
    <>
      <PageHeader
        title="Suppression Management"
        count={t.loading ? null : t.total}
        countLabel={`${reasonName(reason)} ${t.total === 1 ? "entry" : "entries"}`}
        meta={<RefreshStamp touch at={t.refreshedAt} onRefresh={t.refresh} busy={t.loading} />}
        actions={
          <>
            <div className="w-full sm:w-auto"><SearchBox touch placeholder={isEmail ? "Search email" : "Search number"} value={t.search} onChange={t.setSearch} /></div>
            <Button touch icon="calendar" active={!!date} onClick={() => setDateOpen(true)}>{date ? rangeLabel(date) : "All time"}</Button>
            <Button touch icon="download" disabled={t.rows.length === 0} onClick={() => { exportRows(t.rows); toast(`Downloaded ${t.rows.length} entr${t.rows.length === 1 ? "y" : "ies"}`); }}>Download</Button>
            <Button touch variant="solid" icon="plus" onClick={openAdd}>Add</Button>
            <Menu
              align="right"
              touch
              items={[{
                label: "Remove from list", icon: "trash", danger: true,
                onClick: () => (t.selected.length === 0
                  ? toast("Tick one or more entries first, then choose Remove from list.")
                  : askRemove(t.selected, `${t.selected.length} ${t.selected.length === 1 ? "entry" : "entries"}`)),
              }]}
              trigger={(open, toggle) => (
                <Button touch popup expanded={open} icon="dots" active={open} onClick={toggle}><span className="sr-only">More actions</span></Button>
              )}
            />
          </>
        }
      />

      <FilterChips touch chips={dateChips} onRemove={() => setDate("")} onClear={() => setDate("")} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* channel rail */}
        <nav aria-label="Channel" className="grid h-fit grid-cols-2 gap-1 rounded-2xl border border-border bg-surface p-2 lg:grid-cols-1">
          {CHANNELS.map((c) => {
            const on = channel === c.key;
            return (
              <button key={c.key} type="button" aria-current={on ? "true" : undefined}
                onClick={() => { setChannel(c.key); setReason("Unsubscribe"); t.setSelected([]); }}
                className={`min-h-[44px] w-full rounded-xl px-3 py-2.5 text-left transition-colors ${FOCUS_RING} ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
                <span className="flex items-center gap-2">
                  <Icon name={c.key === "Email" ? "mail" : "whatsapp"} className={`h-3.5 w-3.5 ${on ? "text-accent" : "text-muted"}`} />
                  <span className={`font-body text-sm font-bold ${on ? "text-accent" : "text-foreground"}`}>{c.key}</span>
                </span>
                <span className="mt-0.5 block font-body text-[11px] text-muted">{c.sub}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {/* list tabs with live counts */}
          <div role="tablist" aria-label={`${channel} lists`} className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
            {reasons.map((r, i) => {
              const on = reason === r;
              return (
                <button key={r} ref={(el) => { tabRefs.current[r] = el; }} type="button" role="tab" id={tabId("sup", r)}
                  aria-selected={on} aria-controls={`sup-panel-${r}`} tabIndex={on ? 0 : -1}
                  onClick={() => { setReason(r); t.setSelected([]); }} onKeyDown={(e) => onTabKey(e, i)}
                  className={`-mb-px inline-flex min-h-[44px] shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2 font-body text-sm font-semibold transition-colors sm:min-h-0 ${FOCUS_RING} ${
                    on ? "border-accent text-heading" : "border-transparent text-muted hover:text-foreground"}`}>
                  {reasonName(r)}
                  <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold ${on ? "bg-surface-warm text-accent" : "bg-surface-warm text-muted"}`}>
                    {counts ? counts[r] ?? 0 : "·"}
                  </span>
                </button>
              );
            })}
          </div>

          <div {...tabPanelProps("sup", reason)} id={`sup-panel-${reason}`} ref={listRef} className={`outline-none ${FOCUS_RING}`} aria-label={`${channel} ${reasonName(reason)} list`}>
            <BulkBar touch count={t.selected.length} onClear={() => t.setSelected([])}>
              <Button size="sm" touch icon="download" onClick={() => { exportRows(t.rows.filter((r) => t.selected.includes(r.id))); toast(`Downloaded ${t.selected.length} entr${t.selected.length === 1 ? "y" : "ies"}`); }}>Download</Button>
              <Button size="sm" touch variant="danger" icon="trash" onClick={() => askRemove(t.selected, `${t.selected.length} ${t.selected.length === 1 ? "entry" : "entries"}`)}>Remove</Button>
            </BulkBar>

            <DataTable
              touch
              label={`${channel} ${reasonName(reason)} list`}
              rowLabel={(r) => r.contact}
              columns={columns} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.refresh}
              minWidth={isEmail ? 680 : 640} selectable selected={t.selected} onSelect={t.setSelected}
              sort={t.sort} onSort={t.toggleSort} onSortTo={t.setSort}
              card={(r) => (
                <div className="min-w-0">
                  <p className="break-all font-body text-sm font-semibold text-heading">{r.contact}</p>
                  <p className="mt-1 font-body text-xs text-muted">
                    {isEmail ? `${reason} date` : "Opt-out date"}: <span className="text-foreground">{r.addedOn}</span>
                  </p>
                  <p className="mt-0.5 font-body text-xs text-muted">
                    {isEmail ? "Source" : "Keyword"}: <span className="text-foreground">{isEmail ? r.source : r.keyword ?? "—"}</span>
                  </p>
                </div>
              )}
              empty={filtered
                ? <EmptyState icon="search" title="No records found" body={`Nothing under ${reasonName(reason)} matches this search and date range. Clear them to see the whole list.`}
                    action={{ label: "Clear search and date", icon: "refresh", onClick: clearAll }} />
                : <EmptyState icon="inbox" title="No records found" body={`Nothing is suppressed under ${reasonName(reason)} for ${channel} right now.`}
                    action={{ label: "Refresh", icon: "refresh", onClick: t.refresh }} />}
              rowActions={trash}
            />

            <Pagination touch page={t.page} pages={t.pages} total={t.total} pageSize={t.pageSize} onPage={t.setPage} onPageSize={t.setPageSize} />
          </div>
        </div>
      </div>

      {/* date range (same drawer pattern as the other screens: quick ranges + custom) */}
      <FilterPanel touch open={dateOpen} fields={DATE_FIELDS} value={date ? { addedDate: date } : {}}
        onClose={() => setDateOpen(false)} onApply={(v) => setDate(v.addedDate ?? "")} />

      {/* add */}
      <Drawer accessible open={addOpen} title={isEmail ? "Add to Email suppressions" : "Add to WhatsApp opt-outs"} onClose={() => { if (!adding) setAddOpen(false); }}
        footer={
          <>
            <Button touch variant="ghost" disabled={adding} onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button touch variant="solid" disabled={adding} onClick={submitAdd}>{adding ? "Adding…" : "Add"}</Button>
          </>
        }>
        <Field id="sup-contacts" stacked required
          label={isEmail ? "Email addresses" : "Mobile numbers with country code"}
          hint={`(up to ${MAX_AT_ONCE}, separated by commas)`}
          error={tried && addIssue ? addIssue : undefined}>
          <TextArea id="sup-contacts" touch rows={4} placeholder={isEmail ? "name@example.com, other@example.com" : "+91 90000 00001, +91 90000 00002"}
            value={draft.text} onChange={(v) => setDraft({ ...draft, text: v })} disabled={adding}
            invalid={tried && !!addIssue} describedBy={tried && addIssue ? "sup-contacts-error" : "sup-contacts-note"} />
        </Field>
        {isEmail && (
          <Field id="sup-reason" stacked label="List">
            <Select id="sup-reason" touch ariaLabel="List" placeholder="List" disabled={adding}
              options={REASONS.map((r) => ({ value: r, label: r }))} value={draft.reason} onChange={(v) => setDraft({ ...draft, reason: v as Reason })} />
          </Field>
        )}
        {addError && <p role="alert" className="flex items-start gap-2 font-body text-xs font-semibold text-[#f87171]"><Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{addError}</p>}
        <p id="sup-contacts-note" className="flex items-start gap-2 font-body text-xs text-muted">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Suppressed contacts are skipped by every campaign and automation on this channel. Contacts already on the list are skipped.
        </p>
      </Drawer>

      <ConfirmDialog accessible open={!!confirm} title="Remove from suppression list?"
        body={`${confirm?.label ?? ""} will start receiving ${channel} communication again.`}
        confirmLabel="Remove" pending={removing} error={removeError}
        onCancel={() => { if (!removing) setConfirm(null); }} onConfirm={doRemove} />

      {toastNode}
    </>
  );
}
