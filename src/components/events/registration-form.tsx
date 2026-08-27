"use client";

import { useState } from "react";
import type { EventRow, EventField } from "@/lib/events";
import { eventSchema } from "@/lib/events";
import { createClient } from "@/lib/supabase/client";
import { readUtm } from "@/lib/utm";

type Profile = {
  full_name: string | null;
  phone: string | null;
  email: string | null;
  grad_year: number | null;
  stream: string | null;
};

/** Pre-fill a field from the profile when it clearly maps to a known attribute. */
function prefill(f: EventField, p: Profile): string | string[] | boolean {
  const label = f.label.toLowerCase();
  if (f.type === "multiselect") return [];
  if (f.type === "checkbox") return false;
  if (f.type === "phone" || /whats\s*app|phone|mobile|contact/.test(label)) return p.phone ?? "";
  if (/pass\s*out|passing|year of pass|graduat/.test(label)) return p.grad_year ? String(p.grad_year) : "";
  if (/stream/.test(label)) return p.stream ?? "";
  return "";
}

export function RegistrationForm({
  event, profile, userId, onDone,
}: {
  event: EventRow;
  profile: Profile;
  userId: string;
  onDone: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const schema = eventSchema(event);
  const [vals, setVals] = useState<Record<string, string | string[] | boolean>>(() => {
    const init: Record<string, string | string[] | boolean> = {};
    schema.forEach((f) => { init[f.key] = prefill(f, profile); });
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setVal = (k: string, v: string | string[] | boolean) => setVals((s) => ({ ...s, [k]: v }));
  const toggleMulti = (k: string, opt: string) =>
    setVals((s) => {
      const arr = Array.isArray(s[k]) ? (s[k] as string[]) : [];
      return { ...s, [k]: arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt] };
    });

  const fieldOk = (f: EventField) => {
    if (!f.required) return true;
    const v = vals[f.key];
    if (f.type === "multiselect") return Array.isArray(v) && v.length > 0;
    if (f.type === "checkbox") return v === true;
    if (f.type === "phone") return String(v || "").replace(/\D/g, "").length >= 10;
    return String(v ?? "").trim().length > 0;
  };
  const valid = schema.every(fieldOk);

  /** Derive the legacy whatsapp/passout_year/stream columns from answers by label/type. */
  const pick = (re: RegExp, typ?: EventField["type"]) => {
    const f = (typ && schema.find((x) => x.type === typ)) || schema.find((x) => re.test(x.label.toLowerCase()));
    if (!f) return null;
    const v = vals[f.key];
    if (v == null || v === "") return null;
    return String(Array.isArray(v) ? v.join(", ") : v);
  };

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    const utm = readUtm();

    const { error } = await supabase.from("event_registrations").insert({
      event_id: event.id,
      event_code: event.event_code,
      user_id: userId,
      user_email: profile.email,
      full_name: profile.full_name,
      whatsapp: pick(/whats\s*app|phone|mobile|contact/, "phone"),
      passout_year: pick(/pass\s*out|passing|year of pass|graduat/),
      stream: pick(/stream/),
      answers: vals,
      utm_source: utm.utm_source ?? null,
      utm_medium: utm.utm_medium ?? null,
      utm_campaign: utm.utm_campaign ?? null,
      referrer: utm.referrer ?? null,
      landing_path: utm.landing_path ?? null,
    });

    if (error) {
      setSubmitting(false);
      // 23505 = already registered -> treat as success (idempotent)
      if (error.code === "23505") return onDone();
      return setError(error.message);
    }
    await supabase.from("activity_log").insert({
      user_id: userId, event_type: "event_register", app: "events",
      metadata: { event_code: event.event_code },
    });
    setSubmitting(false);
    onDone();
  }

  return (
    <div className="space-y-4">
      {schema.map((f) => (
        <div key={f.key}>
          <label className="mb-1.5 block font-body text-xs font-semibold text-foreground">
            {f.label}{f.required && <span className="text-primary"> *</span>}
          </label>
          <Field f={f} value={vals[f.key]} setVal={setVal} toggleMulti={toggleMulti} />
        </div>
      ))}

      {error && <p className="font-body text-sm text-red-500">{error}</p>}

      <button
        onClick={submit}
        disabled={!valid || submitting}
        className="w-full rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? "Registering…" : "Confirm registration"}
      </button>
    </div>
  );
}

function Field({
  f, value, setVal, toggleMulti,
}: {
  f: EventField;
  value: string | string[] | boolean;
  setVal: (k: string, v: string | string[] | boolean) => void;
  toggleMulti: (k: string, opt: string) => void;
}) {
  const base =
    "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-[color:rgb(var(--accent))]";

  if (f.type === "dropdown") {
    return (
      <select className={base} value={value as string} onChange={(e) => setVal(f.key, e.target.value)}>
        <option value="">Select</option>
        {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (f.type === "multiselect") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        {(f.options || []).map((o) => {
          const on = arr.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => toggleMulti(f.key, o)}
              className={[
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                on ? "border-transparent bg-brand-gradient text-white" : "border-border text-muted hover:text-foreground",
              ].join(" ")}
            >
              {o}
            </button>
          );
        })}
      </div>
    );
  }
  if (f.type === "checkbox") {
    return (
      <label className="flex items-center gap-2.5">
        <input type="checkbox" checked={value === true} onChange={(e) => setVal(f.key, e.target.checked)}
          className="h-4 w-4 accent-[color:rgb(var(--accent))]" />
        <span className="font-body text-sm text-muted">{f.placeholder || "Yes"}</span>
      </label>
    );
  }
  if (f.type === "textarea") {
    return <textarea className={base} rows={3} value={value as string} placeholder={f.placeholder}
      onChange={(e) => setVal(f.key, e.target.value)} />;
  }
  const inputType =
    f.type === "number" ? "number" : f.type === "email" ? "email" :
    f.type === "phone" ? "tel" : f.type === "date" ? "date" : f.type === "time" ? "time" : "text";
  return (
    <input className={base} type={inputType} value={value as string} placeholder={f.placeholder}
      inputMode={f.type === "phone" || f.type === "number" ? "numeric" : undefined}
      onChange={(e) => setVal(f.key, e.target.value)} />
  );
}
