"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ALL_TIME, activePreset, monthStartIST, toConsultant, todayIST, windowParams, type Consultant, type DateRange, type PerfData, type SortState,
} from "@/lib/growth/consultants-perf";
import { toCsv } from "@/lib/growth/season";
import { call, type Client } from "./api";
import { Icon } from "./icons";

/** Shared pieces of the Consultant Performance tabs (same controls as the vedamcrm360 Consultants Dashboard). */

/** Performance numbers for a period + campus (null = all). */
export function usePerf(sb: Client, range: DateRange | null, campus: string | null) {
  const key = JSON.stringify(range ? windowParams(range, campus) : windowParams(ALL_TIME, campus));
  const [tick, setTick] = useState(0);
  const [st, setSt] = useState<{ key: string; list: Consultant[] | null; err: string }>({ key: "", list: null, err: "" });
  useEffect(() => {
    let alive = true;
    void call<PerfData>(sb, "growth_cons_perf", JSON.parse(key)).then((r) => {
      if (!alive) return;
      setSt((cur) => ({ key: `${key}#${tick}`, list: r.data ? r.data.consultants.map(toConsultant) : cur.list, err: r.error ?? "" }));
    });
    return () => { alive = false; };
  }, [sb, key, tick]);
  const loading = st.key !== `${key}#${tick}`;
  return { loading, list: st.list ?? [], first: st.list === null, err: st.err, reload: () => setTick((t) => t + 1) };
}


/** Checkbox dropdown. [] = all. Shows "All …", the one value, or "N selected". Click outside or Esc closes it. */
export function MultiSelect({ label, allLabel, options, selected, onChange }: {
  label: string; allLabel: string; options: readonly string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const toggle = (o: string) => onChange(selected.includes(o) ? selected.filter((s) => s !== o) : [...selected, o]);
  const summary = selected.length === 0 ? allLabel : selected.length === 1 ? selected[0] : `${selected.length} selected`;
  return (
    <div className="vcp-ms" ref={ref}>
      <button type="button" className="vcp-msb" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${summary}`}>
        <span>{summary}</span><Icon n="down" size="s" />
      </button>
      {open && (
        <div className="vcp-msm" role="listbox" aria-multiselectable="true" aria-label={label}>
          {options.length === 0 ? <div className="vcp-none">No options</div> : options.map((o) => {
            const on = selected.includes(o);
            return (
              <button key={o} type="button" role="option" aria-selected={on} className="vcp-mso" onClick={() => toggle(o)}>
                <span className={`vcp-box${on ? " on" : ""}`}>{on && <Icon n="check" size="xs" />}</span><span>{o}</span>
              </button>
            );
          })}
          {selected.length > 0 && <button type="button" className="vcp-mso clr" onClick={() => onChange([])}>Clear {label.toLowerCase()}</button>}
        </div>
      )}
    </div>
  );
}

/** Period: All time / Today / Month to date / Custom (India time). All time = no date filter. */
export function PeriodBar({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const [custom, setCustom] = useState(false);
  const preset = activePreset(value);
  const pick = (r: DateRange) => { onChange(r); setCustom(false); };
  return (
    <div className="vcp-row" role="group" aria-label="Period">
      <span className="vcp-lab"><Icon n="calendar" size="xs" /> Period</span>
      <button type="button" className="vcp-pb" aria-pressed={preset === "all"} onClick={() => pick(ALL_TIME)}>All time</button>
      <button type="button" className="vcp-pb" aria-pressed={preset === "today"} onClick={() => pick({ start: todayIST(), end: todayIST() })}>Today</button>
      <button type="button" className="vcp-pb" aria-pressed={preset === "mtd"} onClick={() => pick({ start: monthStartIST(), end: todayIST() })}>Month to date</button>
      <button type="button" className="vcp-pb" aria-pressed={preset === "custom"} aria-expanded={custom} onClick={() => setCustom((o) => !o)}>Custom</button>
      {preset === "custom" && <span className="vcp-rng">{value.start || "…"} → {value.end || "…"}</span>}
      {preset !== "all" && <button type="button" className="vcp-pb" onClick={() => pick(ALL_TIME)} title="Clear the date filter"><Icon n="x" size="xs" /> Clear</button>}
      {custom && (
        <span className="vcp-row" style={{ margin: 0 }}>
          <input type="date" className="vcp-date" aria-label="From" value={value.start || ""} max={value.end || undefined}
            onChange={(e) => onChange({ start: e.target.value || null, end: value.end })} />
          <span className="c-mut">→</span>
          <input type="date" className="vcp-date" aria-label="To" value={value.end || ""} min={value.start || undefined}
            onChange={(e) => onChange({ start: value.start, end: e.target.value || null })} />
        </span>
      )}
    </div>
  );
}

/** KPI card. With onClick it is a button with "view →" (opens the student drill-down). */
export function Kpi({ label, value, color, sub, hl, onClick, loading }: {
  label: string; value: string; color: string; sub?: string; hl?: boolean; onClick?: () => void; loading?: boolean;
}) {
  const body = (
    <>
      <div className="vcn-kpi-l vcp-kl"><span>{label}</span>{onClick && <span className="vcp-view">view →</span>}</div>
      <div className={`vcn-kpi-v${loading ? " ld" : ""}`}>{loading ? "…" : value}</div>
      {sub && !loading && <div className="vcn-kpi-s">{sub}</div>}
    </>
  );
  const style = { ["--k" as string]: color };
  return onClick
    ? <button type="button" className={`vcn-kpi vcp-kpi${hl ? " hl" : ""}`} style={style} onClick={onClick} aria-label={`${label}: ${value}. View students`}>{body}</button>
    : <div className={`vcn-kpi vcp-kpi${hl ? " hl" : ""}`} style={style}>{body}</div>;
}

/** Sortable header (right-aligned, or centred). ▼ / ▲ on the active column. */
export function SortTh({ k, sort, onSort, center, children }: { k: string; sort: SortState; onSort: (k: string) => void; center?: boolean; children: ReactNode }) {
  const on = sort.key === k;
  return (
    <th scope="col" className={center ? "c" : "r"} aria-sort={on ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
      <button type="button" className={`vcp-sh${on ? " on" : ""}`} onClick={() => onSort(k)}>
        {children}<small aria-hidden="true">{on ? (sort.dir === "desc" ? "▼" : "▲") : ""}</small>
      </button>
    </th>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  const assoc = category === "Associated with Sunstone";
  return <span className={`vcp-cat${assoc ? " on" : ""}`}>{assoc ? "Sunstone" : category ? "Not Assoc." : "—"}</span>;
}

export function ErrBanner({ msg, onClose }: { msg: string; onClose?: () => void }) {
  return (
    <div className="vcn-banner err" role="alert"><Icon n="alert" /><div>{msg}</div>
      {onClose && <button type="button" className="vcn-x" onClick={onClose} aria-label="Dismiss"><Icon n="x" size="s" /></button>}
    </div>
  );
}

/** Open dialogs, top last: Esc closes only the top one. */
const STACK: (() => void)[] = [];

/** Full-screen dialog (desktop: 85vw × 88vh). Backdrop click, ✕ or Esc closes it (only the top one). */
export function Modal({ level = 1, size, label, onClose, children }: { level?: 1 | 2 | 3; size?: "mid" | "big"; label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const me = () => close.current();
    STACK.push(me);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && STACK[STACK.length - 1] === me) { e.stopPropagation(); me(); } };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); STACK.splice(STACK.indexOf(me), 1); prev?.focus?.(); };
  }, []);
  return (
    <div className={`vcp-ov${level > 1 ? ` l${level}` : ""}`} onClick={onClose}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={`vcp-md${size ? ` ${size}` : ""}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ModalHead({ eyebrow, title, sub, color, onClose }: { eyebrow: ReactNode; title: ReactNode; sub?: ReactNode; color?: string; onClose: () => void }) {
  return (
    <div className="vcp-mh" style={color ? { ["--k" as string]: color } : undefined}>
      <div>
        <div className="vcp-eb">{eyebrow}</div>
        <div className="vcp-mt">{title}</div>
        {sub !== undefined && <div className="vcp-ms2">{sub}</div>}
      </div>
      <button type="button" className="vcn-x" onClick={onClose} aria-label="Close"><Icon n="x" /></button>
    </div>
  );
}

export function Loading({ text = "Loading…", color }: { text?: string; color?: string }) {
  return <div className="vcp-load" style={color ? { ["--k" as string]: color } : undefined} role="status"><Icon n="loader" spin /><div>{text}</div></div>;
}

/** Set of keys kept in this browser (Customize). Works without storage (private window): then it lasts for the visit. */
export function usePersistedSet(key: string) {
  const [set, setSet] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setSet(new Set(arr.filter((x) => typeof x === "string")));
    } catch { /* storage blocked */ }
  }, [key]);
  const toggle = useCallback((k: string) => {
    setSet((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k); else next.add(k);
      try { window.localStorage.setItem(key, JSON.stringify([...next])); } catch { /* storage blocked */ }
      return next;
    });
  }, [key]);
  return { has: (k: string) => set.has(k), toggle };
}

/** CSV download (formula-safe cells, UTF-8 BOM for Excel). */
export function downloadCsv(name: string, cols: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const blob = new Blob(["﻿" + toCsv(cols, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Customize popover: KPI cards + table columns, checkboxes. */
export function Customize({ cards, cols, hiddenCards, hiddenCols }: {
  cards: { key: string; label: string }[]; cols: { key: string; label: string }[];
  hiddenCards: { has: (k: string) => boolean; toggle: (k: string) => void }; hiddenCols: { has: (k: string) => boolean; toggle: (k: string) => void };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const row = (c: { key: string; label: string }, s: typeof hiddenCards) => {
    const on = !s.has(c.key);
    return (
      <button key={c.key} type="button" role="menuitemcheckbox" aria-checked={on} className="vcp-mso" onClick={() => s.toggle(c.key)}>
        <span className={`vcp-box${on ? " on" : ""}`}>{on && <Icon n="check" size="xs" />}</span><span>{c.label}</span>
      </button>
    );
  };
  return (
    <div className="vcp-popw" ref={ref}>
      <button type="button" className="vcp-sb" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"><Icon n="settings" size="s" /> Customize</button>
      {open && (
        <div className="vcp-pop" role="menu" aria-label="Customize">
          <h4>KPI Cards</h4><div>{cards.map((c) => row(c, hiddenCards))}</div>
          <h4>Table Columns</h4><div>{cols.map((c) => row(c, hiddenCols))}</div>
        </div>
      )}
    </div>
  );
}
