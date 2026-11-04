"use client";

import { useRef, useState } from "react";
import { Button, Icon } from "../../ui/primitives";
import { InlineError, Skeleton } from "../../ui/states";
import { SampleCsvLink } from "./checklist-step";
import { MAX_ROWS_LABEL, fmt } from "./constants";
import type { PickedFile } from "./use-wizard";

const REQUIREMENTS = [
  "CSV format only",
  `Up to ${MAX_ROWS_LABEL} contacts per upload`,
  "Column names in row 1",
  "Duplicate rows inside the file are skipped",
];

export function FileStep({ file, error, reading, onPick, onRemove }: {
  file: PickedFile | null; error: string | null; reading: boolean;
  onPick: (f: File) => void; onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (f?: File | null) => { if (f) onPick(f); if (input.current) input.current.value = ""; };

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
        className={`mt-6 grid place-items-center rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors sm:p-10 ${over ? "border-accent bg-surface-warm/50" : error ? "border-[#f87171]/60" : "border-border"}`}>
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-surface-warm text-muted"><Icon name="upload" className="h-6 w-6" /></span>
        <p className="mt-3 font-body text-sm font-semibold text-heading">Drop your .csv file here</p>
        <p className="font-body text-xs text-muted">or</p>
        <div className="mt-2">
          <Button touch icon="folder" disabled={reading} onClick={() => input.current?.click()}>{file ? "Choose a different file" : "Choose file"}</Button>
        </div>
        <input ref={input} type="file" accept=".csv,text/csv" hidden aria-label="CSV file" onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      {error && <div className="mt-3"><InlineError>{error}</InlineError></div>}

      {reading && (
        <div className="mt-4 rounded-xl border border-border bg-background p-4" aria-busy="true" role="status">
          <p className="sr-only">Reading file</p>
          <Skeleton className="h-4 w-48" />
          <div className="mt-3 flex flex-wrap gap-1.5">{["w-20", "w-28", "w-16", "w-24"].map((w) => <Skeleton key={w} className={`h-6 ${w}`} />)}</div>
        </div>
      )}

      {file && !reading && (
        <div className="mt-4 rounded-xl border border-border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-2 font-body text-sm font-semibold text-heading">
              <Icon name="check" className="h-4 w-4 shrink-0 text-[#4ade80]" /> <span className="truncate">{file.name}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="font-mono text-xs text-muted">{fmt(file.rowCount)} rows · {file.headers.length} columns</span>
              <Button size="sm" variant="ghost" touch icon="trash" onClick={onRemove}>Remove</Button>
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {file.headers.slice(0, 12).map((h, i) => <span key={`${h}-${i}`} className="rounded-md bg-surface-warm px-2 py-1 font-mono text-[11px] text-foreground">{h || "(blank)"}</span>)}
            {file.headers.length > 12 && <span className="rounded-md px-2 py-1 font-mono text-[11px] text-muted">+{file.headers.length - 12} more</span>}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 rounded-xl border border-border border-l-4 border-l-accent bg-background p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted">File requirements</h3>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {REQUIREMENTS.map((r) => (
              <li key={r} className="flex items-start gap-2 font-body text-[13px] text-foreground">
                <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#4ade80]" /> {r}
              </li>
            ))}
          </ul>
        </div>
        <p className="font-body text-[13px] text-muted">Need a template? <SampleCsvLink /></p>
      </div>
    </>
  );
}
