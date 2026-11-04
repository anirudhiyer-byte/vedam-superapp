"use client";

import { useState } from "react";
import { Drawer, Button, TextField, TextArea, Select } from "../../ui/primitives";
import { Field } from "../../ui/form";
import { InlineError } from "../../ui/states";
import { CategoryPicker } from "./category-picker";
import { flowsApi } from "../../lib/mock-api";
import type { FlowRow } from "../../lib/types";

const REQUIRED = "Field is required.";
const PICK = "Please select an option.";
type Values = { name: string; module: "" | "Leads" | "Raw Data"; category: string; description: string };
type Errors = Partial<Record<keyof Values, string>>;

/** Opens empty from "Create", or pre-filled from a Recommended flow's "Use". */
export type CreateRequest = { from?: FlowRow } | null;

export function CreateFlowDrawer({ request, onClose, onCreated }: {
  request: CreateRequest; onClose: () => void; onCreated: (row: FlowRow) => void;
}) {
  return request ? <CreateBody key={request.from?.id ?? "new"} from={request.from} onClose={onClose} onCreated={onCreated} /> : null;
}

function CreateBody({ from, onClose, onCreated }: { from?: FlowRow; onClose: () => void; onCreated: (row: FlowRow) => void }) {
  const [v, setV] = useState<Values>({ name: from?.name ?? "", module: "", category: from?.category ?? "", description: from?.description ?? "" });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set = <K extends keyof Values>(k: K, val: Values[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = (): Errors => ({
    name: v.name.trim() ? undefined : REQUIRED,
    module: v.module ? undefined : PICK,
    category: v.category ? undefined : PICK,
    description: v.description.trim() ? undefined : REQUIRED,
  });

  const submit = async () => {
    if (pending) return;
    const e = validate();
    setErrors(e);
    const first = (Object.keys(e) as (keyof Values)[]).find((k) => e[k]);
    if (first) {
      const target = first === "category" ? document.querySelector<HTMLElement>('input[name="flow-category"], #flow-category-search') : document.getElementById(`flow-${first}`);
      target?.focus();
      return;
    }
    setPending(true); setSubmitError(null);
    try {
      const row = await flowsApi.create({ name: v.name, module: v.module as "Leads" | "Raw Data", category: v.category, description: v.description, fromId: from?.id });
      onCreated(row);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "We could not create the flow. Please try again.";
      if (/name/i.test(msg)) { setErrors((x) => ({ ...x, name: msg })); document.getElementById("flow-name")?.focus(); }
      else setSubmitError(msg);
    } finally {
      setPending(false);
    }
  };

  return (
    <Drawer open accessible title="Create Flow" closeLabel="Close create flow" onClose={() => { if (!pending) onClose(); }}
      footer={
        <>
          <Button variant="ghost" touch disabled={pending} onClick={onClose}>Cancel</Button>
          <Button variant="solid" touch disabled={pending} onClick={submit}>{pending ? "Creating…" : "Continue"}</Button>
        </>
      }>
      <form noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        {from && (
          <p className="rounded-lg border border-border bg-background p-3 font-body text-sm text-muted">
            Starting from <span className="font-semibold text-foreground">{from.name}</span>. Its screens are copied into your new flow. Change anything below.
          </p>
        )}
        <Field id="flow-name" label="Flow Name" required error={errors.name} stacked>
          <TextField id="flow-name" touch placeholder="e.g. VSAT slot booking" maxLength={60} value={v.name}
            invalid={!!errors.name} describedBy={errors.name ? "flow-name-error" : undefined} onChange={(x) => set("name", x)} />
        </Field>
        <Field id="flow-module" label="Module" required error={errors.module} stacked>
          <Select id="flow-module" touch placeholder="Select module" value={v.module}
            options={[{ value: "Leads", label: "Leads" }, { value: "Raw Data", label: "Raw Data" }]}
            invalid={!!errors.module} describedBy={errors.module ? "flow-module-error" : undefined}
            onChange={(x) => set("module", x as Values["module"])} />
        </Field>
        <CategoryPicker value={v.category} error={errors.category} onChange={(x) => set("category", x)} />
        <Field id="flow-description" label="Flow Description" required hint="(up to 200 characters)" error={errors.description} stacked>
          <TextArea id="flow-description" touch placeholder="What this flow collects, and from whom" maxLength={200} value={v.description}
            invalid={!!errors.description} describedBy={errors.description ? "flow-description-error" : undefined} onChange={(x) => set("description", x)} />
        </Field>
        <p className="font-body text-xs text-muted">The new flow is saved as a Draft in My Flow.</p>
        {submitError && <InlineError>{submitError}</InlineError>}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Drawer>
  );
}
