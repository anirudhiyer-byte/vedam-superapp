"use client";

import { useState } from "react";
import { Modal, Button, Select } from "../../ui/primitives";
import { Field } from "../../ui/form";
import { ErrorState, InlineError, Skeleton } from "../../ui/states";
import { listsApi } from "../../lib/mock-api";
import type { ListRow } from "../../lib/types";
import type { OptionsState } from "./use-options";

/** Change List Owner — one required dropdown. The current owner is not offered. */
type Props = { options: OptionsState; onRetryOptions: () => void; onClose: () => void; onSaved: (message: string) => void };

export function OwnerModal({ list, ...rest }: Props & { list: ListRow | null }) {
  return list ? <OwnerModalBody key={list.id} list={list} {...rest} /> : null;
}

function OwnerModalBody({ list, options, onRetryOptions, onClose, onSaved }: Props & { list: ListRow }) {
  const [owner, setOwner] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const choices = options.status === "ready" ? (options.options.owner ?? []).filter((o) => o.value !== list.owner) : [];

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (pending) return;
    if (!owner) { setFieldError("Choose the new owner."); return; }
    setPending(true); setSubmitError(null);
    try {
      await listsApi.changeOwner([list.id], owner);
      onSaved(`“${list.name}” is now owned by ${owner}`);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error && err.message ? err.message : "We could not change the owner. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open title="Change List Owner" onClose={onClose}
      footer={
        options.status === "ready" ? (
          <>
            <Button variant="ghost" touch disabled={pending} onClick={onClose}>Cancel</Button>
            <Button variant="solid" touch disabled={pending} className="sm:min-w-[7rem]" onClick={() => void submit()}>
              {pending ? "Saving…" : "Save owner"}
            </Button>
          </>
        ) : <Button variant="ghost" touch onClick={onClose}>Close</Button>
      }>
      <form id="owner-form" onSubmit={submit} noValidate>
        <p className="font-body text-sm text-muted">
          <span className="font-semibold text-foreground">{list.name}</span> is owned by <span className="font-semibold text-foreground">{list.owner}</span>.
        </p>
        <div className="mt-4">
          {options.status === "loading" && <div aria-busy="true" aria-label="Loading owners"><Skeleton className="mb-2 h-4 w-24" /><Skeleton className="h-11 w-full sm:h-10" /></div>}
          {options.status === "error" && <ErrorState title="Couldn’t load owners" message={options.message} onRetry={onRetryOptions} />}
          {options.status === "ready" && (
            choices.length === 0
              ? <p className="rounded-lg border border-dashed border-border p-3 font-body text-sm text-muted">There is no other owner to choose from yet.</p>
              : (
                <Field id="owner-new" label="New owner" required error={fieldError ?? undefined} stacked>
                  <Select id="owner-new" touch placeholder="Select an owner" options={choices} value={owner}
                    invalid={!!fieldError} describedBy={fieldError ? "owner-new-error" : undefined}
                    onChange={(v) => { setOwner(v); setFieldError(null); }} />
                </Field>
              )
          )}
        </div>
        {submitError && <div className="mt-3"><InlineError>{submitError}</InlineError></div>}
      </form>
    </Modal>
  );
}
