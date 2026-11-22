"use client";

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as RKeyboardEvent, type ReactNode, type RefObject,
} from "react";
import {
  anyFilter, cellText, comparison, filterRows, fmtInr, fmtInt, isDraggable, isSystem, kpis, nextSort, NO_FILTERS, optionsOf, serialsOf, sortRows,
  valueOf, VIEW_COMPARISON, type Filters, type VdColumn, type VdList, type VdRow, type Sort,
} from "@/lib/growth/vedantu";
import { call, type Client } from "./api";
import { AddColumnDialog, BulkUpdateDialog, ConfirmDialog, CsvDialog, RenameColumnDialog, RowDialog } from "./dialogs";
import { Icon } from "../consultants/icons";

/**
 * Growth → Marketing Channels → Vedantu Channel → Vedantu Listing. Admin only.
 * Layout and behaviour follow the vedamcrm360 Vedantu Listing (the shared CRM channel listing + its Vedantu toolbar and cards).
 * Rows, live attribution and the column list come from growth_vd_list (migration 0136); every write goes through an
 * admin-checked growth_vd_* RPC.
 */

type View = "active" | "trash";
type Dlg =
  | { k: "row"; row: VdRow | null } | { k: "csv" } | { k: "addcol" } | { k: "rename"; col: VdColumn } | { k: "delcol"; col: VdColumn }
  | { k: "del"; row: VdRow } | { k: "bulkdel" } | { k: "bulkupd" } | null;
const SIZES = [10, 50, 100] as const;

export function VedantuListing({ sb }: { sb: Client }) {
  const [view, setView] = useState<View>("active");
  const [data, setData] = useState<VdList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>(null);
  const [size, setSize] = useState<(typeof SIZES)[number]>(50);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [colBusy, setColBusy] = useState<"" | "order" | "vis">("");
  const [restoring, setRestoring] = useState(false);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let on = true;
    setLoading(true);
    void call<VdList>(sb, "growth_vd_list", { view }).then((r) => {
      if (!on) return;
      setLoading(false);
      if (r.error || !r.data) { setLoadErr(r.error ?? "Could not load the Vedantu rows."); return; }
      setLoadErr(""); setData(r.data);
    });
    return () => { on = false; };
  }, [sb, view, tick]);
  useEffect(() => { if (!ok) return; const t = setTimeout(() => setOk(""), 4000); return () => clearTimeout(t); }, [ok]);

  const columns = useMemo(() => data?.columns ?? [], [data]);
  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const serials = useMemo(() => serialsOf(allRows), [allRows]);
  const filtered = useMemo(() => sortRows(filterRows(allRows, f), sort, serials), [allRows, f, serials, sort]);
  const k = useMemo(() => kpis(filtered), [filtered]);
  const visibleCols = columns.filter((c) => !c.hidden);
  const hiddenCols = columns.filter((c) => c.hidden);
  const base = view === "trash" ? visibleCols : showHidden ? columns : visibleCols;
  // CRM View Comparison: a worked-out column right after Actual Views (not stored, not draggable, no column menu)
  const shown = useMemo(() => {
    const vc: VdColumn = { key: VIEW_COMPARISON, label: "View Comparison", type: "computed", required: false, standard: true, hidden: false };
    const i = base.findIndex((c) => c.key === "actual_views");
    return i < 0 ? base : [...base.slice(0, i + 1), vc, ...base.slice(i + 1)];
  }, [base]);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const safePage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(safePage * size, (safePage + 1) * size);
  const campaignOpts = useMemo(() => optionsOf(allRows, "campaign"), [allRows]);
  const channelOpts = useMemo(() => optionsOf(allRows, "channel"), [allRows]);
  useEffect(() => setPage(0), [f, sort, size, view]);
  // keep only selections that are still on the list
  const idKey = allRows.map((r) => r.id).join(",");
  useEffect(() => {
    const keep = new Set(idKey ? idKey.split(",") : []);
    setSel((s) => ([...s].every((id) => keep.has(id)) ? s : new Set([...s].filter((id) => keep.has(id)))));
  }, [idKey]);

  const pageIds = pageRows.map((r) => r.id);
  const allOn = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const someOn = !allOn && pageIds.some((id) => sel.has(id));
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (allOn) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const done = (msg: string) => { setDlg(null); setOk(msg); reload(); };

  // ── column actions ──
  async function setHidden(c: VdColumn, hidden: boolean) {
    setColBusy("vis"); setErr("");
    const r = await call(sb, "growth_vd_col_update", { key: c.key, hidden });
    setColBusy("");
    if (r.error) return setErr(r.error);
    reload();
  }
  async function unhideAll() {
    setColBusy("vis"); setErr("");
    const r = await call(sb, "growth_vd_col_unhide_all", {});
    setColBusy("");
    if (r.error) return setErr(r.error);
    reload();
  }
  async function saveOrder(keys: string[]) {
    if (!data) return;
    const before = data.columns;
    const byKey = new Map(before.map((c) => [c.key, c]));
    setData({ ...data, columns: keys.map((key) => byKey.get(key)!).filter(Boolean) });   // shows the new order at once
    setColBusy("order"); setErr("");
    const r = await call(sb, "growth_vd_col_order", { keys });
    setColBusy("");
    if (r.error) { setData((d) => (d ? { ...d, columns: before } : d)); setErr(r.error); }
  }
  function move(from: string, to: string) {
    const keys = columns.map((c) => c.key);
    const i = keys.indexOf(from), j = keys.indexOf(to);
    if (i < 0 || j < 0 || i === j) return;
    keys.splice(i, 1);
    keys.splice(keys.indexOf(to) + (i < j ? 1 : 0), 0, from);
    void saveOrder(keys);
  }

  // ── row actions ──
  async function restore(ids: string[]) {
    setRestoring(true); setErr("");
    const r = await call<{ changed: number }>(sb, "growth_vd_trash", { ids, trash: false });
    setRestoring(false);
    if (r.error) return setErr(r.error);
    setSel(new Set());
    done(`${r.data?.changed ?? ids.length} ${ids.length === 1 ? "row" : "rows"} restored.`);
  }

  const isTrash = view === "trash";
  const nSel = sel.size;
  const first = data === null && loading;

  return (
    <div className="vcn-page">
      <div className="vcn-head">
        <div>
          <h1 className="vcn-h1">Vedantu Listing</h1>
          <p className="vcn-sub">
            {visibleCols.length} columns · {filtered.length} {filtered.length === 1 ? "row" : "rows"}
            {hiddenCols.length > 0 && <i> · {hiddenCols.length} hidden</i>}
            {colBusy === "order" && <i className="sv"><Icon n="loader" spin size="xs" /> Saving order…</i>}
            {colBusy === "vis" && <i className="sv"><Icon n="loader" spin size="xs" /> Updating…</i>}
          </p>
        </div>
        {!isTrash && (
          <div className="vcn-tools">
            <button type="button" className="vcn-tb" onClick={() => setDlg({ k: "csv" })} disabled={!data}><Icon n="upload" /> Upload CSV</button>
            <button type="button" className="vcn-tb" onClick={() => setDlg({ k: "addcol" })} disabled={!data}><Icon n="settings" /> Add Column</button>
            <button type="button" className="vcn-tb pri" onClick={() => setDlg({ k: "row", row: null })} disabled={!data}><Icon n="plus" /> Add Row</button>
          </div>
        )}
      </div>

      <div className="vcn-top">
      <div className="vcn-filters vvd-filters" role="search">
        <div className="vcn-search">
          <Icon n="search" />
          <input className="vcn-in" type="search" placeholder="Search channel, campaign, UTM, live link… (comma for multiple)" aria-label="Search channel, campaign, UTM, live link"
            value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} maxLength={500} />
        </div>
        {campaignOpts.length > 0 && (
          <select className="vcn-sel" aria-label="Campaign" value={f.campaign} onChange={(e) => setF((x) => ({ ...x, campaign: e.target.value }))}>
            <option value="">All campaigns</option>{campaignOpts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {channelOpts.length > 0 && (
          <select className="vcn-sel" aria-label="Channel" value={f.channel} onChange={(e) => setF((x) => ({ ...x, channel: e.target.value }))}>
            <option value="">All channels</option>{channelOpts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {anyFilter(f) && <button type="button" className="vcn-sbtn" onClick={() => setF(NO_FILTERS)}><Icon n="x" size="s" /> Clear</button>}
      </div>

      <div className="vcn-kpis vvd-kpis" aria-busy={first}>
        <Kpi label="Posts live" color="var(--a)" v={first ? null : fmtInt(k.postsLive)} />
        <Kpi label="Total spend" color="var(--pink)" v={first ? null : fmtInr(k.totalSpend)} />
        <Kpi label="Video spend" color="var(--cy)" v={first ? null : fmtInr(k.videoSpend)} />
        <Kpi label="Total CPA spend" color="#f97d03" v={first ? null : fmtInr(k.totalCpaSpend)} />
        <Kpi label="Total views" color="var(--lv)" v={first ? null : fmtInt(k.totalViews)} />
      </div>
      </div>

      <div className="vcn-tabs" role="tablist" aria-label="Rows">
        {(["active", "trash"] as const).map((v) => (
          <button key={v} type="button" role="tab" className="vcn-tab" aria-selected={view === v}
            onClick={() => { if (view !== v) { setView(v); setSel(new Set()); setData(null); setErr(""); } }}>
            {v === "active" ? "Active" : "Trash"}
            {(data?.counts[v] ?? 0) > 0 && <span className="vcn-badge">{data!.counts[v]}</span>}
          </button>
        ))}
      </div>

      {loadErr && data && <div className="vcn-banner err" role="alert"><Icon n="alert" /><div>{loadErr}</div><button type="button" className="vcn-x" onClick={() => setLoadErr("")} aria-label="Dismiss"><Icon n="x" size="s" /></button></div>}
      {err && <div className="vcn-banner err" role="alert"><Icon n="alert" /><div>{err}</div><button type="button" className="vcn-x" onClick={() => setErr("")} aria-label="Dismiss"><Icon n="x" size="s" /></button></div>}
      {ok && <div className="vcn-banner ok" role="status"><Icon n="check" /><div>{ok}</div><button type="button" className="vcn-x" onClick={() => setOk("")} aria-label="Dismiss"><Icon n="x" size="s" /></button></div>}

      {!isTrash && hiddenCols.length > 0 && (
        <div className="vcn-hidbar">
          <button type="button" className="vcn-chip" onClick={() => setShowHidden((s) => !s)} aria-pressed={showHidden}>
            <Icon n={showHidden ? "eyeOff" : "eye"} size="s" />
            {showHidden ? "Hide" : "Show"} {hiddenCols.length} hidden {hiddenCols.length === 1 ? "column" : "columns"}
          </button>
          <button type="button" className="vcn-lnk" onClick={unhideAll} disabled={colBusy === "vis"}>Unhide all</button>
        </div>
      )}

      {nSel > 0 && (
        <div className="vcn-bulk">
          <div className="vcn-bulk-l">
            <button type="button" className="vcn-x" onClick={() => setSel(new Set())} aria-label="Clear selection"><Icon n="x" /></button>
            <span>{nSel} {nSel === 1 ? "row" : "rows"} selected</span>
          </div>
          <div className="vcn-bulk-r">
            {isTrash ? <>
              <button type="button" className="vcn-b" onClick={() => restore([...sel])} disabled={restoring}><Icon n={restoring ? "loader" : "restore"} spin={restoring} size="s" /> Restore selected</button>
              <button type="button" className="vcn-b dan" onClick={() => setDlg({ k: "bulkdel" })}><Icon n="trash" size="s" /> Delete permanently</button>
            </> : <>
              <button type="button" className="vcn-b" onClick={() => setDlg({ k: "bulkupd" })}><Icon n="pencil" size="s" /> Bulk update column</button>
              <button type="button" className="vcn-b dan" onClick={() => setDlg({ k: "bulkdel" })}><Icon n="trash" size="s" /> Delete selected</button>
            </>}
          </div>
        </div>
      )}

      {isTrash && allRows.length > 0 && <div className="vcn-note"><span>These rows were deleted but can be restored. Rows older than 30 days will be purged.</span></div>}
      {!isTrash && <div className="vcn-tip">Tip: drag a visible column header to reorder. Use the column menu to rename, hide, or delete.</div>}

      <div className="vcn-card">
        <div className="vcn-scroll">
          <table className="vcn-t" aria-label={isTrash ? "Vedantu rows in the trash" : "Vedantu rows"} aria-busy={loading}>
            <thead>
              <tr>
                <th className="chk" scope="col">
                  <input type="checkbox" className="vcn-chk" checked={allOn} ref={(el) => { if (el) el.indeterminate = someOn; }} onChange={toggleAll}
                    aria-label="Select all rows on this page" disabled={!pageRows.length} />
                </th>
                {shown.map((c) => (
                  <HeadCell key={c.key} c={c} trash={isTrash || c.key === VIEW_COMPARISON} sort={sort} onSort={() => setSort((s) => nextSort(s, c.key))}
                    onDropOn={move} onRename={() => setDlg({ k: "rename", col: c })} onDelete={() => setDlg({ k: "delcol", col: c })}
                    onHide={(h) => void setHidden(c, h)} />
                ))}
                <th scope="col" className="r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {first && [0, 1, 2, 3, 4].map((i) => (
                <tr key={i} className="vcn-skel" aria-hidden="true"><td colSpan={shown.length + 2 || 19}><i style={{ width: `${90 - i * 9}%` }} /></td></tr>
              ))}
              {!first && data === null && loadErr && (
                <tr><td className="msg" colSpan={shown.length + 2 || 19}>
                  <div className="vcn-empty" role="alert"><b>Couldn&apos;t load the Vedantu rows.</b><span>{loadErr}</span>
                    <button type="button" className="vcn-b" style={{ marginTop: 14 }} onClick={reload}><Icon n="refresh" size="s" /> Try again</button></div>
                </td></tr>
              )}
              {data && allRows.length === 0 && (
                <tr><td className="msg" colSpan={shown.length + 2}>
                  <div className="vcn-empty">
                    <b>{isTrash ? "Trash is empty." : "No entries yet for Vedantu."}</b>
                    <span>{isTrash ? "Deleted rows will appear here for 30 days." : <>Click <em>Add Row</em> or <em>Upload CSV</em> to get started.</>}</span>
                  </div>
                </td></tr>
              )}
              {data && allRows.length > 0 && filtered.length === 0 && (
                <tr><td className="msg" colSpan={shown.length + 2}>
                  <div className="vcn-empty"><b>No rows match these filters.</b><span>Change the search or the filters, or clear them.</span>
                    <button type="button" className="vcn-b" style={{ marginTop: 14 }} onClick={() => setF(NO_FILTERS)}><Icon n="x" size="s" /> Clear filters</button></div>
                </td></tr>
              )}
              {data && pageRows.map((r) => (
                <tr key={r.id} className={sel.has(r.id) ? "sel" : ""}>
                  <td className="chk"><input type="checkbox" className="vcn-chk" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.channel}`} /></td>
                  {shown.map((c) => (
                    <td key={c.key} className={c.hidden ? "hid" : undefined}>
                      <Cell c={c} r={r} serial={serials.get(r.id)} />
                    </td>
                  ))}
                  <td className="act">
                    <div className="vcn-acts">
                      {isTrash ? (
                        <button type="button" className="vcn-ab res" onClick={() => restore([r.id])} disabled={restoring} aria-label={`Restore ${r.channel}`}><Icon n="restore" size="s" /> Restore</button>
                      ) : <>
                        <button type="button" className="vcn-ab" onClick={() => setDlg({ k: "row", row: r })} aria-label={`Edit ${r.channel}`}><Icon n="pencil" size="s" /> Edit</button>
                        <button type="button" className="vcn-ab dan" onClick={() => setDlg({ k: "del", row: r })} aria-label={`Delete ${r.channel}`}><Icon n="trash" size="s" /> Delete</button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="vcn-pg">
            <div className="vcn-pg-l">
              <label htmlFor="vcn-ps">Rows per page:</label>
              <select id="vcn-ps" className="vcn-sel" value={size} onChange={(e) => setSize(Number(e.target.value) as (typeof SIZES)[number])}>
                {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="vcn-pg-n">Showing {safePage * size + 1}–{Math.min((safePage + 1) * size, filtered.length)} of {filtered.length.toLocaleString("en-IN")}</span>
            </div>
            <div className="vcn-pg-r">
              <button type="button" className="vcn-pb" onClick={() => setPage(0)} disabled={safePage === 0} aria-label="First page"><Icon n="first" size="s" /></button>
              <button type="button" className="vcn-pb" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0} aria-label="Previous page"><Icon n="left" size="s" /></button>
              <span className="vcn-pg-n">Page {safePage + 1} of {pages}</span>
              <button type="button" className="vcn-pb" onClick={() => setPage(Math.min(pages - 1, safePage + 1))} disabled={safePage >= pages - 1} aria-label="Next page"><Icon n="right" size="s" /></button>
              <button type="button" className="vcn-pb" onClick={() => setPage(pages - 1)} disabled={safePage >= pages - 1} aria-label="Last page"><Icon n="last" size="s" /></button>
            </div>
          </div>
        )}
      </div>

      {dlg?.k === "row" && <RowDialog sb={sb} columns={columns} rows={allRows} editing={dlg.row} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg?.k === "csv" && <CsvDialog sb={sb} columns={columns} onClose={() => { setDlg(null); reload(); }} onDone={done} onColumns={reload} />}
      {dlg?.k === "addcol" && <AddColumnDialog sb={sb} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === "rename" && <RenameColumnDialog sb={sb} column={dlg.col} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === "bulkupd" && <BulkUpdateDialog sb={sb} columns={columns} ids={[...sel]} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === "delcol" && (
        <ConfirmDialog title={`Delete “${dlg.col.label}”?`} confirm="Delete Column" busyText="Deleting…" danger onClose={() => setDlg(null)}
          body={<>The column will disappear from the table. Data in existing rows is <b>preserved</b> — if you add a column back with the same name later, the data reappears.</>}
          onConfirm={async () => { const r = await call(sb, "growth_vd_col_remove", { key: dlg.col.key }); if (r.error) return r.error; done("Column deleted."); return null; }} />
      )}
      {dlg?.k === "del" && (
        <ConfirmDialog title="Delete row?" confirm="Delete" busyText="Deleting…" danger onClose={() => setDlg(null)}
          body={<><b style={{ color: "var(--ink)" }}>{dlg.row.channel || "This row"}</b> in Vedantu will be moved to Trash. You can restore it within 30 days from the Trash view.</>}
          onConfirm={async () => { const r = await call(sb, "growth_vd_trash", { ids: [dlg.row.id], trash: true }); if (r.error) return r.error; done("Row moved to Trash."); return null; }} />
      )}
      {dlg?.k === "bulkdel" && (
        <ConfirmDialog danger onClose={() => setDlg(null)} busyText={isTrash ? "Purging…" : "Deleting…"} confirm={isTrash ? "Permanently delete" : "Delete"}
          title={isTrash ? `Permanently delete ${nSel} ${nSel === 1 ? "row" : "rows"}?` : `Delete ${nSel} ${nSel === 1 ? "row" : "rows"}?`}
          body={isTrash ? <><b style={{ color: "var(--pink)" }}>This cannot be undone.</b> Rows will be permanently removed from Vedantu.</>
            : "Selected rows in Vedantu will be moved to Trash. You can restore them within 30 days."}
          onConfirm={async () => {
            const ids = [...sel];
            const r = isTrash ? await call<{ deleted: number }>(sb, "growth_vd_purge", { ids }) : await call<{ changed: number }>(sb, "growth_vd_trash", { ids, trash: true });
            if (r.error) return r.error;
            setSel(new Set());
            done(isTrash ? `${ids.length} ${ids.length === 1 ? "row" : "rows"} deleted permanently.` : `${ids.length} ${ids.length === 1 ? "row" : "rows"} moved to Trash.`);
            return null;
          }} />
      )}
    </div>
  );
}

function Kpi({ label, v, sub, color, hl }: { label: string; v: string | null; sub?: string; color: string; hl?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFitText(ref, v);
  return (
    <div className={`vcn-kpi${hl ? " hl" : ""}`} style={{ ["--k" as string]: color }}>
      <div className="vcn-kpi-l">{label}</div>
      <div ref={ref} className={`vcn-kpi-v${v === null ? " ld" : ""}`} title={v ?? undefined}>{v ?? "…"}</div>
      {sub && v !== null && <div className="vcn-kpi-s">{sub}</div>}
    </div>
  );
}

/**
 * Keeps a KPI value on one line: at its normal size when it fits (as the CRM), otherwise 1px smaller at a time down to
 * 12px, so a long amount is not split in the middle ("₹25,445.0" / "0"). Only if it still does not fit at 12px does it wrap
 * (the CRM's behaviour). Re-checked when the value or the card width changes.
 */
export function useFitText(ref: RefObject<HTMLDivElement | null>, text: string | null) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      el.style.whiteSpace = "nowrap";
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth + 0.5 && size > 12) { size -= 1; el.style.fontSize = `${size}px`; }
      if (el.scrollWidth > el.clientWidth + 0.5) el.style.whiteSpace = "";
    };
    fit();
    let w = el.clientWidth;   // react to width changes only (the font change itself alters the height)
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit(); } });
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [ref, text]);
}

// ───────────────────────────── menus that open over the table ─────────────────────────────

/**
 * The table scrolls sideways, so a menu placed inside it would be cut off (and would make the table scroll).
 * The menu is placed on the screen instead: under its button, or above it when there is no room below, and it
 * follows the button when the page or the table scrolls.
 */
function useMenuPos(open: boolean, anchor: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>, align: "left" | "right"): CSSProperties {
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    if (!open) { setPos({ visibility: "hidden" }); return; }
    const place = () => {
      if (!anchor.current) return;
      const a = anchor.current.getBoundingClientRect();
      const mh = menu.current?.offsetHeight ?? 0, mw = menu.current?.offsetWidth ?? 0;
      const top = window.innerHeight - a.bottom < mh + 12 && a.top > mh + 12 ? a.top - mh - 4 : a.bottom + 4;
      const left = Math.max(8, Math.min(align === "right" ? a.right - mw : a.left, window.innerWidth - mw - 8));
      setPos({ position: "fixed", top, left, right: "auto" });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, anchor, menu, align]);
  return pos;
}

// ───────────────────────────── header cell: drag, sort, column menu ─────────────────────────────

let dragKey: string | null = null;   // one drag at a time on the page

function HeadCell({ c, trash, sort, onSort, onDropOn, onRename, onDelete, onHide }: {
  c: VdColumn; trash: boolean; sort: Sort; onSort: () => void; onDropOn: (from: string, to: string) => void;
  onRename: () => void; onDelete: () => void; onHide: (hidden: boolean) => void;
}) {
  const [over, setOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPos = useMenuPos(open, btn, menuRef, "right");
  const drag = !trash && isDraggable(c);
  const on = sort?.key === c.key;
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    // after the menu has its place on screen; no scroll (a scroll closes the menu)
    const raf = requestAnimationFrame(() => wrap.current?.querySelector<HTMLButtonElement>(".vcn-mi:not(:disabled)")?.focus({ preventScroll: true }));
    return () => { cancelAnimationFrame(raf); document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); };
  }, [open]);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  const menuKeys = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>(".vcn-mi:not(:disabled)") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus({ preventScroll: true });
  };
  const dnd = drag ? {
    draggable: true,
    onDragStart: (e: DragEvent) => { dragKey = c.key; setDragging(true); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.key); },
    onDragEnd: () => { dragKey = null; setDragging(false); setOver(false); },
    onDragOver: (e: DragEvent) => { if (dragKey && dragKey !== c.key) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); if (dragKey && dragKey !== c.key) onDropOn(dragKey, c.key); dragKey = null; },
  } : {};
  const title = on ? (sort!.dir === "asc" ? "Sorted ascending — click for descending" : "Sorted descending — click to clear sort") : "Click to sort ascending";
  return (
    <th scope="col" {...dnd} aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`${c.hidden ? "hid " : ""}${drag ? "drag " : ""}${dragging ? "dragging " : ""}${over ? "over" : ""}`}>
      <div className="vcn-th">
        {drag && <span className="vcn-grip"><Icon n="grip" size="xs" /></span>}
        {c.hidden && <Icon n="eyeOff" size="xs" />}
        <span>{c.label}</span>
        {c.required && <span className="vcn-req" aria-label="required">*</span>}
        <button type="button" className={`vcn-hb${on ? " on" : ""}`} onClick={onSort} title={title} aria-label={`${c.label}: ${title}`} draggable={false}
          onDragStart={(e) => e.stopPropagation()}>
          <Icon n={on ? (sort!.dir === "asc" ? "up" : "down") : "updown"} size={on ? "s" : "xs"} />
        </button>
        {!trash && (
          <div className="vcn-menuw" ref={wrap} onKeyDown={menuKeys}>
            <button ref={btn} type="button" className="vcn-hb" title="Column actions" aria-label={`Column actions: ${c.label}`} aria-haspopup="menu" aria-expanded={open}
              onClick={() => setOpen((o) => !o)} draggable={false} onDragStart={(e) => e.stopPropagation()}>
              <Icon n="more" size="s" />
            </button>
            {open && (
              <div ref={menuRef} style={menuPos} className="vcn-menu" role="menu" aria-label={`${c.label} column`}>
                <button type="button" role="menuitem" className="vcn-mi" onClick={pick(onRename)}><Icon n="pencil" size="s" /> Rename column</button>
                {c.hidden
                  ? <button type="button" role="menuitem" className="vcn-mi" onClick={pick(() => onHide(false))}><Icon n="eye" size="s" /> Unhide column</button>
                  : <button type="button" role="menuitem" className="vcn-mi" onClick={pick(() => onHide(true))}><Icon n="eyeOff" size="s" /> Hide column</button>}
                <button type="button" role="menuitem" className="vcn-mi dan" disabled={isSystem(c)} onClick={pick(onDelete)}
                  title={isSystem(c) ? "System column — can only be renamed or hidden" : undefined}>
                  <Icon n="trash" size="s" /> Delete column
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </th>
  );
}

// ───────────────────────────── cells ─────────────────────────────

const safeHref = (v: string) => (/^https?:\/\//i.test(v) ? v : null);

function Cell({ c, r, serial }: { c: VdColumn; r: VdRow; serial?: number }): ReactNode {
  if (c.key === VIEW_COMPARISON) return <ViewComparison r={r} />;
  const v = valueOf(r, c.key, serial);
  if (c.key === "leads" || c.key === "payments" || c.key === "enrollments") {
    if (r.utm_link?.trim()) return <span className="vcn-via"><span className="vcn-num">{Number(v ?? 0).toLocaleString("en-IN")}</span><small>via UTM</small></span>;
  }
  if (v === null || v === "") return <span className="vcn-dash">—</span>;
  if (c.key === "utm_link") return <span className="vcn-utm">{String(v)}</span>;   // CRM: the UTM is plain text, shown in full
  if (c.type === "url") {
    const href = safeHref(String(v));
    if (!href) return <span>{String(v)}</span>;
    return <a className="vcn-url" href={href} target="_blank" rel="noopener noreferrer nofollow" title={href}><span>{href}</span><Icon n="ext" size="xs" /></a>;
  }
  if (c.type === "number" || c.type === "computed") return <span className="vcn-num">{cellText(c, v)}</span>;
  return <span>{cellText(c, v)}</span>;
}

/** CRM View Comparison: nothing expected → "— (fill expected)"; nothing counted yet → "—"; else the % and the difference. */
function ViewComparison({ r }: { r: VdRow }) {
  const c = comparison(r);
  if (c.kind === "fill") return <span className="vcn-dash">— <small className="vvd-fill">(fill expected)</small></span>;
  if (c.kind === "none") return <span className="vcn-dash">—</span>;
  const up = c.abs >= 0;
  const abs = `${up ? "+" : "−"}${Math.abs(Math.round(c.abs)).toLocaleString("en-IN")}`;
  return (
    <span className={`vvd-vc ${up ? "up" : "dn"}`} title={`${abs} views against expected`}>
      <b>{up ? "▲" : "▼"} {Math.abs(c.pct).toFixed(1)}%</b><small>{abs}</small>
    </span>
  );
}
