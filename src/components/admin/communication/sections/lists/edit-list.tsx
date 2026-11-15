"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, Button } from "../../ui/primitives";
import { Breadcrumb } from "../../ui/breadcrumb";
import { WizardFooter } from "../../ui/wizard-footer";
import { ErrorState, Skeleton } from "../../ui/states";
import { SetupStep, SetupSkeleton } from "../upload/setup-step";
import { EMPTY_FORM, type FormValues } from "../upload/constants";
import { listsApi, uploadApi } from "../../lib/mock-api";
import type { ListRow, Option } from "../../lib/types";

type Opts = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; institutes: Option[]; forms: Option[] };

/**
 * Edit List — the same form as step 1 of Upload Raw Data, filled in.
 * Institute and form are fixed once a list exists; name and description can change.
 */
export function EditList({ list, onBack, onSaved }: { list: ListRow; onBack: () => void; onSaved: (message: string) => void }) {
  const initial: FormValues = { ...EMPTY_FORM, form: list.form ?? "", name: list.name, description: list.description ?? "" };
  const [opts, setOpts] = useState<Opts>({ status: "loading" });
  const [form, setForm] = useState<FormValues>(initial);
  const [nameError, setNameError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(() => {
    setOpts({ status: "loading" });
    uploadApi.setupOptions()
      .then((o) => setOpts({ status: "ready", ...o }))
      .catch((e: unknown) => setOpts({ status: "error", message: e instanceof Error ? e.message : "We could not load the form." }));
  }, []);
  useEffect(load, [load]);

  const dirty = form.name.trim() !== list.name || form.description.trim() !== (list.description ?? "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending || !dirty) return;
    if (form.name.trim().length < 2) { setNameError("Enter a list name (at least 2 characters)."); return; }
    setPending(true); setSubmitError(null);
    try {
      await listsApi.update(list.id, { name: form.name.trim(), description: form.description.trim() });
      onSaved(`List “${form.name.trim()}” updated`);
    } catch (err) {
      setSubmitError(err instanceof Error && err.message ? err.message : "We could not save your changes. Please try again.");
      setPending(false);
    }
  };

  return (
    <>
      <Breadcrumb items={[{ label: "Manage List", onClick: onBack }, { label: `Edit list · ${list.name}` }]} />
      <PageHeader title="Edit List" actions={<Button touch icon="chevronLeft" onClick={onBack}>Back to Manage List</Button>} />
      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-6" aria-labelledby="el-title">
        {opts.status === "error" ? (
          <ErrorState title="Couldn’t load the form" message={opts.message} onRetry={load} />
        ) : opts.status === "loading" ? (
          <><Skeleton className="h-6 w-56" /><SetupSkeleton /></>
        ) : (
          <form onSubmit={submit} noValidate>
            <h2 id="el-title" className="font-display text-lg font-bold text-heading">List details</h2>
            <p className="mt-0.5 font-body text-sm text-muted">
              <span className="font-mono text-xs">ID {list.id}</span> · Institute and form can’t be changed after a list is created.
            </p>
            <SetupStep values={form} errors={{ name: nameError }} institutes={opts.institutes} forms={opts.forms} locked={false}
              lockOnly={["institute", "form"]} onChange={(v) => { setForm(v); setNameError(undefined); }} />
            <WizardFooter onBack={onBack} backLabel="Cancel" primaryLabel="Save changes" pending={pending} primaryDisabled={!dirty}
              hint={dirty ? undefined : "Change the name or description to save"} error={submitError} />
          </form>
        )}
      </section>
    </>
  );
}
