"use client";

import { Select, TextField, TextArea } from "../../ui/primitives";
import { Field } from "../../ui/form";
import { Skeleton } from "../../ui/states";
import type { Option } from "../../lib/types";
import type { FormValues } from "./constants";

export function SetupStep({ values, errors, institutes, forms, locked, lockOnly, onChange }: {
  values: FormValues; errors: Partial<Record<"institute" | "name", string>>;
  institutes: Option[]; forms: Option[]; locked: boolean; onChange: (v: FormValues) => void;
  /** Edit List: lock just these fields (overrides `locked`). */
  lockOnly?: (keyof FormValues)[];
}) {
  const set = (patch: Partial<FormValues>) => onChange({ ...values, ...patch });
  const off = (k: keyof FormValues) => (lockOnly ? lockOnly.includes(k) : locked);
  return (
    <div className="mt-6 grid max-w-2xl gap-5">
      <Field id="us-institute" label="Institute" required error={errors.institute}>
        <Select id="us-institute" touch placeholder="Select institute" options={institutes} value={values.institute}
          disabled={off("institute")} invalid={!!errors.institute} describedBy={errors.institute ? "us-institute-error" : undefined}
          onChange={(v) => set({ institute: v })} />
      </Field>
      <Field id="us-form" label="Form" hint="(optional)">
        <Select id="us-form" touch placeholder="Select a form" options={forms} value={values.form} disabled={off("form")}
          onChange={(v) => set({ form: v })} />
      </Field>
      <Field id="us-name" label="List name" required error={errors.name}>
        <TextField id="us-name" touch placeholder="e.g. Pune expo walk-ins" maxLength={60} value={values.name} disabled={off("name")}
          invalid={!!errors.name} describedBy={errors.name ? "us-name-error" : undefined}
          onChange={(v) => set({ name: v })} />
      </Field>
      <Field id="us-desc" label="Description" hint="(optional)">
        <TextArea id="us-desc" touch placeholder="What is this list for?" maxLength={200} value={values.description} disabled={off("description")}
          onChange={(v) => set({ description: v })} />
      </Field>
    </div>
  );
}

/** Loading placeholder shaped like the setup form. */
export function SetupSkeleton() {
  return (
    <div className="mt-6 grid max-w-2xl gap-5" aria-busy="true" aria-label="Loading form">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid gap-1.5 sm:grid-cols-[180px_1fr] sm:gap-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className={i === 3 ? "h-20 w-full" : "h-11 w-full sm:h-10"} />
        </div>
      ))}
    </div>
  );
}
