"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AD_PLATFORMS, INFL_PLATFORMS, adCards, parseAmount, fmtCompact, fmtDate, fmtDateTime, fmtInr, fmtInt, inRange, inflCards, isYouTube, matchesTerms,
  shareBar, splitTerms, type AdRow, type Channel, type CustomColumn, type Meta, type PostRow,
} from "@/lib/growth/marketing";
import { AD_FIELDS, CampaignsDialog, ColumnsDialog, CsvDialog, INFL_FIELDS, RowDialog } from "./dialogs";
import { Err, ExtLink, FunnelPanel, SearchSelect, colsOf, rpc, type Client } from "./shared";

/**
 * Ads Channel Listing + Influencer Listing (Growth → Marketing Channels). Admin only.
 * Rows and the live leads / payments / enrollments come from growth_rows_list; filters, search
 * (comma = several values) and the cards are worked out here from those rows.
 */

const PAGE = 50;
type View = "active" | "trash";
type Sort = { key: string; dir: 1 | -1 };

function useRows<T extends { id: string }>(sb: Client, channel: Channel, view: View) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [counts, setCounts] = useState({ active: 0, trash: 0 });
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let on = true;
    setLoading(true);
    void rpc<{ rows: T[]; counts: { active: number; trash: number } }>(sb, "growth_rows_list", { channel, view }).then((r) => {
      if (!on) return;
      setLoading(false);
      if (r.error || !r.data) { setErr(r.error ?? "Could not load."); return; }
      setErr(""); setRows(r.data.rows); setCounts(r.data.counts);
    });
    return () => { on = false; };
  }, [sb, channel, view, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { rows, counts, err, setErr, reload, loading };
}

function sortRows<T>(rows: T[], s: Sort | null, get: (r: T, k: string) => unknown): T[] {
  if (!s) return rows;
  return [...rows].sort((a, b) => {
    const x = get(a, s.key), y = get(b, s.key);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en-IN", { numeric: true });
    return c * s.dir;
  });
}

function Th({ k, label, sort, setSort, right }: { k: string; label: string; sort: Sort | null; setSort: (s: Sort | null) => void; right?: boolean }) {
  const on = sort?.key === k;
  return (
    <th className={`mk-sort${right ? " r" : ""}`} onClick={() => setSort(on ? (sort!.dir === -1 ? { key: k, dir: 1 } : null) : { key: k, dir: -1 })}
      aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}>
      {label}{on ? (sort!.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
}

function Pager({ page, setPage, total }: { page: number; setPage: (n: number) => void; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (total <= PAGE) return null;
  return (
    <div className="mk-pager">
      <span>Showing {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total.toLocaleString("en-IN")}</span>
      <div>
        <button className="mk-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
        <span>{page + 1} / {pages}</span>
        <button className="mk-btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}

function AttrCell({ iw, all }: { iw: number | null; all: number }) {
  return <span className="mk-pair"><b style={{ color: "var(--ink)", fontWeight: 600 }}>{iw === null ? "—" : iw.toLocaleString("en-IN")}</b><small>all-time {all.toLocaleString("en-IN")}</small></span>;
}

function customCell(c: CustomColumn, v: string | undefined): ReactNode {
  if (!v) return "—";
  if (c.type === "url") return <ExtLink href={v}><span className="mk-trunc">{v}</span></ExtLink>;
  if (c.type === "date") return fmtDate(v);
  if (c.type === "number") return Number(v).toLocaleString("en-IN");
  return <span className="mk-trunc">{v}</span>;
}

type Dialog = { kind: "row"; initial: Record<string, string> & { id?: string } } | { kind: "cols" } | { kind: "csv" } | null;

function Toolbar({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="mk-head">
      <div><h2>{title}</h2><p>{sub}</p></div>
      <div className="mk-actions">{children}</div>
    </div>
  );
}

function ViewTabs({ view, setView, counts }: { view: View; setView: (v: View) => void; counts: { active: number; trash: number } }) {
  return (
    <div className="mk-tabs" role="tablist">
      <button role="tab" aria-selected={view === "active"} className={view === "active" ? "on" : ""} onClick={() => setView("active")}>Active <span className="mk-tag">{counts.active}</span></button>
      <button role="tab" aria-selected={view === "trash"} className={view === "trash" ? "on" : ""} onClick={() => setView("trash")}>Trash <span className="mk-tag">{counts.trash}</span></button>
    </div>
  );
}

function useSelection(ids: string[]) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  // drop selections that left the page; keyed on the id list's content (the array is new every render)
  const key = ids.join(",");
  useEffect(() => {
    const keep = new Set(key ? key.split(",") : []);
    setSel((s) => ([...s].every((id) => keep.has(id)) ? s : new Set([...s].filter((id) => keep.has(id)))));
  }, [key]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = ids.length > 0 && ids.every((id) => sel.has(id));
  const toggleAll = () => setSel(all ? new Set() : new Set(ids));
  return { sel, setSel, toggle, all, toggleAll };
}

function BulkBar({ n, view, onTrash, onClear, busy }: { n: number; view: View; onTrash: (trash: boolean) => void; onClear: () => void; busy: boolean }) {
  if (n === 0) return null;
  return (
    <div className="mk-bulk">
      <b>{n} selected</b>
      {view === "active"
        ? <button className="mk-dan" disabled={busy} onClick={() => onTrash(true)}>Move to Trash</button>
        : <button className="mk-btn" disabled={busy} onClick={() => onTrash(false)}>Restore</button>}
      <button className="mk-link" onClick={onClear}>Clear</button>
    </div>
  );
}

// ═════════════════════════════════════ ADS ═════════════════════════════════════

export function AdsListing({ sb, meta, reloadMeta }: { sb: Client; meta: Meta; reloadMeta: () => void }) {
  const [view, setView] = useState<View>("active");
  const { rows, counts, err, setErr, reload, loading } = useRows<AdRow>(sb, "ads", view);
  const custom = colsOf(meta, "ads");
  const [q, setQ] = useState("");
  const [camp, setCamp] = useState("");
  const [plat, setPlat] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [smin, setSmin] = useState("");
  const [smax, setSmax] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(0);
  const [dlg, setDlg] = useState<Dialog>(null);
  const [camps, setCamps] = useState(false); // opens on top of the row dialog without losing it
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");

  const filtered = useMemo(() => {
    const terms = splitTerms(q);
    const lo = parseAmount(smin), hi = parseAmount(smax);   // accepts 1,00,000 / ₹50,000
    return sortRows((rows ?? []).filter((r) =>
      matchesTerms([r.ad_name, r.utm_link, r.platform, r.campaign_status, r.campaign, r.notes, r.serial_no, ...Object.values(r.extra ?? {})], terms)
      && (!camp || r.campaign_id === camp) && (!plat || r.platform === plat) && (!status || r.campaign_status === status)
      && inRange(r.live_date, from, to)
      && (lo === null || Number(r.spend) >= lo) && (hi === null || Number(r.spend) <= hi)),
    sort, (r, k) => (k.startsWith("x_") ? r.extra?.[k] ?? null : (r as unknown as Record<string, unknown>)[k]));
  }, [rows, q, camp, plat, status, from, to, smin, smax, sort]);
  useEffect(() => setPage(0), [q, camp, plat, status, from, to, smin, smax, view]);
  const cards = useMemo(() => adCards(filtered), [filtered]);
  const pageRows = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const { sel, setSel, toggle, all, toggleAll } = useSelection(pageRows.map((r) => r.id));
  const anyFilter = !!(q || camp || plat || status || from || to || smin || smax);
  const labelOf = (k: string) => custom.find((c) => c.key === k)?.label ?? k;

  const toInitial = (r: AdRow): Record<string, string> & { id: string } => ({
    id: r.id, serial_no: r.serial_no == null ? "" : String(r.serial_no), ad_name: r.ad_name, platform: r.platform, campaign: r.campaign_id ?? "",
    campaign_status: r.campaign_status, live_date: r.live_date ?? "", spend: String(r.spend ?? ""), utm_link: r.utm_link ?? "", notes: r.notes ?? "",
    ...Object.fromEntries(Object.entries(r.extra ?? {}).map(([k, v]) => [`x:${k}`, v])),
  });
  async function inline(r: AdRow, patch: Record<string, string>) {
    const init = { ...toInitial(r), ...patch };
    const row: Record<string, unknown> = Object.fromEntries(AD_FIELDS.map((f) => [f.key, init[f.key] ?? ""]));
    row.id = r.id;
    const res = await rpc(sb, "growth_row_save", { channel: "ads", row }, labelOf);
    if (res.error) return setErr(`${r.ad_name}: ${res.error}${res.code?.startsWith("REQUIRED") ? " Open Edit to fill it in." : ""}`);
    reload();
  }
  async function trash(t: boolean) {
    setBusy(true);
    const res = await rpc(sb, "growth_rows_trash", { channel: "ads", ids: [...sel], trash: t });
    setBusy(false);
    if (res.error) return setErr(res.error);
    setSel(new Set()); reload();
  }

  return (
    <div className="mk-page">
      <Toolbar title="Ads Channel Listing" sub={`${AD_FIELDS.length + custom.length} columns · ${(rows ?? []).length} rows${loading ? " · loading…" : ""}`}>
        <button className="mk-btn" onClick={() => setCamps(true)}>Campaigns</button>
        <button className="mk-btn" onClick={() => setDlg({ kind: "csv" })}>Upload CSV</button>
        <button className="mk-btn" onClick={() => setDlg({ kind: "cols" })}>Add Column</button>
        <button className="mk-pri" onClick={() => setDlg({ kind: "row", initial: { campaign_status: "Enabled" } })}>+ Add Row</button>
      </Toolbar>

      <div className="mk-bar">
        <input className="mk-in mk-search" placeholder="Search ad name, UTM, platform, status… (comma for multiple)" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} aria-label="Search" />
        <select className="mk-sel" value={camp} onChange={(e) => setCamp(e.target.value)} aria-label="Campaign"><option value="">All campaigns</option>{meta.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="mk-sel" value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="Platform"><option value="">All platforms</option>{AD_PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select>
        <select className="mk-sel" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option><option>Enabled</option><option>Paused</option></select>
      </div>
      <div className="mk-bar">
        <span className="mk-lbl">Live date</span>
        <input className="mk-in mk-date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Live date from" />
        <span className="mk-note">to</span>
        <input className="mk-in mk-date" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Live date to" />
        <span className="mk-lbl" style={{ marginLeft: 8 }}>Spend</span>
        <input className="mk-in mk-num" inputMode="decimal" placeholder="Min ₹" value={smin} onChange={(e) => setSmin(e.target.value)} aria-label="Spend min" />
        <span className="mk-note">to</span>
        <input className="mk-in mk-num" inputMode="decimal" placeholder="Max ₹" value={smax} onChange={(e) => setSmax(e.target.value)} aria-label="Spend max" />
        {anyFilter && <button className="mk-link" onClick={() => { setQ(""); setCamp(""); setPlat(""); setStatus(""); setFrom(""); setTo(""); setSmin(""); setSmax(""); }}>Clear filters</button>}
        <span style={{ flex: 1 }} />
        <button className="mk-btn" onClick={reload} disabled={loading} title="Leads, payments and enrollments are counted live; this fetches the latest.">{loading ? "Refreshing…" : "↻ Refresh attribution"}</button>
      </div>

      <Err msg={err} onClose={() => setErr("")} />
      {ok && <div className="mk-ok" onClick={() => setOk("")}>{ok}</div>}

      <FunnelPanel aria="Spend and attribution" spendLabel="Total spend" spend={fmtInr(cards.spend)}
        meta={[{ label: "Unique ads", title: "Ads counted once per UTM link", value: fmtInt(cards.uniqueAds) }, { label: "Running", value: fmtInt(cards.running) }, { label: "Paused", value: fmtInt(cards.paused) }]}
        steps={([["Leads", "ld", "l"], ["Payments", "py", "p"], ["Enrollments", "en", "e"]] as const).map(([label, tone, k]) => ({
          label: `${label} (in-window)`, tone, value: cards.anyWindow ? fmtInt(cards.iw[k]) : "—",
          bar: cards.anyWindow ? shareBar(cards.iw[k], cards.iw.l) : 0,
          chip: <><b>{fmtInt(cards.all[k])}</b><span>all-time</span></>,
          title: "In-window: leads that arrived inside the campaign dates. All-time: every lead from these UTMs.",
        }))}
        links={[null, null]} />

      <ViewTabs view={view} setView={(v) => { setView(v); setSel(new Set()); }} counts={counts} />
      <BulkBar n={sel.size} view={view} onTrash={trash} onClear={() => setSel(new Set())} busy={busy} />

      <div className="mk-tablewrap">
        <table className="mk-table">
          <thead>
            <tr>
              <th><input type="checkbox" checked={all} onChange={toggleAll} aria-label="Select all on this page" /></th>
              <Th k="serial_no" label="#" sort={sort} setSort={setSort} />
              <Th k="ad_name" label="Ad name" sort={sort} setSort={setSort} />
              <Th k="campaign_status" label="Status" sort={sort} setSort={setSort} />
              <Th k="campaign" label="Used in *" sort={sort} setSort={setSort} />
              <Th k="platform" label="Platform *" sort={sort} setSort={setSort} />
              <Th k="live_date" label="Live date" sort={sort} setSort={setSort} />
              <Th k="spend" label="Spend" sort={sort} setSort={setSort} right />
              <th>UTM link</th>
              <Th k="leads" label="Leads" sort={sort} setSort={setSort} right />
              <Th k="payments" label="Payments" sort={sort} setSort={setSort} right />
              <Th k="enrollments" label="Enrollments" sort={sort} setSort={setSort} right />
              {custom.map((c) => <Th key={c.key} k={c.key} label={`${c.label}${c.required ? " *" : ""}`} sort={sort} setSort={setSort} />)}
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={15 + custom.length} className="mk-mid">Loading…</td></tr>}
            {rows !== null && filtered.length === 0 && (
              <tr><td colSpan={15 + custom.length} className="mk-mid">
                {view === "trash" ? "Trash is empty." : anyFilter ? "No ads match these filters." : "No ads yet. Add a row or upload a CSV."}
              </td></tr>
            )}
            {pageRows.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? "on" : ""}>
                <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.ad_name}`} /></td>
                <td>{r.serial_no ?? "—"}</td>
                <td className="mk-strong">{r.ad_name}</td>
                <td>
                  {view === "active" ? (
                    <select className="mk-cellsel" value={r.campaign_status} onChange={(e) => inline(r, { campaign_status: e.target.value })} aria-label="Status">
                      <option>Enabled</option><option>Paused</option>
                    </select>
                  ) : <span className={`mk-tag ${r.campaign_status === "Enabled" ? "mk-tag-on" : "mk-tag-off"}`}>{r.campaign_status}</span>}
                </td>
                <td>
                  {view === "active" ? (
                    <select className="mk-cellsel" value={r.campaign_id ?? ""} onChange={(e) => inline(r, { campaign: e.target.value })} aria-label="Used in">
                      {!r.campaign_id && <option value="">—</option>}
                      {meta.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  ) : r.campaign ?? "—"}
                </td>
                <td>
                  {view === "active" ? (
                    <select className="mk-cellsel" value={r.platform} onChange={(e) => inline(r, { platform: e.target.value })} aria-label="Platform">
                      {AD_PLATFORMS.map((p) => <option key={p}>{p}</option>)}
                    </select>
                  ) : r.platform}
                </td>
                <td>{fmtDate(r.live_date)}</td>
                <td className="r">{fmtInr(r.spend)}</td>
                <td><ExtLink href={r.utm_link}><span className="mk-trunc" title={r.utm_link ?? ""}>{r.utm_link ?? "—"}</span></ExtLink></td>
                <td className="r"><AttrCell iw={r.leads} all={r.leads_all} /></td>
                <td className="r"><AttrCell iw={r.payments} all={r.payments_all} /></td>
                <td className="r"><AttrCell iw={r.enrollments} all={r.enrollments_all} /></td>
                {custom.map((c) => <td key={c.key}>{customCell(c, r.extra?.[c.key])}</td>)}
                <td><span className="mk-trunc" title={r.notes ?? ""}>{r.notes ?? "—"}</span></td>
                <td className="r">
                  {view === "active" && <button className="mk-link" onClick={() => setDlg({ kind: "row", initial: toInitial(r) })}>Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} setPage={setPage} total={filtered.length} />
      <p className="mk-note">Leads, payments and enrollments: first-touch UTM of the lead. The big number is in-window (the lead arrived between the campaign&apos;s start and end); &quot;all-time&quot; is every lead from that UTM. Cards count each UTM once.</p>

      {dlg?.kind === "row" && <RowDialog sb={sb} channel="ads" meta={meta} initial={dlg.initial} onClose={() => setDlg(null)} reloadMeta={reloadMeta}
        openCampaigns={() => setCamps(true)} onSaved={() => { setDlg(null); setOk("Saved."); reload(); }} />}
      {dlg?.kind === "cols" && <ColumnsDialog sb={sb} channel="ads" columns={custom} onClose={() => setDlg(null)} onChanged={() => { reloadMeta(); reload(); }} />}
      {dlg?.kind === "csv" && <CsvDialog sb={sb} channel="ads" columns={custom} onClose={() => setDlg(null)} onImported={(n) => { setDlg(null); setOk(`${n} rows imported.`); reload(); }} />}
      {camps && <CampaignsDialog sb={sb} campaigns={meta.campaigns} onClose={() => setCamps(false)} onChanged={() => { reloadMeta(); reload(); }} />}
    </div>
  );
}

// ═════════════════════════════════════ INFLUENCERS ═════════════════════════════════════

export function InfluencerListing({ sb, meta, reloadMeta }: { sb: Client; meta: Meta; reloadMeta: () => void }) {
  const [view, setView] = useState<View>("active");
  const { rows, counts, err, setErr, reload, loading } = useRows<PostRow>(sb, "influencers", view);
  const custom = colsOf(meta, "influencers");
  const [q, setQ] = useState("");
  const [infl, setInfl] = useState("");
  const [plat, setPlat] = useState("");
  const [camp, setCamp] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(0);
  const [dlg, setDlg] = useState<Dialog>(null);
  const [camps, setCamps] = useState(false); // opens on top of the row dialog without losing it
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [syncing, setSyncing] = useState(false);

  const filtered = useMemo(() => {
    const terms = splitTerms(q);
    return sortRows((rows ?? []).filter((r) =>
      matchesTerms([r.influencer, r.live_link, r.utm_link, r.platform, r.campaign, r.live_status, r.notes, r.serial_no, ...Object.values(r.extra ?? {})], terms)
      && (!infl || r.influencer_id === infl) && (!plat || r.platform === plat) && (!camp || r.campaign_id === camp) && (!status || r.live_status === status)),
    sort, (r, k) => (k.startsWith("x_") ? r.extra?.[k] ?? null : k === "compare" ? (r.expected_views ? (r.actual_views ?? 0) / r.expected_views : null) : (r as unknown as Record<string, unknown>)[k]));
  }, [rows, q, infl, plat, camp, status, sort]);
  useEffect(() => setPage(0), [q, infl, plat, camp, status, view]);
  const cards = useMemo(() => inflCards(filtered), [filtered]);
  const pageRows = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const { sel, setSel, toggle, all, toggleAll } = useSelection(pageRows.map((r) => r.id));
  const anyFilter = !!(q || infl || plat || camp || status);
  const lastSync = useMemo(() => (rows ?? []).reduce<string | null>((m, r) => (r.views_synced_at && (!m || r.views_synced_at > m) ? r.views_synced_at : m), null), [rows]);
  const labelOf = (k: string) => custom.find((c) => c.key === k)?.label ?? k;

  const toInitial = (r: PostRow): Record<string, string> & { id: string } => ({
    id: r.id, serial_no: r.serial_no == null ? "" : String(r.serial_no), influencer: r.influencer_id, platform: r.platform, live_status: r.live_status,
    live_date: r.live_date ?? "", campaign: r.campaign_id ?? "", live_link: r.live_link ?? "", utm_link: r.utm_link ?? "",
    expected_views: r.expected_views == null ? "" : String(r.expected_views), actual_views: r.actual_views == null ? "" : String(r.actual_views),
    cost: String(r.cost ?? ""), notes: r.notes ?? "",
    ...Object.fromEntries(Object.entries(r.extra ?? {}).map(([k, v]) => [`x:${k}`, v])),
  });
  async function inline(r: PostRow, patch: Record<string, string>) {
    const init = { ...toInitial(r), ...patch };
    const row: Record<string, unknown> = Object.fromEntries(INFL_FIELDS.map((f) => [f.key, init[f.key] ?? ""]));
    row.id = r.id;
    const res = await rpc(sb, "growth_row_save", { channel: "influencers", row }, labelOf);
    if (res.error) return setErr(`${r.influencer}: ${res.error}${res.code?.startsWith("REQUIRED") ? " Open Edit to fill it in." : ""}`);
    reload();
  }
  async function trash(t: boolean) {
    setBusy(true);
    const res = await rpc(sb, "growth_rows_trash", { channel: "influencers", ids: [...sel], trash: t });
    setBusy(false);
    if (res.error) return setErr(res.error);
    setSel(new Set()); reload();
  }
  async function syncViews() {
    setSyncing(true); setErr(""); setOk("");
    try {
      const res = await fetch("/api/growth/influencers/sync-views", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const j = (await res.json().catch(() => ({}))) as { updated?: number; checked?: number; missing?: number; error?: string };
      if (!res.ok) setErr(j.error ?? "Could not sync YouTube views.");
      else { setOk(`YouTube views synced: ${j.updated ?? 0} of ${j.checked ?? 0} videos updated${j.missing ? `, ${j.missing} not found on YouTube` : ""}.`); reload(); }
    } catch {
      setErr("Could not reach the server. Try again.");
    }
    setSyncing(false);
  }

  return (
    <div className="mk-page">
      <Toolbar title="Influencer Listing" sub={`${INFL_FIELDS.length + custom.length} columns · ${(rows ?? []).length} rows${loading ? " · loading…" : ""}`}>
        <button className="mk-btn" onClick={() => setCamps(true)}>Campaigns</button>
        <button className="mk-btn" onClick={() => setDlg({ kind: "csv" })}>Upload CSV</button>
        <button className="mk-btn" onClick={() => setDlg({ kind: "cols" })}>Add Column</button>
        <button className="mk-pri" onClick={() => setDlg({ kind: "row", initial: { live_status: "Planned" } })}>+ Add Row</button>
      </Toolbar>

      <div className="mk-bar">
        <input className="mk-in mk-search" placeholder="Search influencer, link, UTM, campaign… (comma for multiple)" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} aria-label="Search" />
        <SearchSelect options={meta.influencers.map((i) => ({ value: i.id, label: i.name }))} value={infl} onChange={setInfl} allLabel="All influencers" ariaLabel="Influencer" />
        <select className="mk-sel" value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="Platform"><option value="">All platforms</option>{INFL_PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select>
        <select className="mk-sel" value={camp} onChange={(e) => setCamp(e.target.value)} aria-label="Campaign"><option value="">All campaigns</option>{meta.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="mk-sel" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Live status"><option value="">All statuses</option><option>Live</option><option>Planned</option></select>
      </div>
      <div className="mk-bar">
        <button className="mk-btn" onClick={reload} disabled={loading}>{loading ? "Refreshing…" : "↻ Refresh data"}</button>
        <button className="mk-btn" onClick={syncViews} disabled={syncing}>{syncing ? "Syncing…" : "Sync YouTube views"}</button>
        <span className="mk-note">Last synced: {fmtDateTime(lastSync)} · Instagram views are typed in by the team (Instagram does not allow reading them).</span>
        {anyFilter && <button className="mk-link" onClick={() => { setQ(""); setInfl(""); setPlat(""); setCamp(""); setStatus(""); }}>Clear filters</button>}
      </div>

      <Err msg={err} onClose={() => setErr("")} />
      {ok && <div className="mk-ok" onClick={() => setOk("")}>{ok}</div>}

      <FunnelPanel aria="Spend, posts and views" spendLabel="Total spend" spend={fmtInr(cards.spend)}
        meta={[{ label: "Unique channels", value: fmtInt(cards.channels) }]}
        steps={[
          { label: "Posts live", tone: "ps", value: fmtInt(cards.postsLive), chip: <><b>{fmtInt(filtered.length)}</b><span>in this view</span></> },
          { label: "Total views", tone: "vw", value: fmtCompact(cards.views), chip: <><b>{fmtInt(cards.views)}</b><span>exact</span></> },
        ]}
        links={[null]} />

      <ViewTabs view={view} setView={(v) => { setView(v); setSel(new Set()); }} counts={counts} />
      <BulkBar n={sel.size} view={view} onTrash={trash} onClear={() => setSel(new Set())} busy={busy} />

      <div className="mk-tablewrap">
        <table className="mk-table">
          <thead>
            <tr>
              <th><input type="checkbox" checked={all} onChange={toggleAll} aria-label="Select all on this page" /></th>
              <Th k="serial_no" label="#" sort={sort} setSort={setSort} />
              <Th k="influencer" label="Influencer *" sort={sort} setSort={setSort} />
              <Th k="platform" label="Platform *" sort={sort} setSort={setSort} />
              <Th k="live_date" label="Live date" sort={sort} setSort={setSort} />
              <th>Live link</th>
              <th>UTM link</th>
              <Th k="expected_views" label="Expected views" sort={sort} setSort={setSort} right />
              <Th k="actual_views" label="Actual views" sort={sort} setSort={setSort} right />
              <Th k="compare" label="View comparison" sort={sort} setSort={setSort} right />
              <Th k="cost" label="Cost" sort={sort} setSort={setSort} right />
              <Th k="live_status" label="Live status *" sort={sort} setSort={setSort} />
              <Th k="campaign" label="Campaign" sort={sort} setSort={setSort} />
              <Th k="leads" label="Leads" sort={sort} setSort={setSort} right />
              <Th k="payments" label="Payments" sort={sort} setSort={setSort} right />
              <Th k="enrollments" label="Enrollments" sort={sort} setSort={setSort} right />
              {custom.map((c) => <Th key={c.key} k={c.key} label={`${c.label}${c.required ? " *" : ""}`} sort={sort} setSort={setSort} />)}
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={19 + custom.length} className="mk-mid">Loading…</td></tr>}
            {rows !== null && filtered.length === 0 && (
              <tr><td colSpan={19 + custom.length} className="mk-mid">
                {view === "trash" ? "Trash is empty." : anyFilter ? "No posts match these filters." : "No influencer posts yet. Add a row or upload a CSV."}
              </td></tr>
            )}
            {pageRows.map((r) => {
              const cmp = r.expected_views ? ((r.actual_views ?? 0) / r.expected_views) * 100 : null;
              return (
                <tr key={r.id} className={sel.has(r.id) ? "on" : ""}>
                  <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.influencer}`} /></td>
                  <td>{r.serial_no ?? "—"}</td>
                  <td className="mk-strong">{r.influencer}</td>
                  <td>{r.platform}</td>
                  <td>{fmtDate(r.live_date)}</td>
                  <td><ExtLink href={r.live_link}><span className="mk-trunc" title={r.live_link ?? ""}>{r.live_link ?? "—"}</span></ExtLink></td>
                  <td><ExtLink href={r.utm_link}><span className="mk-trunc" title={r.utm_link ?? ""}>{r.utm_link ?? "—"}</span></ExtLink></td>
                  <td className="r">{fmtInt(r.expected_views)}</td>
                  <td className="r">
                    <span className="mk-pair"><span>{fmtInt(r.actual_views)}</span>
                      <small>{isYouTube(r.platform) ? (r.views_synced_at ? `synced ${fmtDateTime(r.views_synced_at)}` : "not synced yet") : "typed in"}</small></span>
                  </td>
                  <td className="r">{cmp === null ? <span className="mk-note">fill expected</span> : <span style={{ color: cmp >= 100 ? "var(--green)" : "#ffc58a" }}>{cmp.toFixed(0)}%</span>}</td>
                  <td className="r">{fmtInr(r.cost)}</td>
                  <td>
                    {view === "active" ? (
                      <select className="mk-cellsel" value={r.live_status} onChange={(e) => inline(r, { live_status: e.target.value })} aria-label="Live status">
                        <option>Planned</option><option>Live</option>
                      </select>
                    ) : <span className={`mk-tag ${r.live_status === "Live" ? "mk-tag-on" : ""}`}>{r.live_status}</span>}
                  </td>
                  <td>{r.campaign ?? "—"}</td>
                  <td className="r"><AttrCell iw={r.leads} all={r.leads_all} /></td>
                  <td className="r"><AttrCell iw={r.payments} all={r.payments_all} /></td>
                  <td className="r"><AttrCell iw={r.enrollments} all={r.enrollments_all} /></td>
                  {custom.map((c) => <td key={c.key}>{customCell(c, r.extra?.[c.key])}</td>)}
                  <td><span className="mk-trunc" title={r.notes ?? ""}>{r.notes ?? "—"}</span></td>
                  <td className="r">{view === "active" && <button className="mk-link" onClick={() => setDlg({ kind: "row", initial: toInitial(r) })}>Edit</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={page} setPage={setPage} total={filtered.length} />
      <p className="mk-note">Leads, payments and enrollments come from the post&apos;s UTM link (first-touch). The big number is in-window (inside the campaign dates); &quot;all-time&quot; is every lead from that UTM.</p>

      {dlg?.kind === "row" && <RowDialog sb={sb} channel="influencers" meta={meta} initial={dlg.initial} onClose={() => setDlg(null)} reloadMeta={reloadMeta}
        openCampaigns={() => setCamps(true)} onSaved={() => { setDlg(null); setOk("Saved."); reload(); }} />}
      {dlg?.kind === "cols" && <ColumnsDialog sb={sb} channel="influencers" columns={custom} onClose={() => setDlg(null)} onChanged={() => { reloadMeta(); reload(); }} />}
      {dlg?.kind === "csv" && <CsvDialog sb={sb} channel="influencers" columns={custom} onClose={() => setDlg(null)} onImported={(n) => { setDlg(null); setOk(`${n} rows imported.`); reloadMeta(); reload(); }} />}
      {camps && <CampaignsDialog sb={sb} campaigns={meta.campaigns} onClose={() => setCamps(false)} onChanged={() => { reloadMeta(); reload(); }} />}
    </div>
  );
}
