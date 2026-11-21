"use client";

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as RKeyboardEvent, type ReactNode, type RefObject,
} from "react";
import {
  cellText, filterRows, fmtInr2, fmtInt, isDraggable, isSystem, kpis, nextSort, serialsOf, sortRows, valueOf,
  type TgColumn, type TgList, type TgRow, type Sort,
} from "@/lib/growth/telegram";
import { call, type Client } from "./api";
import { AddColumnDialog, BulkUpdateDialog, ConfirmDialog, CsvDialog, RenameColumnDialog, RowDialog } from "./dialogs";
import { Icon } from "../consultants/icons";

/**
 * Growth → Marketing Channels → Telegram Channel → Telegram Listing. Admin only.
 * Layout and behaviour follow the vedamcrm360 Telegram Listing (the shared CRM channel listing + its Telegram toolbar).
 * Rows, live attribution and the column list come from growth_tg_list (migration 0132); every write goes through an
 * admin-checked growth_tg_* RPC.
 */

type View = "active" | "trash";
type Dlg =
  | { k: "row"; row: TgRow | null } | { k: "csv" } | { k: "addcol" } | { k: "rename"; col: TgColumn } | { k: "delcol"; col: TgColumn }
  | { k: "del"; row: TgRow } | { k: "bulkdel" } | { k: "bulkupd" } | null;
const SIZES = [10, 50, 100] as const;

export function TelegramListing({ sb }: { sb: Client }) {
  const [view, setView] = useState<View>("active");
  const [data, setData] = useState<TgList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [q, setQ] = useState("");
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
    void call<TgList>(sb, "growth_tg_list", { view }).then((r) => {
      if (!on) return;
      setLoading(false); setRefreshing(false);
      if (r.error || !r.data) { setLoadErr(r.error ?? "Could not load the Telegram rows."); return; }
      setLoadErr(""); setData(r.data);
    });
    return () => { on = false; };
  }, [sb, view, tick]);
  useEffect(() => { if (!ok) return; const t = setTimeout(() => setOk(""), 4000); return () => clearTimeout(t); }, [ok]);

  const columns = useMemo(() => data?.columns ?? [], [data]);
  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const serials = useMemo(() => serialsOf(allRows), [allRows]);
  const filtered = useMemo(() => sortRows(filterRows(allRows, q, serials), sort, serials), [allRows, q, serials, sort]);
  const k = useMemo(() => kpis(filtered), [filtered]);
  const visibleCols = columns.filter((c) => !c.hidden);
  const hiddenCols = columns.filter((c) => c.hidden);
  const shown = view === "trash" ? visibleCols : showHidden ? columns : visibleCols;
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const safePage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(safePage * size, (safePage + 1) * size);
  const campaigns = useMemo(() => data?.campaigns ?? [], [data]);
  const labelOf = (key: string) => columns.find((c) => c.key === key)?.label;
  useEffect(() => setPage(0), [q, sort, size, view]);
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
  async function setHidden(c: TgColumn, hidden: boolean) {
    setColBusy("vis"); setErr("");
    const r = await call(sb, "growth_tg_col_update", { key: c.key, hidden });
    setColBusy("");
    if (r.error) return setErr(r.error);
    reload();
  }
  async function unhideAll() {
    setColBusy("vis"); setErr("");
    const r = await call(sb, "growth_tg_col_unhide_all", {});
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
    const r = await call(sb, "growth_tg_col_order", { keys });
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
  /** Inline Used In dropdown: saved at once; the numbers of the new VSAT window are loaded again. */
  async function inlineSet(r: TgRow, value: string | null): Promise<boolean> {
    setErr("");
    const res = await call(sb, "growth_tg_bulk_update", { ids: [r.id], key: "used_in", value }, labelOf);
    if (res.error) {
      setErr(`${r.influencer_name}: ${res.error}${res.code?.startsWith("REQUIRED") ? " Open Edit to fill it in." : ""}`);
      return false;
    }
    reload();
    return true;
  }
  async function restore(ids: string[]) {
    setRestoring(true); setErr("");
    const r = await call<{ changed: number }>(sb, "growth_tg_trash", { ids, trash: false });
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
          <h1 className="vcn-h1">Telegram Listing</h1>
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
      <div className="vcn-filters" role="search">
        <div className="vcn-search">
          <Icon n="search" />
          <input className="vcn-in" type="search" placeholder="Search influencer, UTM, VSAT… (comma for multiple)" aria-label="Search influencer, UTM, VSAT"
            value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} />
        </div>
        {q && <button type="button" className="vcn-sbtn" onClick={() => setQ("")}><Icon n="x" size="s" /> Clear</button>}
        <span className="vcn-grow" />
        <button type="button" className="vcn-sbtn acc" onClick={() => { setRefreshing(true); reload(); }} disabled={loading}
          title="Recompute in-window & all-time leads/payments/enrollments per VSAT row, and CPL/CPA spend.">
          <Icon n={refreshing ? "loader" : "refresh"} spin={refreshing} /> {refreshing ? "Refreshing…" : "Refresh attribution"}
        </button>
      </div>

      <div className="vcn-kpis vtg-kpis" aria-busy={first}>
        <Kpi label="Unique Influencers" color="var(--a)" v={first ? null : fmtInt(k.influencers)} />
        <Kpi label="Unique UTMs" color="var(--lv)" v={first ? null : fmtInt(k.utms)} />
        <Kpi label="Overall CPL" color="var(--cy)" v={first ? null : fmtInr2(k.overallCpl)} />
        <Kpi label="Overall CPA" color="#f97d03" v={first ? null : fmtInr2(k.overallCpa)} />
        <Kpi label="Total Spend" color="var(--pink)" v={first ? null : fmtInr2(k.totalSpend)} />
        <Kpi label="Leads" color="var(--gr)" v={first ? null : fmtInt(k.leads)} sub={`${fmtInt(k.leadsAll)} all-time`} />
        <Kpi label="Payments" color="var(--pink)" v={first ? null : fmtInt(k.payments)} sub={`${fmtInt(k.paymentsAll)} all-time`} />
        <Kpi label="Enrollments" color="var(--lv)" v={first ? null : fmtInt(k.enrollmentsAll)} sub="all-time" />
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
          <table className="vcn-t" aria-label={isTrash ? "Telegram rows in the trash" : "Telegram rows"} aria-busy={loading}>
            <thead>
              <tr>
                <th className="chk" scope="col">
                  <input type="checkbox" className="vcn-chk" checked={allOn} ref={(el) => { if (el) el.indeterminate = someOn; }} onChange={toggleAll}
                    aria-label="Select all rows on this page" disabled={!pageRows.length} />
                </th>
                {shown.map((c) => (
                  <HeadCell key={c.key} c={c} trash={isTrash} sort={sort} onSort={() => setSort((s) => nextSort(s, c.key))}
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
                  <div className="vcn-empty" role="alert"><b>Couldn&apos;t load the Telegram rows.</b><span>{loadErr}</span>
                    <button type="button" className="vcn-b" style={{ marginTop: 14 }} onClick={reload}><Icon n="refresh" size="s" /> Try again</button></div>
                </td></tr>
              )}
              {data && allRows.length === 0 && (
                <tr><td className="msg" colSpan={shown.length + 2}>
                  <div className="vcn-empty">
                    <b>{isTrash ? "Trash is empty." : "No entries yet for Telegram."}</b>
                    <span>{isTrash ? "Deleted rows will appear here for 30 days." : <>Click <em>Add Row</em> or <em>Upload CSV</em> to get started.</>}</span>
                  </div>
                </td></tr>
              )}
              {data && allRows.length > 0 && filtered.length === 0 && (
                <tr><td className="msg" colSpan={shown.length + 2}>
                  <div className="vcn-empty"><b>No rows match this search.</b><span>Change the search, or clear it.</span>
                    <button type="button" className="vcn-b" style={{ marginTop: 14 }} onClick={() => setQ("")}><Icon n="x" size="s" /> Clear search</button></div>
                </td></tr>
              )}
              {data && pageRows.map((r) => (
                <tr key={r.id} className={sel.has(r.id) ? "sel" : ""}>
                  <td className="chk"><input type="checkbox" className="vcn-chk" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.influencer_name}`} /></td>
                  {shown.map((c) => (
                    <td key={c.key} className={c.hidden ? "hid" : undefined}>
                      <Cell c={c} r={r} serial={serials.get(r.id)} editable={!isTrash} campaigns={campaigns.map((x) => x.name)} onSet={inlineSet} />
                    </td>
                  ))}
                  <td className="act">
                    <div className="vcn-acts">
                      {isTrash ? (
                        <button type="button" className="vcn-ab res" onClick={() => restore([r.id])} disabled={restoring} aria-label={`Restore ${r.influencer_name}`}><Icon n="restore" size="s" /> Restore</button>
                      ) : <>
                        <button type="button" className="vcn-ab" onClick={() => setDlg({ k: "row", row: r })} aria-label={`Edit ${r.influencer_name}`}><Icon n="pencil" size="s" /> Edit</button>
                        <button type="button" className="vcn-ab dan" onClick={() => setDlg({ k: "del", row: r })} aria-label={`Delete ${r.influencer_name}`}><Icon n="trash" size="s" /> Delete</button>
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

      {dlg?.k === "row" && <RowDialog sb={sb} columns={columns} rows={allRows} campaigns={campaigns} editing={dlg.row} onClose={() => setDlg(null)} onSaved={done} />}
      {dlg?.k === "csv" && <CsvDialog sb={sb} columns={columns} onClose={() => { setDlg(null); reload(); }} onDone={done} onColumns={reload} />}
      {dlg?.k === "addcol" && <AddColumnDialog sb={sb} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === "rename" && <RenameColumnDialog sb={sb} column={dlg.col} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === "bulkupd" && <BulkUpdateDialog sb={sb} columns={columns} campaigns={campaigns} ids={[...sel]} onClose={() => setDlg(null)} onDone={done} />}
      {dlg?.k === "delcol" && (
        <ConfirmDialog title={`Delete “${dlg.col.label}”?`} confirm="Delete Column" busyText="Deleting…" danger onClose={() => setDlg(null)}
          body={<>The column will disappear from the table. Data in existing rows is <b>preserved</b> — if you add a column back with the same name later, the data reappears.</>}
          onConfirm={async () => { const r = await call(sb, "growth_tg_col_remove", { key: dlg.col.key }); if (r.error) return r.error; done("Column deleted."); return null; }} />
      )}
      {dlg?.k === "del" && (
        <ConfirmDialog title="Delete row?" confirm="Delete" busyText="Deleting…" danger onClose={() => setDlg(null)}
          body={<><b style={{ color: "var(--ink)" }}>{dlg.row.influencer_name || "This row"}</b> in Telegram will be moved to Trash. You can restore it within 30 days from the Trash view.</>}
          onConfirm={async () => { const r = await call(sb, "growth_tg_trash", { ids: [dlg.row.id], trash: true }); if (r.error) return r.error; done("Row moved to Trash."); return null; }} />
      )}
      {dlg?.k === "bulkdel" && (
        <ConfirmDialog danger onClose={() => setDlg(null)} busyText={isTrash ? "Purging…" : "Deleting…"} confirm={isTrash ? "Permanently delete" : "Delete"}
          title={isTrash ? `Permanently delete ${nSel} ${nSel === 1 ? "row" : "rows"}?` : `Delete ${nSel} ${nSel === 1 ? "row" : "rows"}?`}
          body={isTrash ? <><b style={{ color: "var(--pink)" }}>This cannot be undone.</b> Rows will be permanently removed from Telegram.</>
            : "Selected rows in Telegram will be moved to Trash. You can restore them within 30 days."}
          onConfirm={async () => {
            const ids = [...sel];
            const r = isTrash ? await call<{ deleted: number }>(sb, "growth_tg_purge", { ids }) : await call<{ changed: number }>(sb, "growth_tg_trash", { ids, trash: true });
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
  return (
    <div className={`vcn-kpi${hl ? " hl" : ""}`} style={{ ["--k" as string]: color }}>
      <div className="vcn-kpi-l">{label}</div>
      <div className={`vcn-kpi-v${v === null ? " ld" : ""}`} title={v ?? undefined}>{v ?? "…"}</div>
      {sub && v !== null && <div className="vcn-kpi-s">{sub}</div>}
    </div>
  );
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
  c: TgColumn; trash: boolean; sort: Sort; onSort: () => void; onDropOn: (from: string, to: string) => void;
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

function Cell({ c, r, serial, editable, campaigns, onSet }: {
  c: TgColumn; r: TgRow; serial?: number; editable: boolean; campaigns: string[]; onSet: (r: TgRow, v: string | null) => Promise<boolean>;
}): ReactNode {
  if (editable && c.key === "used_in") {
    return <EditableCell label={c.label} value={r.used_in} options={campaigns} clearable={false} onPick={(v) => onSet(r, v)} name={r.influencer_name} />;
  }
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

/** CRM inline dropdown: a badge that opens the allowed values; the change is saved at once. */
function EditableCell({ label, value, options, clearable, onPick, name }: {
  label: string; value: string | null; options: readonly string[]; clearable: boolean; onPick: (v: string | null) => Promise<boolean>; name: string;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(value);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPos = useMenuPos(open, btn, menuRef, "left");
  useEffect(() => setShown(value), [value]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    const raf = requestAnimationFrame(() =>
      (ref.current?.querySelector<HTMLButtonElement>(".vcn-eco[aria-checked='true']") ?? ref.current?.querySelector<HTMLButtonElement>(".vcn-eco"))?.focus({ preventScroll: true }));
    return () => { cancelAnimationFrame(raf); document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); };
  }, [open]);
  async function pick(v: string | null) {
    setOpen(false);
    if (v === shown) return;
    const prev = shown;
    setShown(v); setBusy(true);
    const okay = await onPick(v);
    setBusy(false);
    if (!okay) setShown(prev);
    btn.current?.focus();
  }
  const pos = (v: string | null) => v === "Yes";
  const keys = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".vcn-eco") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus({ preventScroll: true });
  };
  return (
    <div className="vcn-ec" ref={ref} onKeyDown={keys}>
      <button ref={btn} type="button" className={`vcn-ecb${pos(shown) ? " pos" : ""}${shown ? "" : " emp"}`} onClick={() => setOpen((o) => !o)} disabled={busy}
        title="Click to change" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label} for ${name}: ${shown ?? "empty"}. Click to change`}>
        <span>{shown ?? "—"}</span>{busy ? <Icon n="loader" spin size="xs" /> : <Icon n="down" size="xs" />}
      </button>
      {open && (
        <div ref={menuRef} style={menuPos} className="vcn-ecm" role="listbox" aria-label={label}>
          {options.map((o) => (
            <button key={o} type="button" role="option" aria-checked={shown === o} aria-selected={shown === o} className={`vcn-eco${pos(o) ? " pos" : ""}`} onClick={() => pick(o)}>
              <span>{o}</span>{shown === o && <Icon n="check" size="xs" />}
            </button>
          ))}
          {clearable && shown !== null && (
            <button type="button" role="option" aria-selected={false} className="vcn-eco clr" onClick={() => pick(null)}><Icon n="x" size="xs" /> <span>Clear</span></button>
          )}
        </div>
      )}
    </div>
  );
}
