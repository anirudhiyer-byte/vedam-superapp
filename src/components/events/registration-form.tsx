"use client";

import { useMemo, useState } from "react";
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

/** Value this field should take from the profile, or "" if the profile can't fill it. */
function profileValue(f: EventField, p: Profile): string {
  if (f.type === "multiselect" || f.type === "checkbox") return "";
  const label = f.label.toLowerCase();
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

  // Split into fields the profile already answers (auto) vs. ones we must ask (extra).
  const { autoFields, extraFields, autoVals } = useMemo(() => {
    const auto: EventField[] = [];
    const extra: EventField[] = [];
    const vals: Record<string, string> = {};
    for (const f of schema) {
      const v = profileValue(f, profile);
      if (v) { auto.push(f); vals[f.key] = v; } else { extra.push(f); }
    }
    return { autoFields: auto, extraFields: extra, autoVals: vals };
  }, [schema, profile]);

  const [vals, setVals] = useState<Record<string, string | string[] | boolean>>(() => {
    const init: Record<string, string | string[] | boolean> = {};
    extraFields.forEach((f) => { init[f.key] = f.type === "multiselect" ? [] : f.type === "checkbox" ? false : ""; });
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
  const valid = extraFields.every(fieldOk);

  const pick = (re: RegExp, typ?: EventField["type"]) => {
    const merged: Record<string, unknown> = { ...autoVals, ...vals };
    const f = (typ && schema.find((x) => x.type === typ)) || schema.find((x) => re.test(x.label.toLowerCase()));
    if (!f) return null;
    const v = merged[f.key];
    if (v == null || v === "") return null;
    return String(Array.isArray(v) ? v.join(", ") : v);
  };

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    const utm = readUtm();
    const answers = { ...autoVals, ...vals };

    const { error } = await supabase.from("event_registrations").insert({
      event_id: event.id, event_code: event.event_code, user_id: userId,
      user_email: profile.email, full_name: profile.full_name,
      whatsapp: pick(/whats\s*app|phone|mobile|contact/, "phone"),
      passout_year: pick(/pass\s*out|passing|year of pass|graduat/),
      stream: pick(/stream/),
      answers,
      utm_source: utm.utm_source ?? null, utm_medium: utm.utm_medium ?? null,
      utm_campaign: utm.utm_campaign ?? null, referrer: utm.referrer ?? null, landing_path: utm.landing_path ?? null,
    });
    if (error) {
      setSubmitting(false);
      if (error.code === "23505") return onDone();
      return setError(error.message);
    }

    // Award registration points (server reads the amount from the event config; idempotent).
    try { await supabase.rpc("award_event_points", { p_event_id: event.id, p_action: "register" }); } catch { /* best effort */ }
    await supabase.from("activity_log").insert({
      user_id: userId, event_type: "event_register", app: "events", metadata: { event_code: event.event_code },
    });

    // Resolve the join link. For Zoom events with a meeting ID, add the registrant
    // by email → Zoom returns a PERSONAL join link (only their email can use it),
    // which we then send in the confirmation email and show on the event page.
    let joinLink = event.join_link || undefined;
    try {
      const { data: s } = await supabase.auth.getSession();
      const accessToken = s.session?.access_token;
      if (accessToken) {
        if (event.zoom_meeting_id) {
          try {
            const r = await fetch("/api/zoom/register", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ eventId: event.id, accessToken }),
            });
            const j = await r.json();
            if (j?.join_url) joinLink = j.join_url;
          } catch { /* fall back to the generic link */ }
        }
        if (profile.email) {
          void fetch("/api/events/send-confirmation", {
            method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: profile.email, name: profile.full_name, accessToken,
              event: {
                name: event.name, mode: event.mode,
                dateMs: event.starts_at ? new Date(event.starts_at).getTime() : undefined,
                durationMin: event.duration_minutes || 60,
                platform: event.platform || undefined, join: joinLink,
                host: event.host || undefined, blurb: event.blurb || undefined,
                zoomId: event.zoom_id || undefined, zoomPw: event.zoom_passcode || undefined,
                venue: event.venue || undefined, mapLink: event.map_link || undefined, schedule: event.schedule || null,
                whatsapp: event.whatsapp_community_url || undefined,
              },
            }),
          });
        }
      }
    } catch { /* best effort */ }

    setSubmitting(false);
    try { await supabase.rpc("record_product_usage", { p_product: "events" }); } catch { /* best effort */ }
    onDone();
  }

  return (
    <div className="space-y-4">
      {/* Confirm-your-details review card */}
      <div className="rounded-xl border border-border bg-background p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-body text-xs font-semibold text-foreground">Your details</span>
          <a href="/dashboard" className="font-body text-[11px] text-muted hover:text-foreground">Manage profile</a>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Detail label="Name" value={profile.full_name} />
          <Detail label="Email" value={profile.email} />
          <Detail label="Phone" value={profile.phone} />
          {autoFields.some((f) => /pass\s*out|passing|graduat/.test(f.label.toLowerCase())) && <Detail label="Passout year" value={profile.grad_year ? String(profile.grad_year) : null} />}
          {autoFields.some((f) => /stream/.test(f.label.toLowerCase())) && <Detail label="Stream" value={profile.stream} />}
        </dl>
      </div>

      {/* Only ask for what the profile can't answer */}
      {extraFields.map((f) => (
        <div key={f.key}>
          <label className="mb-1.5 block font-body text-xs font-semibold text-foreground">
            {f.label}{f.required && <span className="text-primary"> *</span>}
          </label>
          <Field f={f} value={vals[f.key]} setVal={setVal} toggleMulti={toggleMulti} />
        </div>
      ))}

      {error && <p className="font-body text-sm text-red-500">{error}</p>}

      <button onClick={submit} disabled={!valid || submitting}
        className="w-full rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60">
        {submitting ? "Registering…" : extraFields.length ? "Confirm registration" : "Register"}
      </button>
      {extraFields.length === 0 && (
        <p className="text-center font-body text-xs text-muted">One tap — we&apos;ll use the details above.</p>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="break-all font-body text-sm font-medium text-foreground">{value || "—"}</dd>
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
  const base = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-[color:rgb(var(--accent))]";
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
            <button key={o} type="button" onClick={() => toggleMulti(f.key, o)}
              className={["rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", on ? "border-transparent bg-brand-gradient text-white" : "border-border text-muted hover:text-foreground"].join(" ")}>
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
        <input type="checkbox" checked={value === true} onChange={(e) => setVal(f.key, e.target.checked)} className="h-4 w-4 accent-[color:rgb(var(--accent))]" />
        <span className="font-body text-sm text-muted">{f.placeholder || "Yes"}</span>
      </label>
    );
  }
  if (f.type === "textarea") {
    return <textarea className={base} rows={3} value={value as string} placeholder={f.placeholder} onChange={(e) => setVal(f.key, e.target.value)} />;
  }
  const inputType = f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : f.type === "date" ? "date" : f.type === "time" ? "time" : "text";
  return (
    <input className={base} type={inputType} value={value as string} placeholder={f.placeholder}
      inputMode={f.type === "phone" || f.type === "number" ? "numeric" : undefined}
      onChange={(e) => setVal(f.key, e.target.value)} />
  );
}
