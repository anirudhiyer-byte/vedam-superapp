"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";

/**
 * Admin tools for the VSAT Applications table (reached from the pipeline grid):
 *  · ApplicationEditor — click a student → edit ANY application_manager field. Changing an
 *    ID (application_id / wheebox_login_id) needs an explicit confirm. jsonb fields are shown
 *    read-only. Saves only what changed.
 *  · BulkImportDialog  — the "Import CSV" button on top of the table. Map any CSV column to any
 *    field, pick the match-key column, dry-run (writes nothing) then commit. Blank cells skipped.
 * Both call admin-gated SECURITY DEFINER RPCs (0169–0171); the database re-checks every call.
 */

type Col = { name: string; type: string };
const MATCH_KEYS = [
  { v: "application_id", label: "Application ID" },
  { v: "application_no", label: "Application No" },
  { v: "registered_email", label: "Email" },
  { v: "registered_mobile", label: "Phone" },
  { v: "wheebox_login_id", label: "Wheebox login ID" },
  { v: "lead_id", label: "Lead ID (UUID)" },
];
const ID_COLS = ["application_id", "wheebox_login_id"];
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-vx-faint";
const td = "px-3 py-2 align-top text-vx-ink/90";

function useColumns() {
  const [supabase] = useState(() => createClient());
  const [cols, setCols] = useState<Col[]>([]);
  useEffect(() => {
    void supabase.rpc("vsat_am_columns").then(({ data }) => {
      const d = data as { ok?: boolean; columns?: Col[] } | null;
      if (d?.ok) setCols(d.columns ?? []);
    });
  }, [supabase]);
  return cols;
}

/** Minimal RFC-4180-ish CSV parser: quotes, escaped quotes, commas and CR/LF in quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); cur = ""; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const Overlay = ({ onClose, children, wide }: { onClose: () => void; children: React.ReactNode; wide?: boolean }) => (
  <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/70 p-4" onClick={onClose}>
    <div className={cx(vx.card, "mt-8 w-full p-5 sm:p-6", wide ? "max-w-4xl" : "max-w-3xl")} onClick={(e) => e.stopPropagation()}>{children}</div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Application editor
// ─────────────────────────────────────────────────────────────────────────────
export function ApplicationEditor({ applicationId, onClose, onSaved }: { applicationId: string; onClose: () => void; onSaved?: () => void }) {
  const [supabase] = useState(() => createClient());
  const cols = useColumns();
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [locked, setLocked] = useState<string[]>(["lead_id", "created_at"]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [confirmIds, setConfirmIds] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void supabase.rpc("vsat_application_admin_get", { p: { applicationId } }).then(({ data, error }) => {
      if (error) { setMsg(error.message); return; }
      const d = data as { row?: Record<string, unknown>; locked?: string[] };
      setRow(d?.row ?? null); setLocked(d?.locked ?? ["lead_id", "created_at"]);
    });
  }, [supabase, applicationId]);

  const jsonbCols = useMemo(() => new Set(cols.filter((c) => c.type === "jsonb").map((c) => c.name)), [cols]);
  const changed = useMemo(() => {
    if (!row) return {} as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(edits)) { const orig = s(row[k]); if (v !== orig) out[k] = v === "" ? null : v; }
    return out;
  }, [edits, row]);
  const touchesId = Object.keys(changed).some((k) => ID_COLS.includes(k));
  const keys = useMemo(() => {
    if (!row) return [] as string[];
    const all = Object.keys(row).sort(); const f = filter.trim().toLowerCase();
    return f ? all.filter((k) => k.toLowerCase().includes(f)) : all;
  }, [row, filter]);

  async function save() {
    if (Object.keys(changed).length === 0) { setMsg("No changes."); return; }
    if (touchesId && !confirmIds) { setMsg("Tick the confirm box to change an ID."); return; }
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("vsat_application_admin_update", { p: { applicationId, changes: changed, confirmIds } });
    setBusy(false);
    if (error || !(data as { ok?: boolean })?.ok) { setMsg(error?.message || "Update failed."); return; }
    onSaved?.(); onClose();
  }

  return (
    <Overlay onClose={() => !busy && onClose()}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={vx.h2}>Edit application · <span className="font-mono text-[14px] text-vx-mut">{applicationId}</span></h3>
        <button className={cx(vx.btn, vx.ghost, vx.sm)} onClick={onClose} disabled={busy}>Close</button>
      </div>
      {!row ? <p className="mt-4 text-[13px] text-vx-faint">{msg || "Loading…"}</p> : (
        <>
          <input className={cx(vx.input, "mt-3")} placeholder="Filter fields…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="mt-3 max-h-[52vh] overflow-auto rounded-xl border border-vx-line">
            <table className="w-full text-[13px]"><tbody>
              {keys.map((k) => {
                const isJson = jsonbCols.has(k) || (typeof row[k] === "object" && row[k] !== null);
                const isLocked = locked.includes(k) || isJson;
                const val = k in edits ? edits[k] : (isJson ? JSON.stringify(row[k]) : s(row[k]));
                const dirty = k in changed;
                return (
                  <tr key={k} className={cx("border-t border-vx-line/60", dirty && "bg-vx-violet/10")}>
                    <td className={cx(td, "w-[38%] font-mono text-vx-mut")}>{k}{ID_COLS.includes(k) && <span className="ml-1 text-vx-red">*</span>}</td>
                    <td className={td}><input className={cx(vx.field, "h-9 w-full", isLocked && "opacity-50")} value={val} disabled={isLocked}
                      onChange={(e) => setEdits((ed) => ({ ...ed, [k]: e.target.value }))} /></td>
                  </tr>
                );
              })}
            </tbody></table>
          </div>
          {touchesId && (
            <label className="mt-3 flex items-start gap-2 text-[13px] text-vx-red">
              <input type="checkbox" className="mt-0.5" checked={confirmIds} onChange={(e) => setConfirmIds(e.target.checked)} />
              I understand changing an ID (application ID / Wheebox login) changes how results and login match this student; historical rows keyed to the old ID won’t move.
            </label>
          )}
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-[13px] text-vx-faint">{Object.keys(changed).length} change(s){msg ? ` · ${msg}` : ""}</span>
            <div className="flex gap-2">
              <button className={cx(vx.btn, vx.ghost)} onClick={onClose} disabled={busy}>Cancel</button>
              <button className={cx(vx.btn, vx.primary)} onClick={save} disabled={busy || Object.keys(changed).length === 0}>{busy ? "Saving…" : "Save changes"}</button>
            </div>
          </div>
        </>
      )}
    </Overlay>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk CSV importer
// ─────────────────────────────────────────────────────────────────────────────
export function BulkImportDialog({ onClose }: { onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const cols = useColumns();
  const colNames = cols.map((c) => c.name);
  const fileRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [matchKey, setMatchKey] = useState("application_id");
  const [matchHeader, setMatchHeader] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dry, setDry] = useState<Record<string, unknown> | null>(null);
  const [committed, setCommitted] = useState<Record<string, unknown> | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setErr(""); setDry(null); setCommitted(null);
    const r = new FileReader();
    r.onload = () => {
      const grid = parseCsv(String(r.result || ""));
      if (grid.length < 2) { setErr("CSV needs a header row and at least one data row."); return; }
      const hdr = grid[0].map((h) => h.trim());
      setHeaders(hdr); setDataRows(grid.slice(1)); setMatchHeader(hdr[0] ?? "");
      const names = new Set(colNames); const m: Record<string, string> = {};
      for (const h of hdr) m[h] = names.has(h) ? h : "";
      setMapping(m);
    };
    r.readAsText(f);
  }

  function buildRows() {
    const mi = headers.indexOf(matchHeader);
    return dataRows.map((cells) => {
      const values: Record<string, string> = {};
      headers.forEach((h, i) => { const col = mapping[h]; if (col && h !== matchHeader) values[col] = (cells[i] ?? "").trim(); });
      return { key: (cells[mi] ?? "").trim(), values };
    });
  }

  async function run(mode: "dry_run" | "commit") {
    setBusy(true); setErr(""); if (mode === "dry_run") { setDry(null); setCommitted(null); }
    const { data, error } = await supabase.rpc("vsat_app_bulk_update", { p: { matchKey, mode, rows: buildRows() } });
    setBusy(false);
    if (error || !(data as { ok?: boolean })?.ok) { setErr(error?.message || "Import failed."); return; }
    if (mode === "dry_run") setDry(data as Record<string, unknown>); else { setCommitted(data as Record<string, unknown>); setDry(null); }
  }

  const mappedCount = Object.entries(mapping).filter(([h, c]) => c && h !== matchHeader).length;

  const Summary = ({ r, title }: { r: Record<string, unknown>; title: string }) => (
    <div className={cx(vx.well, "mt-3 p-4")}>
      <div className={vx.h3}>{title} — mode: {s(r.mode)}</div>
      <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
        {["total", "matched", "updated", "unmatched", "ambiguous", "errored"].map((k) => (
          <span key={k} className="rounded-lg border border-vx-line2 bg-black/20 px-2.5 py-1 text-vx-ink/90"><b>{s(r[k])}</b> {k}</span>
        ))}
      </div>
      {Array.isArray(r.samples) && (r.samples as unknown[]).length > 0 && (
        <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-vx-line2">
          <table className="w-full text-[12px]"><thead className="sticky top-0 bg-black/40"><tr><th className={th}>#</th><th className={th}>Key</th><th className={th}>Outcome</th><th className={th}>Columns</th></tr></thead>
            <tbody>{(r.samples as Record<string, unknown>[]).map((x, i) => (
              <tr key={i} className="border-t border-vx-line2/50">
                <td className={td}>{s(x.row)}</td><td className={cx(td, "font-mono")}>{dash(x.key)}</td>
                <td className={cx(td, /^(error|ambig|unmatched)/.test(s(x.outcome)) ? "text-vx-red" : "text-emerald-300")}>{s(x.outcome)}</td>
                <td className={cx(td, "font-mono text-vx-faint")}>{Array.isArray(x.cols) ? (x.cols as string[]).join(", ") : ""}</td>
              </tr>))}
            </tbody></table>
        </div>
      )}
    </div>
  );

  return (
    <Overlay onClose={() => !busy && onClose()} wide>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className={vx.h2}>Bulk import from CSV</h3>
          <p className={vx.sub}>Map each column, pick how rows match a student, dry-run, then commit. Blank cells are skipped — they never wipe existing data.</p>
        </div>
        <button className={cx(vx.btn, vx.ghost, vx.sm)} onClick={onClose} disabled={busy}>Close</button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="text-[13px] text-vx-mut file:mr-3 file:rounded-lg file:border-0 file:bg-vx-violet file:px-3 file:py-1.5 file:text-white" />
        {headers.length > 0 && <span className="text-[13px] text-vx-faint">{headers.length} columns · {dataRows.length} rows</span>}
      </div>

      {headers.length > 0 && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div><label className={vx.label}>Match each row to a student by</label>
              <select className={vx.field} value={matchKey} onChange={(e) => setMatchKey(e.target.value)}>{MATCH_KEYS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}</select></div>
            <div><label className={vx.label}>…reading that value from column</label>
              <select className={vx.field} value={matchHeader} onChange={(e) => setMatchHeader(e.target.value)}>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></div>
            <span className="text-[13px] text-vx-faint">{mappedCount} column(s) mapped to write</span>
          </div>

          <div className="max-h-72 overflow-auto rounded-xl border border-vx-line">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-black/40"><tr><th className={th}>CSV column</th><th className={th}>First value</th><th className={th}>→ write to column</th></tr></thead>
              <tbody>
                {headers.map((h, i) => (
                  <tr key={h} className={cx("border-t border-vx-line/60", h === matchHeader && "bg-vx-violet/10")}>
                    <td className={cx(td, "font-mono")}>{h}{h === matchHeader ? " (match key)" : ""}</td>
                    <td className={cx(td, "text-vx-faint")}>{dash(dataRows[0]?.[i])}</td>
                    <td className={td}>
                      <select className={cx(vx.field, "h-9 w-full")} value={mapping[h] ?? ""} disabled={h === matchHeader} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}>
                        <option value="">— ignore —</option>
                        {colNames.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {err && <p className="text-[13px] text-vx-red">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button className={cx(vx.btn, vx.secondary)} disabled={busy || !matchHeader || mappedCount === 0} onClick={() => run("dry_run")}>{busy ? "Checking…" : "Dry run (no writes)"}</button>
            <button className={cx(vx.btn, vx.primary)} disabled={busy || !dry} onClick={() => { if (confirm(`Commit ${s(dry?.matched)} matched row(s)? This writes to the Application Manager.`)) void run("commit"); }}>Commit changes</button>
          </div>
          {dry && <Summary r={dry} title="Dry run" />}
          {committed && <Summary r={committed} title="Committed" />}
        </div>
      )}
    </Overlay>
  );
}
