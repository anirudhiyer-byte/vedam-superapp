"use client";

import { Select } from "../../ui/primitives";
import { Field, RadioGroup } from "../../ui/form";
import type { Option } from "../../lib/types";

export type ChannelValues = { template: string; sender: string; when: "now" | "later"; at: string };
export const EMPTY_CHANNEL: ChannelValues = { template: "", sender: "", when: "now", at: "" };
export type ChannelErrors = Partial<Record<"template" | "sender" | "at", string>>;

export function validateChannel(v: ChannelValues, now = new Date()): ChannelErrors {
  const e: ChannelErrors = {};
  if (!v.template) e.template = "Choose a template.";
  if (!v.sender) e.sender = "Choose who it is sent from.";
  if (v.when === "later") {
    if (!v.at) e.at = "Pick a date and time.";
    else if (new Date(v.at).getTime() <= now.getTime()) e.at = "Pick a time in the future.";
  }
  return e;
}

/** One channel's form. The four channels share it; only the options and wording differ. */
export function ChannelForm({ channel, label, templates, senders, values, errors, onChange }: {
  channel: string; label: string; templates: Option[]; senders: Option[];
    values: ChannelValues; errors: ChannelErrors; onChange: (v: ChannelValues, edited: (keyof ChannelErrors)[]) => void;
}) {
  const set = (patch: Partial<ChannelValues>) =>
    onChange({ ...values, ...patch }, Object.keys(patch).map((k) => (k === "when" ? "at" : k)) as (keyof ChannelErrors)[]);
  const id = (k: string) => `cm-${channel}-${k}`;
  return (
    <div className="grid gap-4">
      <Field id={id("template")} label={`${label} template`} required error={errors.template} stacked>
        <Select id={id("template")} touch placeholder="Select a template" options={templates} value={values.template}
          invalid={!!errors.template} describedBy={errors.template ? `${id("template")}-error` : undefined}
          onChange={(v) => set({ template: v })} />
      </Field>
      <Field id={id("sender")} label="Send from" required error={errors.sender} stacked>
        <Select id={id("sender")} touch placeholder="Select a sender" options={senders} value={values.sender}
          invalid={!!errors.sender} describedBy={errors.sender ? `${id("sender")}-error` : undefined}
          onChange={(v) => set({ sender: v })} />
      </Field>
      <RadioGroup name={id("when")} legend="When" value={values.when} onChange={(v) => set({ when: v as "now" | "later" })}
        options={[{ value: "now", label: "Send now" }, { value: "later", label: "Schedule for later" }]} />
      {values.when === "later" && (
        <Field id={id("at")} label="Date and time" required error={errors.at} stacked>
          <input id={id("at")} type="datetime-local" value={values.at} onChange={(e) => set({ at: e.target.value })}
            aria-invalid={!!errors.at || undefined} aria-describedby={errors.at ? `${id("at")}-error` : undefined}
            className={`min-h-[44px] w-full rounded-lg border bg-background px-3 py-2 font-body text-sm text-foreground outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft/60 sm:min-h-0 [color-scheme:dark] ${errors.at ? "border-[#f87171]" : "border-border"}`} />
        </Field>
      )}
    </div>
  );
}
