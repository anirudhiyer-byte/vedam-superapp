"use client";

import { Icon, TextField } from "../../ui/primitives";
import { Field, Switch } from "../../ui/form";
import { downloadCsv } from "../../lib/mock-api";
import { CHECKLIST, SAMPLE_CSV } from "./constants";

export function SampleCsvLink() {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); downloadCsv(SAMPLE_CSV.filename, SAMPLE_CSV.headers, SAMPLE_CSV.rows); }}
      className="inline-flex min-h-[44px] items-center gap-1 rounded font-semibold text-accent-soft underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft sm:min-h-0">
      <Icon name="download" className="h-3.5 w-3.5" /> Download sample CSV
    </button>
  );
}

export function ChecklistStep({ ack, onAck, ackCount, tagOn, onTagOn, tag, onTag }: {
  ack: boolean[]; onAck: (next: boolean[]) => void; ackCount: number;
  tagOn: boolean; onTagOn: (v: boolean) => void; tag: string; onTag: (v: string) => void;
}) {
  const total = CHECKLIST.length;
  const toggle = (i: number, v: boolean) => onAck(ack.map((x, j) => (j === i ? v : x)));
  return (
    <>
      <div className="mt-5 rounded-xl border border-border bg-background p-4" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">Confirmed</p>
          <p className="font-display text-lg font-extrabold text-heading">{ackCount}<span className="text-muted"> / {total}</span></p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
          <div className="h-full rounded-full bg-brand-gradient transition-all" style={{ width: `${(ackCount / total) * 100}%` }} />
        </div>
      </div>

      <ul className="mt-4 space-y-2.5">
        {CHECKLIST.map((c, i) => (
          <li key={c.id}>
            <div onClick={() => toggle(i, !ack[i])}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 pl-4 transition-colors ${ack[i] ? "border-accent/50 bg-surface-warm/50" : "border-border hover:bg-surface-warm/30"}`}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-warm font-mono text-xs font-bold text-muted" aria-hidden>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p id={`ck-${c.id}-t`} className="font-body text-sm font-bold text-heading">
                  {c.title} <span className="text-[#f87171]" aria-hidden>*</span>
                  <span className="sr-only"> (required)</span>
                </p>
                <p id={`ck-${c.id}-d`} className="mt-0.5 font-body text-[13px] leading-snug text-muted">
                  {c.body}
                  {c.id === "csv" && <> <SampleCsvLink /></>}
                </p>
              </div>
              <Switch checked={ack[i]} onChange={(v) => toggle(i, v)} labelledBy={`ck-${c.id}-t`} describedBy={`ck-${c.id}-d`} />
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center gap-3"><span className="h-px flex-1 bg-border" /><span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted">Optional</span><span className="h-px flex-1 bg-border" /></div>

      <div className="mt-4 rounded-xl border border-dashed border-border p-3 pl-4">
        <div onClick={() => onTagOn(!tagOn)} className="flex cursor-pointer items-center gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-warm text-muted" aria-hidden><Icon name="tag" className="h-3.5 w-3.5" /></span>
          <div className="min-w-0 flex-1">
            <p id="ck-tag-t" className="font-body text-sm font-bold text-heading">Tag this upload</p>
            <p id="ck-tag-d" className="mt-0.5 font-body text-[13px] leading-snug text-muted">Tags help you find these contacts later, by source or campaign.</p>
          </div>
          <Switch checked={tagOn} onChange={onTagOn} labelledBy="ck-tag-t" describedBy="ck-tag-d" />
        </div>
        {tagOn && (
          <div className="mt-3 max-w-md pb-1">
            <Field id="ck-tag-name" label="Tag name" hint="(optional)">
              <TextField id="ck-tag-name" touch placeholder="e.g. pune-expo-nov" maxLength={30} value={tag} onChange={onTag} />
            </Field>
          </div>
        )}
      </div>
    </>
  );
}
