"use client";

import { useEffect, useRef } from "react";
import { PageHeader, Button, useToast } from "../ui/primitives";
import { Stepper } from "../ui/stepper";
import { Breadcrumb } from "../ui/breadcrumb";
import { WizardFooter } from "../ui/wizard-footer";
import { ErrorState, Skeleton } from "../ui/states";
import { STEPS, CHECKLIST } from "./upload/constants";
import { useUploadWizard, type EntryList } from "./upload/use-wizard";
import { SetupStep, SetupSkeleton } from "./upload/setup-step";
import { ChecklistStep } from "./upload/checklist-step";
import { FileStep } from "./upload/file-step";
import { MappingStep } from "./upload/mapping-step";
import { DoneStep } from "./upload/done-step";

const TITLES = [
  { h: "Create a new list", p: "Name the list your contacts will go into. You will add the file in the next steps." },
  { h: "Before you upload", p: "Confirm each item. These are the mistakes that break an import." },
  { h: "Choose your file", p: "Headers are read from your file, so mapping in the last step uses your real columns." },
  { h: "Map columns", p: "Tell us which contact field each column belongs to." },
] as const;

/**
 * UPLOAD RAW DATA — 4-step wizard (List setup → Checklist → Upload CSV → Map columns).
 *
 * `entryList` + `onBack` are for the drill-down from Manage List › Import Contact:
 * the wizard opens at the Checklist for that list, with a breadcrumb back.
 * Backend swap point: `uploadApi` in lib/mock-api.ts.
 */
export function UploadRawData({ entryList, onBack }: { entryList?: EntryList; onBack?: () => void }) {
  const { toast, toastNode } = useToast({ safe: true });
  const w = useUploadWizard(entryList, toast);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // move focus to the step title when the step changes (screen readers + keyboard users)
  const isDone = !!w.done;
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
  }, [w.step, isDone]);

  const backToList = onBack && entryList;
  const titles = TITLES[w.step];
  const stepsFloor = entryList ? 1 : 0;
  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); void w.next(); };
  const goBack = () => { if (!w.back()) onBack?.(); };

  const primary = ["Save & next", "Continue", "Upload", "Start import"][w.step];
  const primaryLabel = w.step === 0 && w.list ? "Next" : primary;
  const hint =
    w.step === 1 && w.ackCount < CHECKLIST.length ? `Confirm ${CHECKLIST.length - w.ackCount} more required ${CHECKLIST.length - w.ackCount === 1 ? "item" : "items"} to continue`
    : w.step === 2 && !w.file ? "Choose a file to enable Upload" : undefined;

  return (
    <>
      {backToList && (
        <Breadcrumb items={[{ label: "Manage List", onClick: onBack }, { label: `Import contacts · ${entryList.name}` }]} />
      )}
      <PageHeader title={backToList ? "Import Contacts" : "Upload Raw Data"}
        actions={
          <>
            {backToList && <Button touch icon="chevronLeft" onClick={onBack}>Back to Manage List</Button>}
            <Button touch icon="refresh" onClick={w.reset}>Start over</Button>
          </>
        } />

      {w.done ? (
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-6">
          <h2 ref={heading} tabIndex={-1} className="sr-only">Import queued</h2>
          <DoneStep done={w.done} onAgain={w.reset} onBack={onBack} backLabel="Back to Manage List" />
        </section>
      ) : (
        <>
          <Stepper steps={STEPS} current={w.step} />
          <section className="rounded-2xl border border-border bg-surface p-4 sm:p-6" aria-labelledby="us-step-title">
            {w.opts.status === "error" ? (
              <ErrorState title="Couldn’t load the form" message={w.opts.message} onRetry={w.loadOptions} />
            ) : w.opts.status === "loading" ? (
              <>
                <Skeleton className="h-6 w-56" />
                <SetupSkeleton />
              </>
            ) : (
              <form onSubmit={onSubmit} noValidate>
                <h2 id="us-step-title" ref={heading} tabIndex={-1} className="font-display text-lg font-bold text-heading outline-none">{titles.h}</h2>
                <p className="mt-0.5 font-body text-sm text-muted">{titles.p}</p>
                {w.list && w.step > 0 && (
                  <p className="mt-2 inline-flex rounded-md bg-surface-warm px-2 py-1 font-mono text-[11px] text-foreground">
                    List · {w.list.name} · ID {w.list.id}
                  </p>
                )}

                {w.step === 0 && (
                  <SetupStep values={w.form} errors={w.formErrors} institutes={w.opts.institutes} forms={w.opts.forms}
                    locked={!!w.list} onChange={w.setForm} />
                )}
                {w.step === 1 && (
                  <ChecklistStep ack={w.ack} onAck={w.setAck} ackCount={w.ackCount} tagOn={w.tagOn} onTagOn={w.setTagOn} tag={w.tag} onTag={w.setTag} />
                )}
                {w.step === 2 && (
                  <FileStep file={w.file} error={w.fileError} reading={w.reading} onPick={w.chooseFile} onRemove={w.removeFile} />
                )}
                {w.step === 3 && w.file && (
                  <MappingStep file={w.file} mapping={w.mapping} onMap={w.setMapping} mappedCount={w.mappedCount}
                    error={w.mapError} onChooseAnother={() => { w.removeFile(); w.back(); }} />
                )}

                <WizardFooter
                  onBack={w.step > stepsFloor || backToList ? goBack : undefined}
                  backLabel={w.step === stepsFloor && backToList ? "Back to Manage List" : "Back"}
                  primaryLabel={primaryLabel}
                  pending={w.pending || w.reading}
                  primaryDisabled={(w.step === 1 && w.ackCount < CHECKLIST.length) || (w.step === 2 && !w.file) || (w.step === 3 && w.dupTarget)}
                  hint={hint}
                  error={w.submitError}
                  extra={w.step === 0 && !w.list ? <Button touch onClick={() => w.setForm({ institute: "vedam", form: "", name: "", description: "" })}>Reset</Button> : undefined}
                />
              </form>
            )}
          </section>
        </>
      )}

      {toastNode}
    </>
  );
}
