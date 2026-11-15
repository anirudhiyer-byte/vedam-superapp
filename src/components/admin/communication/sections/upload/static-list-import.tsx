"use client";

import { useRef, useState } from "react";
import { PageHeader, Button, Icon, TextField, ConfirmDialog, useToast } from "../../ui/primitives";
import { Field } from "../../ui/form";
import { InlineError, Skeleton } from "../../ui/states";
import { CSV_MAX_ROWS, readCsvFile, type CsvParsed } from "../../lib/csv-identifiers";
import { importApi, type ImportResult } from "../../lib/live-import";

const REQUIREMENTS = [
  ".csv file, up to 1 MB",
  `Up to ${CSV_MAX_ROWS.toLocaleString("en-IN")} rows`,
  "Row 1 = column names, with a phone / mobile and/or an e-mail column",
  "Only the phone and e-mail columns are read; other columns stay on your computer",
  "Only people already in VSAT are added; everyone else is only counted",
];
const n = (v: number) => v.toLocaleString("en-IN");
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Upload Raw Data · LIVE (Slice 3b, behind STATIC_LIST_IMPORT): a CSV becomes a STATIC list.
 * 1) the file is read in the browser and only phone / e-mail cells are kept, 2) "Check matches" asks the server
 * (nothing saved), 3) after a confirm, the list is saved with the matched user ids only.
 * The raw file is never stored or sent; after reading, only the phone / e-mail cells stay in memory until reset.
 */
export function StaticListImport({ onOpenLists }: { onOpenLists?: () => void }) {
  const { toast, toastNode } = useToast({ safe: true });
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<{ name: string; data: CsvParsed } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<{ status: "idle" | "loading" | "ready" | "error"; data?: ImportResult; message?: string }>({ status: "idle" });
  const [name, setName] = useState("");
  const [tried, setTried] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);

  const nameError = !name.trim() ? "Give the list a name." : name.trim().length > 80 ? "Use 80 characters or fewer." : null;
  const people = preview.data?.members ?? 0;

  const reset = () => {
    setFile(null); setFileError(null); setPreview({ status: "idle" }); setName(""); setTried(false); setSaveError(null); setDone(null);
    if (input.current) input.current.value = "";
  };
  const pick = async (f?: File | null) => {
    if (input.current) input.current.value = "";   // the File object is not kept
    if (!f) return;
    setReading(true); setFileError(null); setPreview({ status: "idle" }); setSaveError(null); setDone(null);
    try {
      const r = await readCsvFile(f);
      if (r.ok) setFile({ name: f.name, data: r.data });
      else { setFile(null); setFileError(r.error); }
    } catch {
      setFile(null); setFileError("Could not read this file. Try again.");
    } finally {
      setReading(false);
    }
  };
  const check = () => {
    if (!file || preview.status === "loading") return;
    setPreview({ status: "loading" });
    importApi.preview(file.data.rows)
      .then((data) => setPreview({ status: "ready", data }))
      .catch((e) => setPreview({ status: "error", message: errText(e, "Could not check the file. Try again.") }));
  };
  const askSave = () => { setTried(true); if (!nameError && people > 0) { setSaveError(null); setConfirmOpen(true); } };
  const save = async () => {
    if (!file || saving) return;
    setSaving(true); setSaveError(null);
    try {
      const r = await importApi.create(name, file.data.rows);
      setConfirmOpen(false); setDone(r); setFile(null);   // drop the cells as soon as the list exists
      toast(`List “${r.name ?? name.trim()}” created with ${n(r.members)} ${r.members === 1 ? "person" : "people"}`);
    } catch (e) {
      setSaveError(errText(e, "Could not create the list. Try again."));
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <>
        <PageHeader title="Upload Raw Data" />
        <section aria-label="List created" className="mt-6 grid gap-3 rounded-2xl border border-border bg-surface p-5">
          <p className="inline-flex items-center gap-2 font-body text-base font-semibold text-heading">
            <Icon name="check" className="h-5 w-5 text-[#4ade80]" /> Static list “{done.name}” created
          </p>
          <p className="font-body text-sm text-muted">
            {n(done.members)} {done.members === 1 ? "person" : "people"} from VSAT saved (user ids only). {n(done.unmatched + done.invalid + done.duplicate)} other rows were only counted, not saved.
          </p>
          <div className="flex flex-wrap gap-2">
            {onOpenLists && <Button touch variant="solid" icon="users" onClick={onOpenLists}>Open Manage List</Button>}
            <Button touch icon="upload" onClick={reset}>Upload another file</Button>
          </div>
        </section>
        {toastNode}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Upload Raw Data" />
      <p className="mt-1 font-body text-sm text-muted">Make a static list from a CSV. People are matched to VSAT users by phone or e-mail; only the matches are saved.</p>

      {/* 1 · file */}
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void pick(e.dataTransfer.files?.[0]); }}
        className={`mt-5 grid place-items-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors sm:p-10 ${over ? "border-accent bg-surface-warm/50" : fileError ? "border-[#f87171]/60" : "border-border"}`}>
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-surface-warm text-muted"><Icon name="upload" className="h-6 w-6" /></span>
        <p className="mt-3 font-body text-sm font-semibold text-heading">Drop your .csv file here</p>
        <p className="font-body text-xs text-muted">or</p>
        <div className="mt-2">
          <Button touch icon="folder" disabled={reading || saving} onClick={() => input.current?.click()}>{file ? "Choose a different file" : "Choose file"}</Button>
        </div>
        <input ref={input} type="file" accept=".csv,text/csv" hidden aria-label="CSV file" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {fileError && <div className="mt-3"><InlineError>{fileError}</InlineError></div>}
      {reading && <div className="mt-4 rounded-xl border border-border bg-background p-4" aria-busy="true" role="status"><p className="sr-only">Reading file</p><Skeleton className="h-4 w-48" /></div>}

      {file && !reading && (
        <section aria-label="File" className="mt-4 rounded-xl border border-border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-2 font-body text-sm font-semibold text-heading">
              <Icon name="check" className="h-4 w-4 shrink-0 text-[#4ade80]" /> <span className="truncate">{file.name}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="font-mono text-xs text-muted">{n(file.data.rows.length)} rows</span>
              <Button size="sm" variant="ghost" touch icon="trash" disabled={saving} onClick={reset}>Remove</Button>
            </span>
          </div>
          <p className="mt-2 font-body text-xs text-muted">
            Reading: {[file.data.phoneColumn && `phone from “${file.data.phoneColumn}”`, file.data.emailColumn && `e-mail from “${file.data.emailColumn}”`].filter(Boolean).join(" and ")}.
            {file.data.droppedColumns > 0 && ` ${file.data.droppedColumns} other ${file.data.droppedColumns === 1 ? "column stays" : "columns stay"} on your computer.`}
            {file.data.blankLines > 0 && ` ${file.data.blankLines} blank ${file.data.blankLines === 1 ? "line" : "lines"} skipped.`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button touch icon="eye" disabled={preview.status === "loading" || saving} onClick={check}>Check matches</Button>
            {preview.status === "idle" && <span className="font-body text-xs text-muted">See who is in VSAT before anything is saved.</span>}
          </div>
        </section>
      )}

      {/* 2 · preview (nothing saved yet) */}
      {preview.status === "loading" && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}
      {preview.status === "error" && (
        <div className="mt-4 grid gap-1"><InlineError>{preview.message}</InlineError>
          <button type="button" onClick={check} className="w-fit font-body text-xs font-semibold text-accent-soft underline">Try again</button></div>
      )}
      {preview.status === "ready" && preview.data && file && (
        <section aria-label="Match preview" className="mt-4 grid gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-live="polite">
            {([["Rows", preview.data.rows], ["Matched", preview.data.matched], ["Not in VSAT", preview.data.unmatched], ["Invalid", preview.data.invalid], ["Duplicate", preview.data.duplicate]] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-background px-3 py-2.5">
                <p className="font-body text-xs text-muted">{label}</p>
                <p className="font-display text-xl font-extrabold tabular-nums text-heading">{n(value)}</p>
              </div>
            ))}
          </div>
          <p className="font-body text-sm text-foreground">
            <strong>{n(people)}</strong> {people === 1 ? "person" : "people"} will be in the list · with mobile {n(preview.data.withPhone)} · with e-mail {n(preview.data.withEmail)} · consent given {n(preview.data.consented)}.
            <span className="text-muted"> Not in VSAT, invalid and duplicate rows are only counted, never saved.</span>
          </p>
          {preview.data.sample.length > 0 && (
            <div>
              <p className="mb-1.5 font-body text-xs text-muted">Sample of the newest {preview.data.sample.length} matches (masked).</p>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[300px] text-left font-body text-sm">
                  <thead className="bg-surface-warm text-xs text-muted"><tr><th scope="col" className="px-3 py-2">Mobile</th><th scope="col" className="px-3 py-2">E-mail</th><th scope="col" className="px-3 py-2">Consent</th></tr></thead>
                  <tbody>
                    {preview.data.sample.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">{r.phone ?? "—"}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.email ?? "—"}</td>
                        <td className="px-3 py-2">{r.consent ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3 · name + create */}
          {people === 0 ? (
            <InlineError>Nobody in this file is in VSAT, so there is no list to create.</InlineError>
          ) : (
            <div className="grid gap-3 rounded-xl border border-border bg-surface p-4">
              <Field id="sil-name" label="List name" required stacked error={tried && nameError ? nameError : undefined}>
                <TextField touch id="sil-name" placeholder="e.g. Pune fair leads, Nov" value={name} onChange={setName} maxLength={80} disabled={saving}
                  invalid={!!(tried && nameError)} describedBy={tried && nameError ? "sil-name-error" : undefined} />
              </Field>
              <div><Button touch variant="solid" icon="check" disabled={saving} onClick={askSave}>Create static list</Button></div>
              {saveError && !confirmOpen && <InlineError>{saveError}</InlineError>}
            </div>
          )}
        </section>
      )}

      <section aria-label="File requirements" className="mt-6 rounded-xl border border-border border-l-4 border-l-accent bg-background p-4">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted">File requirements</h3>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {REQUIREMENTS.map((r) => (
            <li key={r} className="flex items-start gap-2 font-body text-[13px] text-foreground"><Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#4ade80]" /> {r}</li>
          ))}
        </ul>
      </section>

      <ConfirmDialog accessible open={confirmOpen} title="Create this static list?"
        body={`“${name.trim()}” will be saved with ${n(people)} ${people === 1 ? "person" : "people"} from VSAT (user ids only). Nothing else from the file is kept.`}
        confirmLabel="Create list" pending={saving} error={saveError}
        onCancel={() => { if (!saving) setConfirmOpen(false); }} onConfirm={() => void save()} />
      {toastNode}
    </>
  );
}
