"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CATEGORIES, COMBO_KEYS, EDITABLE_STD, SLAB_VALUES, duplicateOf, importErrorLines, importTargets, mapRecords, mappingErrors, parseCsv,
  type ConsColumn, type ConsRow, type CsvParsed,
} from "@/lib/growth/consultants";
import { call, type Client } from "./api";
import { Icon } from "./icons";

const STD_KEYS = new Set<string>(EDITABLE_STD);

// ───────────────────────────── modal shell ─────────────────────────────

/** Dialog: Escape and the backdrop close it (not while saving); focus moves in, stays in, and returns on close. */
export function Modal({ title, sub, gradient, size, busy, onClose, children, footer }: {
  title: string; sub?: ReactNode; gradient?: boolean; size?: "wide" | "xl"; busy?: boolean; onClose: () => void; children: ReactNode; footer: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; });
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>("input,select,textarea,button:not(.vcn-x)");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); if (!busyRef.current) closeRef.current(); return; }
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
    <div className="vcn-ov" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} className={`vcn-dlg${size ? ` ${size}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
        <div className="vcn-dh">
          <div><h2 id={`${id}-t`} className={gradient ? "g" : ""}>{title}</h2>{sub && <p>{sub}</p>}</div>
          <button type="button" className="vcn-x" onClick={onClose} disabled={busy} aria-label="Close"><Icon n="x" /></button>
        </div>
        <div className="vcn-db">{children}</div>
        <div className="vcn-df">{footer}</div>
      </div>
    </div>
  );
}

function ErrBox({ msg, lines }: { msg: string; lines?: string[] }) {
  if (!msg) return null;
  return (
    <div className="vcn-banner err" role="alert">
      <Icon n="alert" />
      <div>{msg}{lines && lines.length > 0 && <ul className="vcn-errlist">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}</div>
    </div>
  );
}

const Saving = ({ text }: { text: string }) => <><Icon n="loader" spin size="s" /> {text}</>;

// ───────────────────────────── add / edit row ─────────────────────────────

function rowValues(r: ConsRow | null, cols: ConsColumn[]): Record<string, string> {
  const v: Record<string, string> = {};
  for (const c of cols) {
    if (!r) { v[c.key] = ""; continue; }
    if (STD_KEYS.has(c.key)) {
      const x = (r as unknown as Record<string, unknown>)[c.key];
      v[c.key] = x == null ? "" : (c.key === "enrollment_spend" || c.key === "slab_spend") ? (Number(x) ? String(Number(x)) : "") : String(x);
    } else v[c.key] = r.extra?.[c.key] ?? "";
  }
  return v;
}

export function RowDialog({ sb, columns, rows, editing, onClose, onSaved }: {
  sb: Client; columns: ConsColumn[]; rows: ConsRow[]; editing: ConsRow | null; onClose: () => void; onSaved: (msg: string) => void;
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
  const dup = vals.utm_link?.trim() ? duplicateOf(rows, vals.utm_link, editing?.id) : null;
  const utmConflict = dup ? `This UTM is already used by ${dup.consultant_name}. Each UTM must be unique — duplicate UTMs cause double-counting.` : "";
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
    if (Object.values(fe).some(Boolean) || utmConflict) return;
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
    const r = await call<{ id: string }>(sb, "growth_cons_save", { row }, labelOf);
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
    <Modal title={editing ? "Edit Consultants Row" : "Add Consultants Row"} gradient size="wide" busy={busy} onClose={onClose}
      sub={editing ? "Update fields and save." : "Fill in the fields below. Required fields marked with *."}
      footer={<>
        <button type="button" className="vcn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="vcn-b acc" onClick={save} disabled={busy || !!utmConflict}>
          {busy ? <Saving text="Saving…" /> : <><Icon n="save" size="s" /> {editing ? "Save Changes" : "Add Row"}</>}
        </button>
      </>}>
      <ErrBox msg={top} />
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: "contents" }}>
        {cols.map((c, i) => {
          const id = `${dlId}-${c.key}`;
          const err = c.key === "utm_link" ? errs[c.key] || utmConflict : errs[c.key];
          const common = { id, "aria-invalid": !!err || undefined, "aria-describedby": err ? `${id}-e` : undefined, ...(i === 0 ? { "data-autofocus": true } : {}) };
          let input: ReactNode;
          if (c.key === "category") {
            input = (
              <select {...common} className="vcn-sel" value={vals[c.key]} onChange={(e) => set(c.key, e.target.value)}>
                <option value="">Pick a category…</option>
                {CATEGORIES.map((o) => <option key={o}>{o}</option>)}
              </select>
            );
          } else if (c.key === "slab_hit") {
            input = (
              <select {...common} className="vcn-sel" value={vals[c.key]} onChange={(e) => set(c.key, e.target.value)}>
                <option value="">—</option>
                {SLAB_VALUES.map((o) => <option key={o}>{o}</option>)}
              </select>
            );
          } else if (c.type === "number") {
            input = <input {...common} className={`vcn-in${err ? " bad" : ""}`} inputMode="decimal" placeholder="0" value={vals[c.key]} onChange={(e) => set(c.key, e.target.value)} maxLength={20} />;
          } else if (c.type === "date") {
            input = <input {...common} className={`vcn-in${err ? " bad" : ""}`} type="date" style={{ colorScheme: "dark" }} value={vals[c.key]} onChange={(e) => set(c.key, e.target.value)} />;
          } else if (c.type === "url") {
            input = <input {...common} className={`vcn-in${err ? " bad" : ""}`} type="url" inputMode="url" placeholder="https://" value={vals[c.key]} onChange={(e) => set(c.key, e.target.value)} maxLength={2000} spellCheck={false} autoCapitalize="off" />;
          } else {
            const opts = options[c.key] ?? [];
            input = (
              <>
                <input {...common} className={`vcn-in${err ? " bad" : ""}`} value={vals[c.key]} onChange={(e) => set(c.key, e.target.value)}
                  maxLength={c.key === "consultant_name" ? 120 : c.key === "coupon_code" ? 120 : c.standard ? 80 : 500}
                  list={opts.length ? `${id}-l` : undefined} autoComplete="off"
                  placeholder={opts.length ? `Pick a ${c.label.toLowerCase()} or type a new one…` : undefined} />
                {opts.length > 0 && <datalist id={`${id}-l`}>{opts.map((o) => <option key={o} value={o} />)}</datalist>}
              </>
            );
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
    </Modal>
  );
}

// ───────────────────────────── confirm (delete row / rows / column) ─────────────────────────────

export function ConfirmDialog({ title, body, confirm, busyText, danger, onClose, onConfirm }: {
  title: string; body: ReactNode; confirm: string; busyText: string; danger?: boolean; onClose: () => void; onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr("");
    const e = await onConfirm();
    setBusy(false);
    if (e) setErr(e);
  }
  return (
    <Modal title={title} busy={busy} onClose={onClose}
      footer={<>
        <button type="button" className="vcn-ghost" onClick={onClose} disabled={busy} data-autofocus>Cancel</button>
        <button type="button" className={`vcn-b ${danger ? "dan" : "acc"}`} onClick={go} disabled={busy}>
          {busy ? <Saving text={busyText} /> : <><Icon n="trash" size="s" /> {confirm}</>}
        </button>
      </>}>
      <ErrBox msg={err} />
      <p style={{ margin: 0, color: "var(--mut)" }}>{body}</p>
    </Modal>
  );
}

// ───────────────────────────── bulk update ─────────────────────────────

export function BulkUpdateDialog({ sb, columns, ids, onClose, onDone }: {
  sb: Client; columns: ConsColumn[]; ids: string[]; onClose: () => void; onDone: (msg: string) => void;
}) {
  const eligible = columns.filter((c) => c.type !== "computed" && c.key !== "utm_link");   // one UTM per row
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const col = eligible.find((c) => c.key === key);
  const labelOf = (k: string) => columns.find((c) => c.key === k)?.label;
  async function go() {
    if (!col) return setErr("Pick a column first.");
    if (col.required && !value.trim()) return setErr(`${col.label} is required.`);
    setBusy(true); setErr("");
    const r = await call<{ changed: number }>(sb, "growth_cons_bulk_update", { ids, key, value: value.trim() || null }, labelOf);
    setBusy(false);
    if (r.error) return setErr(r.error);
    onDone(`${r.data?.changed ?? ids.length} ${ids.length === 1 ? "row" : "rows"} updated.`);
  }
  const n = ids.length;
  return (
    <Modal title={`Bulk update ${n} ${n === 1 ? "row" : "rows"}`} busy={busy} onClose={onClose}
      footer={<>
        <button type="button" className="vcn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="vcn-b acc" onClick={go} disabled={busy || !col}>{busy ? <Saving text="Updating…" /> : `Update ${n} ${n === 1 ? "row" : "rows"}`}</button>
      </>}>
      <p style={{ margin: 0, color: "var(--mut)" }}>Pick a column and a value. Every selected row gets the same value for that column — other columns are untouched.</p>
      <ErrBox msg={err} />
      <div>
        <label className="vcn-fl" htmlFor="vcn-bu-c">Column</label>
        <select id="vcn-bu-c" className="vcn-sel" value={key} onChange={(e) => { setKey(e.target.value); setValue(""); setErr(""); }} data-autofocus>
          <option value="">Pick a column…</option>
          {eligible.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>
      {col && (
        <div>
          <label className="vcn-fl" htmlFor="vcn-bu-v">Value</label>
          {col.key === "category" ? (
            <select id="vcn-bu-v" className="vcn-sel" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Pick a category…</option>{CATEGORIES.map((o) => <option key={o}>{o}</option>)}
            </select>
          ) : col.key === "slab_hit" ? (
            <select id="vcn-bu-v" className="vcn-sel" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">— (clear)</option>{SLAB_VALUES.map((o) => <option key={o}>{o}</option>)}
            </select>
          ) : col.type === "number" ? (
            <input id="vcn-bu-v" className="vcn-in" inputMode="decimal" placeholder="Enter a number" value={value} onChange={(e) => setValue(e.target.value)} maxLength={20} />
          ) : col.type === "date" ? (
            <input id="vcn-bu-v" className="vcn-in" type="date" style={{ colorScheme: "dark" }} value={value} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input id="vcn-bu-v" className="vcn-in" type={col.type === "url" ? "url" : "text"} placeholder={col.type === "url" ? "https://" : "Enter a value"}
              value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} />
          )}
          {!col.required && <div className="vcn-fh">Leave empty to clear the value.</div>}
        </div>
      )}
    </Modal>
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
  async function go() {
    if (!label.trim()) return setErr("Column name is required.");
    setBusy(true); setErr("");
    const r = await call<{ key: string }>(sb, "growth_cons_col_add", { label: label.trim(), type, required });
    setBusy(false);
    if (r.error) return setErr(r.error);
    onDone(`Column “${label.trim()}” added.`);
  }
  return (
    <Modal title="Add Column to Consultants" gradient busy={busy} onClose={onClose} sub="The new column appears in the table immediately."
      footer={<>
        <button type="button" className="vcn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="vcn-b acc" onClick={go} disabled={busy}>{busy ? <Saving text="Adding…" /> : <><Icon n="plus" size="s" /> Add Column</>}</button>
      </>}>
      <ErrBox msg={err} />
      <form onSubmit={(e) => { e.preventDefault(); void go(); }} style={{ display: "contents" }}>
        <div>
          <label className="vcn-fl" htmlFor="vcn-ac-l">Column Name</label>
          <input id="vcn-ac-l" className="vcn-in" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Group Admin Name" maxLength={60} data-autofocus />
        </div>
        <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="vcn-fl">Type</legend>
          {TYPES.map((t) => (
            <label key={t.v} className="vcn-radio">
              <input type="radio" name="vcn-ac-t" value={t.v} checked={type === t.v} onChange={() => setType(t.v)} />
              <span>{t.l}<small>{t.d}</small></span>
            </label>
          ))}
        </fieldset>
        <label className="vcn-radio">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <span>Required<small>Every row must have a value before it can be saved.</small></span>
        </label>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

export function RenameColumnDialog({ sb, column, onClose, onDone }: { sb: Client; column: ConsColumn; onClose: () => void; onDone: (msg: string) => void }) {
  const [label, setLabel] = useState(column.label);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    if (!label.trim()) return setErr("Column name is required.");
    if (label.trim() === column.label) return onClose();
    setBusy(true); setErr("");
    const r = await call(sb, "growth_cons_col_update", { key: column.key, label: label.trim() });
    setBusy(false);
    if (r.error) return setErr(r.error);
    onDone("Column renamed.");
  }
  return (
    <Modal title="Rename column" busy={busy} onClose={onClose}
      footer={<>
        <button type="button" className="vcn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="vcn-b acc" onClick={go} disabled={busy}>{busy ? <Saving text="Saving…" /> : "Save"}</button>
      </>}>
      <ErrBox msg={err} />
      <form onSubmit={(e) => { e.preventDefault(); void go(); }} style={{ display: "contents" }}>
        <div>
          <label className="vcn-fl" htmlFor="vcn-rc">Column Name</label>
          <input id="vcn-rc" className="vcn-in" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} data-autofocus />
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────────── CSV upload ─────────────────────────────

type MapTarget = string;   // column key | "" (skip) | "__new__"

export function CsvDialog({ sb, columns, onClose, onDone, onColumns }: {
  sb: Client; columns: ConsColumn[]; onClose: () => void; onDone: (msg: string) => void; onColumns: () => void;
}) {
  const [step, setStep] = useState<"pick" | "map" | "result">("pick");
  const [file, setFile] = useState("");
  const [parsed, setParsed] = useState<CsvParsed | null>(null);
  const [mapping, setMapping] = useState<MapTarget[]>([]);
  const [newType, setNewType] = useState<("text" | "number" | "date" | "url")[]>([]);
  const [mode, setMode] = useState<"upsert" | "add">("upsert");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const targets = importTargets(columns);
  const labelOf = (k: string) => columns.find((c) => c.key === k)?.label;

  async function pick(f: File) {
    setErr(""); setLines([]);
    if (f.size > 5 * 1024 * 1024) return setErr("The file is larger than 5 MB.");
    const p = parseCsv(await f.text(), columns);
    if (!p.ok) return setErr(p.error);
    setFile(f.name); setParsed(p.data); setMapping(p.data.guess); setNewType(p.data.headers.map(() => "text")); setStep("map");
  }

  // a header mapped to "+ Add as new column" counts as that new column for the checks below
  const planned = useMemo(() => {
    const extraCols: ConsColumn[] = [];
    const m = mapping.map((k, i) => {
      if (k !== "__new__") return k;
      const key = `__new_${i}`;
      extraCols.push({ key, label: parsed?.headers[i] ?? key, type: newType[i] ?? "text", required: false, standard: false, hidden: false });
      return key;
    });
    return { m, cols: [...columns, ...extraCols] };
  }, [mapping, newType, columns, parsed]);
  const mapErrs = parsed ? mappingErrors(planned.m, planned.cols, mode) : [];

  async function upload() {
    if (!parsed || mapErrs.length) return;
    setBusy(true); setErr(""); setLines([]);
    // 1. new columns first (the database checks their names)
    const m = [...mapping];
    for (let i = 0; i < m.length; i++) {
      if (m[i] !== "__new__") continue;
      const r = await call<{ key: string }>(sb, "growth_cons_col_add", { label: parsed.headers[i], type: newType[i] ?? "text" });
      if (r.error || !r.data) {
        setBusy(false);
        if (i > 0 && m.slice(0, i).some((_, j) => mapping[j] === "__new__")) { setMapping(m); onColumns(); }
        return setErr(`Column “${parsed.headers[i]}”: ${r.error}`);
      }
      m[i] = r.data.key;
    }
    const added: ConsColumn[] = m.filter((_, i) => mapping[i] === "__new__")
      .map((k) => ({ key: k, label: k, type: "text", required: false, standard: false, hidden: false }));
    const cols = [...columns, ...added];
    // 2. rows, all or nothing
    const rows = mapRecords(parsed, m, cols);
    const r = await call<{ added: number; updated: number }>(sb, "growth_cons_import", { rows, mode }, labelOf);
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      setLines(importErrorLines(r.detail, labelOf));
      if (m.some((_, i) => mapping[i] === "__new__")) { setMapping(m); onColumns(); }   // the new columns exist now
      return;
    }
    setResult(`${r.data?.added ?? 0} added · ${r.data?.updated ?? 0} updated.`);
    setStep("result");
  }

  const sub = step === "pick" ? "Pick a CSV file to upload." : step === "map" && parsed
    ? `${file} · ${parsed.records.length} ${parsed.records.length === 1 ? "row" : "rows"} · ${parsed.headers.length} columns` : "Upload complete.";
  return (
    <Modal title="Upload CSV to Consultants" gradient size="xl" busy={busy} sub={sub} onClose={step === "result" ? () => onDone(`CSV uploaded: ${result}`) : onClose}
      footer={step === "result"
        ? <button type="button" className="vcn-b acc" onClick={() => onDone(`CSV uploaded: ${result}`)} data-autofocus>Done</button>
        : <>
          {step === "map" && <button type="button" className="vcn-ghost" onClick={() => { setStep("pick"); setParsed(null); setErr(""); setLines([]); }} disabled={busy}>Back</button>}
          <button type="button" className="vcn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {step === "map" && <button type="button" className="vcn-b acc" onClick={upload} disabled={busy || mapErrs.length > 0}>{busy ? <Saving text="Uploading…" /> : <><Icon n="upload" size="s" /> Upload {parsed?.records.length} {parsed?.records.length === 1 ? "row" : "rows"}</>}</button>}
        </>}>
      <ErrBox msg={err} lines={lines} />
      {step === "pick" && <>
        <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
        <button type="button" className="vcn-drop" onClick={() => input.current?.click()} data-autofocus>
          <Icon n="file" /><b>Choose a CSV file</b><span>First row must contain column headers</span>
        </button>
        <p style={{ margin: 0, fontSize: 12, color: "var(--mut2)" }}><strong style={{ color: "var(--mut)" }}>Upsert rule:</strong> after picking the file you choose how rows are matched. Rows whose UTM Link is already in the list → updated (empty cells keep the old value). New rows → inserted. Nothing is saved if any row has an error.</p>
      </>}
      {step === "map" && parsed && <>
        <div className="vcn-scroll" style={{ border: "1px solid var(--line)", borderRadius: 12 }}>
          <table className="vcn-map" style={{ minWidth: 560 }}>
            <thead><tr><th scope="col">CSV Header</th><th scope="col">Sample</th><th scope="col">Map To</th></tr></thead>
            <tbody>
              {parsed.headers.map((h, i) => (
                <tr key={i}>
                  <td className="h">{h || <span className="vcn-dash">(empty)</span>}</td>
                  <td className="s" title={parsed.records[0]?.[i] ?? ""}>{parsed.records[0]?.[i] || "—"}</td>
                  <td>
                    <div className="vcn-mapc">
                      <select className="vcn-sel" aria-label={`Map ${h || `column ${i + 1}`} to`} value={mapping[i] ?? ""}
                        onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? e.target.value : x)))}>
                        <option value="__new__">+ Add as new column</option>
                        <option value="">Skip column</option>
                        <optgroup label="Existing columns">{targets.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
                      </select>
                      {mapping[i] === "__new__" && (
                        <select className="vcn-sel" style={{ width: 96 }} title="Type of the new column" aria-label="Type of the new column" value={newType[i] ?? "text"}
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
        </div>
        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 12, margin: 0, padding: "10px 14px" }}>
          <legend className="vcn-fl" style={{ padding: "0 4px" }}>Upsert rule</legend>
          <label className="vcn-radio"><input type="radio" name="vcn-csv-m" checked={mode === "upsert"} onChange={() => setMode("upsert")} />
            <span>Match on UTM Link<small>Rows whose UTM Link is already in the list are updated; the rest are added.</small></span></label>
          <label className="vcn-radio"><input type="radio" name="vcn-csv-m" checked={mode === "add"} onChange={() => setMode("add")} />
            <span>Don&apos;t match — always insert as new rows<small>A UTM Link that is already in the list is an error (each UTM must be unique).</small></span></label>
        </fieldset>
        {mapErrs.length > 0 && <div className="vcn-fe" role="status">{mapErrs.map((e) => <div key={e}>{e}</div>)}</div>}
      </>}
      {step === "result" && <p style={{ margin: 0 }} role="status"><Icon n="check" /> {result}</p>}
    </Modal>
  );
}
