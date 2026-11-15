"use client";

import { Select } from "../../ui/primitives";
import { EmptyState, InlineError } from "../../ui/states";
import { uploadApi } from "../../lib/mock-api";
import type { PickedFile } from "./use-wizard";

const targets = uploadApi.targetFields().filter((t) => t.value);

/**
 * Column mapping. A table from md up; one card per column on phones, so there is
 * no sideways scrolling. Each dropdown is named after the column it controls.
 */
export function MappingStep({ file, mapping, onMap, mappedCount, error, onChooseAnother }: {
  file: PickedFile; mapping: Record<string, string>; onMap: (next: Record<string, string>) => void;
  mappedCount: number; error: string | null; onChooseAnother: () => void;
}) {
  if (!file.headers.length) {
    return <EmptyState icon="doc" title="No columns to map" body="This file has no column names. Go back and choose a file with headers in row 1."
      action={{ label: "Choose another file", icon: "upload", onClick: onChooseAnother }} />;
  }
  const sampleOf = (i: number) => file.sample.map((r) => r[i]).filter(Boolean).slice(0, 2).join(", ") || "—";
  const dropdown = (h: string, i: number) => (
    <Select ariaLabel={`Import column “${h || `Column ${i + 1}`}” as`} touch placeholder="— Do not import —" options={targets}
      value={mapping[h] ?? ""} onChange={(v) => onMap({ ...mapping, [h]: v })} />
  );

  return (
    <>
      <p className="mt-0.5 font-body text-sm text-muted" role="status" aria-live="polite">
        <span className="font-bold text-foreground">{mappedCount}</span> of {file.headers.length} columns will be imported.
      </p>
      {error && <div className="mt-3"><InlineError>{error}</InlineError></div>}

      {/* tablet / desktop */}
      <div className="mt-5 hidden overflow-hidden rounded-xl border border-border md:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Map each CSV column to a contact field</caption>
          <thead>
            <tr className="border-b border-border bg-background">
              <th scope="col" className="px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">CSV column</th>
              <th scope="col" className="px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">Sample values</th>
              <th scope="col" className="w-64 px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">Import as</th>
            </tr>
          </thead>
          <tbody>
            {file.headers.map((h, i) => (
              <tr key={`${h}-${i}`} className="border-b border-border/60 last:border-0">
                <th scope="row" className="px-4 py-3 font-mono text-xs font-normal text-heading">{h || "(blank)"}</th>
                <td className="px-4 py-3 font-body text-[13px] text-muted">{sampleOf(i)}</td>
                <td className="px-4 py-2.5">{dropdown(h, i)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* phone */}
      <ul className="mt-5 space-y-2.5 md:hidden">
        {file.headers.map((h, i) => (
          <li key={`${h}-${i}`} className="rounded-xl border border-border bg-background p-3.5">
            <p className="break-words font-mono text-xs text-heading">{h || "(blank)"}</p>
            <p className="mb-2.5 mt-0.5 break-words font-body text-[13px] text-muted">e.g. {sampleOf(i)}</p>
            {dropdown(h, i)}
          </li>
        ))}
      </ul>
    </>
  );
}
