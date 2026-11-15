"use client";

import { useEffect, useState } from "react";
import { Drawer, Button, Select, DateRange, Icon, TextField } from "./primitives";
import { Field } from "./form";
import { DateRangeField, rangeError, rangeLabel } from "./date-range-field";
import type { Option } from "../lib/types";

export type FilterField =
  | { kind: "select"; key: string; placeholder: string; options: Option[]; locked?: boolean; label?: string }
  | { kind: "date"; key: string; placeholder: string; label?: string }
  /** v2: from/to dates with quick presets. Value "YYYY-MM-DD..YYYY-MM-DD". */
  | { kind: "daterange"; key: string; placeholder: string; label?: string }
  /** v2: free text (e.g. a campaign name). */
  | { kind: "text"; key: string; placeholder: string; label?: string };

const nameOf = (f: FilterField) => f.label ?? f.placeholder.replace(/^Select\s+/i, "");

/**
 * Filter drawer with proper Apply semantics: edits live in a draft until
 * "Apply" is pressed, so half-typed filters never hit the data source.
 * "Reset" clears the draft; closing with ✕ discards it.
 *
 * `touch` (v2) switches on: dialog semantics + focus handling, a visible label above every
 * field, 44px controls on phones, and Apply disabled while a date range is invalid.
 */
export function FilterPanel({ open, fields, value, onClose, onApply, touch }: {
  open: boolean;
  fields: FilterField[];
  value: Record<string, string>;
  onClose: () => void;
  onApply: (next: Record<string, string>) => void;
  touch?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);

  const set = (k: string, v: string) => setDraft((d) => {
    const n = { ...d, [k]: v };
    if (!v) delete n[k];
    return n;
  });
  const clean = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
  const dirty = JSON.stringify(clean(draft)) !== JSON.stringify(clean(value));
  const invalid = fields.some((f) => f.kind === "daterange" && rangeError(draft[f.key] ?? ""));

  return (
    <Drawer open={open} title="Filter by" onClose={onClose} accessible={touch}
      footer={
        <>
          <Button variant="ghost" icon="refresh" touch={touch} onClick={() => setDraft({})}>Reset</Button>
          <Button variant="solid" touch={touch} disabled={!dirty || invalid} onClick={() => { onApply(clean(draft)); onClose(); }}>Apply</Button>
        </>
      }>
      {fields.map((f) => {
        const id = `flt-${f.key}`;
        const control =
          f.kind === "select" ? (
            <Select id={id} touch={touch} placeholder={f.placeholder} options={f.options}
              value={f.locked ? f.options[0]?.value ?? "" : draft[f.key] ?? ""}
              disabled={f.locked} onChange={(v) => set(f.key, v)} />
          ) : f.kind === "daterange" ? (
            <DateRangeField id={id} value={draft[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
          ) : f.kind === "text" ? (
            <TextField id={id} touch={touch} placeholder={f.placeholder} ariaLabel={touch ? undefined : nameOf(f)} value={draft[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
          ) : (
            <DateRange placeholder={f.placeholder} value={draft[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
          );
        return touch && f.kind !== "daterange"
          ? <Field key={f.key} id={id} label={nameOf(f)} stacked>{control}</Field>
          : touch
            ? <fieldset key={f.key} className="grid gap-1.5"><legend className="mb-1.5 font-body text-sm font-semibold text-heading">{nameOf(f)}</legend>{control}</fieldset>
            : <div key={f.key}>{control}</div>;
      })}
      {fields.length === 0 && (
        <p className="flex items-center gap-2 font-body text-sm text-muted">
          <Icon name="info" className="h-4 w-4" /> No filters for this screen yet.
        </p>
      )}
    </Drawer>
  );
}

/** Turns the raw filter map into readable chips ("List Origin: Raw Data"). */
export function toChips(
  filters: Record<string, string>,
  fields: FilterField[],
): { key: string; label: string }[] {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([key, v]) => {
      const f = fields.find((x) => x.key === key);
      const label = f?.kind === "select" ? f.options.find((o) => o.value === v)?.label ?? v : f?.kind === "daterange" ? rangeLabel(v) : v;
      const name = f ? nameOf(f) : key;
      return { key, label: `${name}: ${label}` };
    });
}
