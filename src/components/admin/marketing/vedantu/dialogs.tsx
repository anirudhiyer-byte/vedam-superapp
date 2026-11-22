"use client";

import { useEffect, useId, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  colKeyOf, EDITABLE_STD, importErrorLines, importTargets, mapRecords, mappingErrors, parseCsv,
  type VdColumn, type VdRow, type CsvParsed,
} from "@/lib/growth/vedantu";
import { call, type Client } from "./api";
import { Icon } from "../consultants/icons";

/** Dialogs of the Vedantu Listing (same frames as the Consultant / Telegram Listing dialogs, Vedantu fields). */

const STD_KEYS = new Set<string>(EDITABLE_STD);
/** Channel: pick an existing name or type a new one (CRM combo field). */
const COMBO_KEYS = new Set(["channel"]);

// ───────────────────────────── dialog shell ─────────────────────────────

/**
 * Dialog frame (overlay + panel). Escape and a click on the backdrop close it (not while saving); focus moves in, stays in
 * and returns on close. Each dialog builds its own header / body / footer, like the CRM dialogs do.
 */
function Dialog({ ov = "", cls = "", busy, onClose, labelledBy, children }: {
  ov?: string; cls?: string; busy?: boolean; onClose: () => void; labelledBy: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; });
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>("input,select,textarea,button:not(.vcn-x)");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (el?.querySelector(".vcn-cp")) return;   // an open pick-list inside the dialog closes first
        e.stopPropagation(); if (!busyRef.current) closeRef.current(); return;
      }
      if (e.key !== "Tab" || !el) return;
      const f = [...el.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])")];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); before?.focus?.(); };
  }, []);
  return (
    <div className={`vcn-ov ${ov}`} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} className={`vcn-dlg ${cls}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>{children}</div>
    </div>
  );
}

/** Header with the orange gradient title, a one-line hint and the close button (row / add column / CSV dialogs). */
function GradHead({ id, title, sub, busy, onClose }: { id: string; title: string; sub?: ReactNode; busy?: boolean; onClose: () => void }) {
  return (
    <div className="vcn-dh">
      <div><h2 id={id} className="g">{title}</h2>{sub && <p>{sub}</p>}</div>
      <button type="button" className="vcn-x" onClick={onClose} disabled={busy} aria-label="Close"><Icon n="x" size="l" /></button>
    </div>
  );
}

function ErrBox({ msg, lines }: { msg: string; lines?: string[] }) {
  if (!msg) return null;
  return (
    <div className="vcn-err" role="alert">
      <Icon n="alert" />
      <div>{msg}{lines && lines.length > 0 && <ul className="vcn-errlist">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}</div>
    </div>
  );
}

const Saving = ({ text }: { text: string }) => <><Icon n="loader" spin /> {text}</>;

// ───────────────────────────── pick-list (CRM ComboPicker) ─────────────────────────────

const caretToEnd = (e: ReactFocusEvent<HTMLInputElement>) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n); };

/** A button that opens a small list with a search box: pick an existing value, or (allowNew) use what was typed. */
function ComboPicker({ id, options, value, onChange, placeholder, allowNew, invalid, describedBy, autoFocus }: {
  id: string; options: readonly string[]; value: string; onChange: (v: string) => void; placeholder: string; allowNew: boolean;
  invalid?: boolean; describedBy?: string; autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); };
  }, [open]);
  const q = search.trim();
  const shownOpts = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;
  const exact = options.some((o) => o.toLowerCase() === q.toLowerCase());
  const create = allowNew && q.length > 0 && !exact;
  const custom = !!value && !options.includes(value);
  const pick = (v: string) => { onChange(v); setOpen(false); setSearch(""); btn.current?.focus(); };
  // Typing a letter on the closed button opens the list with that letter (otherwise letters before the first Space were lost)
  const typeToOpen = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open || e.key.length !== 1 || e.key === " " || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    setSearch(e.key);
    setOpen(true);
  };
  return (
    <div className="vcn-combo" ref={box}>
      <button ref={btn} id={id} type="button" className={`vcn-cb${invalid ? " bad" : ""}`} aria-haspopup="listbox" aria-expanded={open}
        aria-describedby={describedBy} onClick={() => setOpen((o) => !o)} onKeyDown={typeToOpen} {...(autoFocus ? { "data-autofocus": true } : {})}>
        <span className={value ? "" : "ph"}>{value || placeholder}{custom && <em>custom</em>}</span>
        <Icon n="down" />
      </button>
      {open && (
        <div className="vcn-cp">
          <div className="vcn-cp-s">
            <Icon n="search" size="s" />
            <input type="text" value={search} autoFocus autoComplete="off" onFocus={caretToEnd} aria-label="Filter the list" placeholder={allowNew ? "Type to filter or add new…" : "Type to filter…"}
              onChange={(e) => setSearch(e.target.value)} maxLength={120}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (create) pick(q); else if (shownOpts.length === 1) pick(shownOpts[0]); } }} />
          </div>
          <div className="vcn-cp-l" role="listbox" aria-label="Options">
            {value && <button type="button" className="vcn-cp-o clr" onClick={() => pick("")}>Clear</button>}
            {shownOpts.length === 0 && !create && <div className="vcn-cp-n">No matching options</div>}
            {shownOpts.map((o) => (
              <button key={o} type="button" role="option" aria-selected={value === o} className="vcn-cp-o" onClick={() => pick(o)}>
                <span>{o}</span>{value === o && <Icon n="check" size="s" />}
              </button>
            ))}
            {create && (
              <button type="button" className="vcn-cp-o new" onClick={() => pick(q)}><Icon n="plus" size="s" /><span>Use <b>&ldquo;{q}&rdquo;</b></span></button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── add / edit row ─────────────────────────────

function rowValues(r: VdRow | null, cols: VdColumn[]): Record<string, string> {
  const v: Record<string, string> = {};
  for (const c of cols) {
    if (!r) { v[c.key] = ""; continue; }
    if (STD_KEYS.has(c.key)) {
      const x = (r as unknown as Record<string, unknown>)[c.key];
      v[c.key] = x == null ? "" : (c.key === "video_spend" || c.key === "cpa") ? (Number(x) ? String(Number(x)) : "") : String(x);
    } else v[c.key] = r.extra?.[c.key] ?? "";
  }
  return v;
}

export function RowDialog({ sb, columns, rows, editing, onClose, onSaved }: {
  sb: Client; columns: VdColumn[]; rows: VdRow[]; editing: VdRow | null; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const cols = useMemo(() => columns.filter((c) => c.type !== "computed"), [columns]);
  const [vals, setVals] = useState(() => rowValues(editing, cols));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [top, setTop] = useState("");
  const [busy, setBusy] = useState(false);
  const labelOf = (k: string) => columns.find((c) => c.key === k)?.label;
  const options = useMemo(() => {
    const o: Record<string, string[]> = {};
    for (const k of COMBO_KEYS) {
      o[k] = [...new Set(rows.map((r) => String((r as unknown as Record<string, unknown>)[k] ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    }
    return o;
  }, [rows]);
  const set = (k: string, v: string) => { setVals((s) => ({ ...s, [k]: v })); setErrs((e) => (e[k] ? { ...e, [k]: "" } : e)); };
  const dlId = useId();

  async function save() {
    const fe: Record<string, string> = {};
    for (const c of cols) {
      const v = (vals[c.key] ?? "").trim();
      if (c.required && !v) fe[c.key] = `${c.label} is required.`;
      else if (v && c.type === "url" && !/^https?:\/\/\S+$/i.test(v)) fe[c.key] = "Enter a full link starting with http:// or https://.";
      else if (v && c.type === "number" && !Number.isFinite(Number(v.replace(/[₹,\s]/g, "")))) fe[c.key] = "Enter a number.";
    }
    setErrs(fe);
    if (Object.values(fe).some(Boolean)) return;
    const row: Record<string, unknown> = {};
    const extra: Record<string, string> = {};
    for (const c of cols) {
      const v = (vals[c.key] ?? "").trim();
      if (STD_KEYS.has(c.key)) row[c.key] = v;
      else extra[c.key] = v;
    }
    if (Object.keys(extra).length) row.extra = extra;
    if (editing) row.id = editing.id;
    setBusy(true); setTop("");
    const r = await call<{ id: string }>(sb, "growth_vd_save", { row }, labelOf);
    setBusy(false);
    if (r.error) {
      const m = /^(?:REQUIRED|BAD_VALUE): ([a-z0-9_]+)$/.exec(r.code ?? "");
      if (m && cols.some((c) => c.key === m[1])) setErrs((e) => ({ ...e, [m[1]]: r.error! }));
      else if (r.code === "DUPLICATE_UTM") setErrs((e) => ({ ...e, utm_link: r.error! }));
      else setTop(r.error);
      return;
    }
    onSaved(editing ? "Row updated." : "Row added.");
  }

  return (
    <Dialog ov="dk fs" cls="x2 modal fs" busy={busy} onClose={onClose} labelledBy={`${dlId}-t`}>
      <GradHead id={`${dlId}-t`} title={editing ? "Edit Vedantu Row" : "Add Vedantu Row"} busy={busy} onClose={onClose}
        sub={editing ? "Update fields and save." : "Fill in the fields below. Required fields marked with *."} />
      <div className="vcn-db">
        <ErrBox msg={top} />
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: "contents" }}>
          {cols.map((c, i) => {
            const id = `${dlId}-${c.key}`;
            const err = errs[c.key];
            const common = { id, "aria-invalid": !!err || undefined, "aria-describedby": err ? `${id}-e` : undefined, ...(i === 0 ? { "data-autofocus": true } : {}) };
            const cls = `vcn-fin${err ? " bad" : ""}`;
            let input: ReactNode;
            if (c.type === "number") {
              input = <input {...common} className={cls} inputMode="decimal" placeholder="0" value={vals[c.key]} onChange={(e) => set(c.key, e.target.value)} maxLength={20} />;
            } else if (c.type === "date") {
              input = <input {...common} className={cls} type="date" style={{ colorScheme: "dark" }} value={vals[c.key]} onChange={(e) => set(c.key, e.target.value)} />;
            } else if (c.type === "url") {
              input = <input {...common} className={cls} type="url" inputMode="url" placeholder="https://" value={vals[c.key]} onChange={(e) => set(c.key, e.target.value)} maxLength={2000} spellCheck={false} autoCapitalize="off" />;
            } else if ((options[c.key] ?? []).length > 0 && COMBO_KEYS.has(c.key)) {
              input = <ComboPicker id={id} options={options[c.key]} value={vals[c.key]} onChange={(v) => set(c.key, v)} allowNew
                placeholder={`Pick a ${c.label.toLowerCase()} or type a new one…`} invalid={!!err} describedBy={err ? `${id}-e` : undefined} autoFocus={i === 0} />;
            } else {
              input = <input {...common} className={cls} value={vals[c.key]} onChange={(e) => set(c.key, e.target.value)}
                maxLength={c.key === "channel" ? 120 : c.key === "notes" ? 500 : c.standard ? 80 : 500} autoComplete="off" />;
            }
            return (
              <div key={c.key}>
                <label className="vcn-fl" htmlFor={id}>{c.label}{c.required && <span className="vcn-req"> *</span>}</label>
                {input}
                {err && <div className="vcn-fe" id={`${id}-e`}>{err}</div>}
              </div>
            );
          })}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </div>
      <div className="vcn-df">
        <button type="button" className="vcn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="vcn-go" onClick={save} disabled={busy}>
          {busy ? <Saving text="Saving…" /> : <><Icon n="save" /> {editing ? "Save Changes" : "Add Row"}</>}
        </button>
      </div>
    </Dialog>
  );
}

// ───────────────────────────── confirm (delete row / rows / column) ─────────────────────────────

export function ConfirmDialog({ title, body, confirm, busyText, danger, onClose, onConfirm }: {
  title: string; body: ReactNode; confirm: string; busyText: string; danger?: boolean; onClose: () => void; onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const id = useId();
  async function go() {
    setBusy(true); setErr("");
    const e = await onConfirm();
    setBusy(false);
    if (e) setErr(e);
  }
  return (
    <Dialog ov="z6" cls="md" busy={busy} onClose={onClose} labelledBy={`${id}-t`}>
      <div className="vcn-cf-h">
        <div className="vcn-cf-t">
          <div className="vcn-cf-i"><Icon n="warn" size="l" /></div>
          <h2 id={`${id}-t`}>{title}</h2>
        </div>
        {err && <div style={{ margin: "12px 0" }}><ErrBox msg={err} /></div>}
        <p className="vcn-cf-p">{body}</p>
      </div>
      <div className="vcn-df nb">
        <button type="button" className="vcn-cancel s" onClick={onClose} disabled={busy} data-autofocus>Cancel</button>
        <button type="button" className={`vcn-go${danger ? " dan" : ""}`} onClick={go} disabled={busy}>
          {busy ? <Saving text={busyText} /> : <><Icon n="trash" /> {confirm}</>}
        </button>
      </div>
    </Dialog>
  );
}

// ───────────────────────────── bulk update ─────────────────────────────

export function BulkUpdateDialog({ sb, columns, ids, onClose, onDone }: {
  sb: Client; columns: VdColumn[]; ids: string[]; onClose: () => void; onDone: (msg: string) => void;
}) {
  const eligible = columns.filter((c) => c.type !== "computed" && c.key !== "utm_link");   // one UTM per row; Campaign and the counts are worked out
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const col = eligible.find((c) => c.key === key);
  const labelOf = (k: string) => columns.find((c) => c.key === k)?.label;
  const dlId = useId();
  async function go() {
    if (!col) return setErr("Pick a column first.");
    if (col.required && !value.trim()) return setErr(`${col.label} is required.`);
    setBusy(true); setErr("");
    const r = await call<{ changed: number }>(sb, "growth_vd_bulk_update", { ids, key, value: value.trim() || null }, labelOf);
    setBusy(false);
    if (r.error) return setErr(r.error);
    onDone(`${r.data?.changed ?? ids.length} ${ids.length === 1 ? "row" : "rows"} updated.`);
  }
  const n = ids.length;
  const rows = `${n} ${n === 1 ? "row" : "rows"}`;
  return (
    <Dialog ov="dk nb" cls="md pad" busy={busy} onClose={onClose} labelledBy={`${dlId}-t`}>
      <div className="vcn-bu-h">
        <h2 id={`${dlId}-t`}>Bulk update {rows}</h2>
        <button type="button" className="vcn-x" onClick={onClose} disabled={busy} aria-label="Close"><Icon n="x" /></button>
      </div>
      <p className="vcn-bu-p">Pick a column and a value. Every selected row gets the same value for that column — other columns are untouched.</p>
      {err && <div style={{ marginBottom: 16 }}><ErrBox msg={err} /></div>}
      <label className="vcn-fl w" htmlFor={`${dlId}-c`}>Column</label>
      <select id={`${dlId}-c`} className="vcn-bu-in mb" value={key} onChange={(e) => { setKey(e.target.value); setValue(""); setErr(""); }} data-autofocus>
        <option value="">Pick a column…</option>
        {eligible.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      {col && <>
        <label className="vcn-fl w" htmlFor={`${dlId}-v`}>Value</label>
        {col.type === "number" ? (
          <input id={`${dlId}-v`} className="vcn-bu-in" inputMode="decimal" placeholder="Enter a number" value={value} onChange={(e) => setValue(e.target.value)} maxLength={20} />
        ) : col.type === "date" ? (
          <input id={`${dlId}-v`} className="vcn-bu-in" type="date" style={{ colorScheme: "dark" }} value={value} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <input id={`${dlId}-v`} className="vcn-bu-in" type={col.type === "url" ? "url" : "text"} placeholder={col.type === "url" ? "https://…" : "Enter a value"}
            value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} />
        )}
        {!col.required && <p className="vcn-fh it" style={{ margin: "0 0 16px" }}>Leave blank to clear this column on all selected rows.</p>}
      </>}
      <div className="vcn-bu-f">
        <button type="button" className="vcn-cancel md" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="vcn-go md" onClick={go} disabled={busy || !col}>
          {busy ? <Icon n="loader" spin /> : <Icon n="check" />} Apply to {rows}
        </button>
      </div>
    </Dialog>
  );
}

// ───────────────────────────── add / rename column ─────────────────────────────

const TYPES: { v: "text" | "number" | "date" | "url"; l: string; d: string }[] = [
  { v: "text", l: "Text", d: "Plain text (group names, notes)" },
  { v: "number", l: "Number", d: "Numeric values (counts, amounts)" },
  { v: "date", l: "Date", d: "Calendar date" },
  { v: "url", l: "URL", d: "Link to a webpage" },
];

export function AddColumnDialog({ sb, onClose, onDone }: { sb: Client; onClose: () => void; onDone: (msg: string) => void }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<"text" | "number" | "date" | "url">("text");
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const id = useId();
  async function go() {
    if (!label.trim()) return setErr("Column name is required.");
    setBusy(true); setErr("");
    const r = await call<{ key: string }>(sb, "growth_vd_col_add", { label: label.trim(), type, required });
    setBusy(false);
    if (r.error) return setErr(r.error);
    onDone(`Column “${label.trim()}” added.`);
  }
  return (
    <Dialog cls="lg" busy={busy} onClose={onClose} labelledBy={`${id}-t`}>
      <GradHead id={`${id}-t`} title="Add Column to Vedantu" sub="The new column appears in the table immediately." busy={busy} onClose={onClose} />
      <div className="vcn-db g20">
        <ErrBox msg={err} />
        <form onSubmit={(e) => { e.preventDefault(); void go(); }} style={{ display: "contents" }}>
          <div>
            <label className="vcn-fl" htmlFor={`${id}-l`}>Column Name</label>
            <input id={`${id}-l`} className="vcn-fin sf" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Language" maxLength={60} data-autofocus />
            <div className="vcn-fh mono">Internal key: {label.trim() ? colKeyOf(label.trim()) : "—"}</div>
          </div>
          <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <legend className="vcn-fl" style={{ padding: 0 }}>Type</legend>
            <div className="vcn-types">
              {TYPES.map((t) => (
                <label key={t.v} className={`vcn-type${type === t.v ? " on" : ""}`}>
                  <input type="radio" name={`${id}-t`} value={t.v} checked={type === t.v} onChange={() => setType(t.v)} />
                  <div><b>{t.l}</b><span>{t.d}</span></div>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="vcn-req-l">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            <b>Required field</b>
            <span>(Rows can&apos;t be saved if this is empty)</span>
          </label>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </div>
      <div className="vcn-df">
        <button type="button" className="vcn-cancel s" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="vcn-go" onClick={go} disabled={busy || !label.trim()}>{busy ? <Saving text="Adding…" /> : <><Icon n="plus" /> Add Column</>}</button>
      </div>
    </Dialog>
  );
}

export function RenameColumnDialog({ sb, column, onClose, onDone }: { sb: Client; column: VdColumn; onClose: () => void; onDone: (msg: string) => void }) {
  const [label, setLabel] = useState(column.label);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const id = useId();
  const same = label.trim() === column.label;
  async function go() {
    if (!label.trim() || same) return;
    setBusy(true); setErr("");
    const r = await call(sb, "growth_vd_col_update", { key: column.key, label: label.trim() });
    setBusy(false);
    if (r.error) return setErr(r.error);
    onDone("Column renamed.");
  }
  return (
    <Dialog ov="z6" cls="md" busy={busy} onClose={onClose} labelledBy={`${id}-t`}>
      <div className="vcn-dh">
        <h2 id={`${id}-t`} className="sm">Rename column</h2>
        <button type="button" className="vcn-x" onClick={onClose} disabled={busy} aria-label="Close"><Icon n="x" size="l" /></button>
      </div>
      <div className="vcn-db g12">
        <ErrBox msg={err} />
        <form onSubmit={(e) => { e.preventDefault(); void go(); }} style={{ display: "contents" }}>
          <div>
            <label className="vcn-fl" htmlFor={`${id}-l`}>New Label</label>
            <input id={`${id}-l`} className="vcn-fin sf" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} data-autofocus />
            <div className="vcn-fh">Only the display label changes. The internal key stays the same to preserve existing data.</div>
          </div>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </div>
      <div className="vcn-df">
        <button type="button" className="vcn-cancel s" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="vcn-go" onClick={go} disabled={busy || !label.trim() || same}>{busy ? <Saving text="Saving…" /> : <><Icon n="save" /> Save</>}</button>
      </div>
    </Dialog>
  );
}

// ───────────────────────────── CSV upload ─────────────────────────────

type MapTarget = string;   // column key | "" (skip) | "__new__"

export function CsvDialog({ sb, columns, onClose, onDone, onColumns }: {
  sb: Client; columns: VdColumn[]; onClose: () => void; onDone: (msg: string) => void; onColumns: () => void;
}) {
  const [step, setStep] = useState<"pick" | "map" | "result">("pick");
  const [file, setFile] = useState("");
  const [parsed, setParsed] = useState<CsvParsed | null>(null);
  const [mapping, setMapping] = useState<MapTarget[]>([]);
  const [newType, setNewType] = useState<("text" | "number" | "date" | "url")[]>([]);
  const [matchUtm, setMatchUtm] = useState(true);
  const [always, setAlways] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<{ added: number; updated: number; cols: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const targets = importTargets(columns);
  const labelOf = (k: string) => columns.find((c) => c.key === k)?.label;
  const mode: "upsert" | "add" = always ? "add" : "upsert";
  const canUpload = matchUtm || always;

  async function pick(f: File) {
    setErr(""); setLines([]);
    if (f.size > 5 * 1024 * 1024) return setErr("The file is larger than 5 MB.");
    const p = parseCsv(await f.text(), columns);
    if (!p.ok) return setErr(p.error);
    setFile(f.name); setParsed(p.data); setMapping(p.data.guess); setNewType(p.data.headers.map(() => "text")); setStep("map");
  }

  // a header mapped to "+ Add as new column" counts as that new column for the checks below
  const planned = useMemo(() => {
    const extraCols: VdColumn[] = [];
    const m = mapping.map((k, i) => {
      if (k !== "__new__") return k;
      const key = `__new_${i}`;
      extraCols.push({ key, label: parsed?.headers[i] ?? key, type: newType[i] ?? "text", required: false, standard: false, hidden: false });
      return key;
    });
    return { m, cols: [...columns, ...extraCols] };
  }, [mapping, newType, columns, parsed]);
  const mapErrs = parsed && canUpload ? mappingErrors(planned.m, planned.cols, mode) : [];
  const utmMapped = mapping.includes("utm_link");

  async function upload() {
    if (!parsed || mapErrs.length || !canUpload) return;
    setBusy(true); setErr(""); setLines([]);
    // 1. new columns first (the database checks their names)
    const m = [...mapping];
    for (let i = 0; i < m.length; i++) {
      if (m[i] !== "__new__") continue;
      const r = await call<{ key: string }>(sb, "growth_vd_col_add", { label: parsed.headers[i], type: newType[i] ?? "text" });
      if (r.error || !r.data) {
        setBusy(false);
        if (i > 0 && m.slice(0, i).some((_, j) => mapping[j] === "__new__")) { setMapping(m); onColumns(); }
        return setErr(`Column “${parsed.headers[i]}”: ${r.error}`);
      }
      m[i] = r.data.key;
    }
    const added: VdColumn[] = m.filter((_, i) => mapping[i] === "__new__")
      .map((k) => ({ key: k, label: k, type: "text", required: false, standard: false, hidden: false }));
    const cols = [...columns, ...added];
    // 2. rows, all or nothing
    const rows = mapRecords(parsed, m, cols);
    const r = await call<{ added: number; updated: number }>(sb, "growth_vd_import", { rows, mode }, labelOf);
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      setLines(importErrorLines(r.detail, labelOf));
      if (m.some((_, i) => mapping[i] === "__new__")) { setMapping(m); onColumns(); }   // the new columns exist now
      return;
    }
    setResult({ added: r.data?.added ?? 0, updated: r.data?.updated ?? 0, cols: mapping.filter((k) => k === "__new__").length });
    setStep("result");
  }

  const summary = result ? `${result.added} added · ${result.updated} updated.` : "";
  const finish = () => onDone(`CSV uploaded: ${summary}`);
  const n = parsed?.records.length ?? 0;
  const sub = step === "pick" ? "Pick a CSV file to upload." : step === "map" && parsed
    ? `${file} · ${n} ${n === 1 ? "row" : "rows"} · ${parsed.headers.length} columns` : "Upload complete.";
  const close = step === "result" ? finish : onClose;
  return (
    <Dialog cls="x3" busy={busy} onClose={close} labelledBy={`${id}-t`}>
      <GradHead id={`${id}-t`} title="Upload CSV to Vedantu" sub={sub} busy={busy} onClose={close} />
      <div className="vcn-db blk">
        {err && <div style={{ marginBottom: 16 }}><ErrBox msg={err} lines={lines} /></div>}
        {step === "pick" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
            <button type="button" className="vcn-drop" onClick={() => input.current?.click()} data-autofocus>
              <Icon n="file" size="x4" /><b>Choose a CSV file</b><span>First row must contain column headers</span>
            </button>
            <p className="vcn-rule"><strong>Upsert rule:</strong> Rows are matched on UTM Link (and, when the file has a Live Date, on the same VSAT). A match → updated (e.g. just Actual Views). No match → inserted as a new row. Nothing is saved if any row has an error.</p>
          </div>
        )}
        {step === "map" && parsed && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="vcn-mapbox"><div style={{ overflowX: "auto" }}>
              <table className="vcn-map">
                <thead><tr><th scope="col">CSV Header</th><th scope="col">Sample</th><th scope="col">Map To</th></tr></thead>
                <tbody>
                  {parsed.headers.map((h, i) => (
                    <tr key={i}>
                      <td className="h">{h || <span className="vcn-dash">(empty)</span>}</td>
                      <td className="s" title={parsed.records[0]?.[i] ?? ""}>{parsed.records[0]?.[i] || "—"}</td>
                      <td>
                        <div className="vcn-mapc">
                          <select aria-label={`Map ${h || `column ${i + 1}`} to`} value={mapping[i] ?? ""}
                            onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? e.target.value : x)))}>
                            <option value="__new__">+ Add as new column</option>
                            <option value="">Skip column</option>
                            <optgroup label="Existing columns">{targets.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
                          </select>
                          {mapping[i] === "__new__" && (
                            <select className="ty" title="Type of the new column" aria-label="Type of the new column" value={newType[i] ?? "text"}
                              onChange={(e) => setNewType((t) => t.map((x, j) => (j === i ? (e.target.value as "text") : x)))}>
                              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                            </select>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>

            <div className={`vcn-match${canUpload ? " on" : ""}`}>
              <div className="vcn-match-h">
                <Icon n="key" />
                <div>
                  <b>Match existing rows on</b>
                  <span>A row with the same UTM (in the same VSAT, when the file has a Live Date) is UPDATED. Otherwise it is INSERTED as a new row.</span>
                </div>
              </div>
              {!utmMapped ? (
                <div style={{ fontSize: 12, color: "var(--fg60)", fontStyle: "italic" }}>Map a CSV header to the UTM Link column above.</div>
              ) : (
                <div className="vcn-mrow">
                  <label className={`vcn-mchk${always ? " off" : ""}`}>
                    <input type="checkbox" checked={matchUtm && !always} disabled={always} onChange={(e) => setMatchUtm(e.target.checked)} />
                    <b>{labelOf("utm_link") ?? "UTM Link"}</b><i>default</i>
                  </label>
                </div>
              )}
              <label className="vcn-always">
                <input type="checkbox" checked={always} onChange={(e) => { setAlways(e.target.checked); if (e.target.checked) setMatchUtm(false); else setMatchUtm(true); }} />
                <div>
                  <div>Don&apos;t match — always insert as new rows</div>
                  <small>Use this for fresh batches you know aren&apos;t already in the table. Skips matching entirely.</small>
                </div>
              </label>
              {!canUpload && <div className="vcn-pick">Pick at least one match column, or check &quot;Don&apos;t match&quot;.</div>}
            </div>

            {n > 0 && (
              <div>
                <div className="vcn-prev-t">Preview (first 3 rows)</div>
                <div className="vcn-prev"><div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr>{parsed.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                    <tbody>
                      {parsed.records.slice(0, 3).map((r, ri) => (
                        <tr key={ri}>{parsed.headers.map((_, ci) => <td key={ci}>{r[ci] || <span className="vcn-dash">—</span>}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div></div>
              </div>
            )}
            {mapErrs.length > 0 && <div className="vcn-fe" role="status">{mapErrs.map((e) => <div key={e}>{e}</div>)}</div>}
          </div>
        )}
        {step === "result" && result && (
          <div className="vcn-done" role="status">
            <Icon n="okc" size="x5" />
            <h3>Upload complete</h3>
            <p><b>{result.added}</b> {result.added === 1 ? "row" : "rows"} added</p>
            <p><b>{result.updated}</b> existing {result.updated === 1 ? "row" : "rows"} updated</p>
            {result.cols > 0 && <p><b>{result.cols}</b> new {result.cols === 1 ? "column" : "columns"} created</p>}
          </div>
        )}
      </div>
      <div className="vcn-df">
        {step === "map" && <button type="button" className="vcn-back" onClick={() => { setStep("pick"); setParsed(null); setErr(""); setLines([]); }} disabled={busy}>← Pick different file</button>}
        <div className="sp" />
        <button type="button" className="vcn-cancel s" onClick={close} disabled={busy} {...(step === "result" ? { "data-autofocus": true } : {})}>{step === "result" ? "Close" : "Cancel"}</button>
        {step === "map" && (
          <button type="button" className="vcn-go" onClick={upload} disabled={busy || mapErrs.length > 0 || !canUpload}>
            {busy ? <Saving text="Uploading…" /> : <><Icon n="upload" /> Upload {n} {n === 1 ? "row" : "rows"}</>}
          </button>
        )}
      </div>
    </Dialog>
  );
}
