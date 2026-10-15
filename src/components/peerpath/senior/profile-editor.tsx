"use client";

import { useState } from "react";
import { CAMPUSES, CLUBS, DURATIONS, LANGUAGES, RESIDENCE, SESSION_TYPES, STATES, TOPICS, YEARS, type Campus, type Duration, type SessionType, type Topic, type Year } from "@/lib/peerpath/constants";
import type { SeniorProfileInput } from "@/lib/peerpath/types";
import { createSenior, saveProfile } from "@/lib/peerpath/client";
import { yearLabel } from "@/components/peerpath/ui";

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Chips<T extends string | number>({ options, value, onChange, render }: { options: readonly T[]; value: T[]; onChange: (v: T[]) => void; render?: (v: T) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={String(o)} type="button" aria-pressed={value.includes(o)} onClick={() => onChange(toggle(value, o))} className={`pp-chip ${value.includes(o) ? "pp-chip-on" : ""}`}>
          {render ? render(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

const MEET = /^https:\/\/meet\.google\.com\/[a-z0-9-]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Edits a senior's profile. Without a token it creates a new senior (status: waiting for approval). */
export function ProfileEditor({ token, initial, onCreated }: { token?: string; initial: SeniorProfileInput; onCreated?: (r: { id: string; token: string }) => void }) {
  const [p, setP] = useState<SeniorProfileInput>(initial);
  const [askInput, setAskInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const set = (patch: Partial<SeniorProfileInput>) => setP((x) => ({ ...x, ...patch }));

  const addAsk = () => {
    const v = askInput.trim();
    if (!v || p.askMeAbout.includes(v) || p.askMeAbout.length >= 6) return;
    set({ askMeAbout: [...p.askMeAbout, v] });
    setAskInput("");
  };

  async function save() {
    if (!p.firstName.trim() || p.topics.length === 0 || p.languages.length === 0 || p.sessionTypes.length === 0 || p.durations.length === 0) {
      setStatus({ kind: "err", msg: "Please add your first name, at least one topic, language, session type and duration." });
      return;
    }
    if (!EMAIL.test(p.contactEmail.trim())) {
      setStatus({ kind: "err", msg: "Please add the email the Vedam team can reach you on." });
      return;
    }
    const meet = (p.meetLink ?? "").trim().replace(/^(https?:\/\/)?/, "https://");
    if ((p.meetLink ?? "").trim() && !MEET.test(meet)) {
      setStatus({ kind: "err", msg: "The Meet link should look like https://meet.google.com/abc-defg-hij" });
      return;
    }
    const body = { ...p, meetLink: (p.meetLink ?? "").trim() ? meet : null, contactEmail: p.contactEmail.trim() };
    setBusy(true);
    setStatus(null);
    if (!token) {
      const res = await createSenior(body);
      setBusy(false);
      if (res.ok) onCreated?.(res);
      else setStatus({ kind: "err", msg: res.message });
      return;
    }
    const res = await saveProfile(token, body);
    setBusy(false);
    setStatus(res.ok ? { kind: "ok", msg: "Profile saved." } : { kind: "err", msg: res.message });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="pp-card grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fn" className="pp-label">First name</label>
          <input id="fn" className="pp-field" value={p.firstName} onChange={(e) => set({ firstName: e.target.value })} />
          <p className="text-[13px] text-pp-muted">Only your first name is shown to applicants.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="pp-label">Your email</label>
          <input id="email" type="email" autoComplete="email" className="pp-field" value={p.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} />
          <p className="text-[13px] text-pp-muted">Only the Vedam team sees this.</p>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pp-label mb-1.5">Campus</legend>
          <Chips options={CAMPUSES} value={[p.campus]} onChange={(v) => v.length && set({ campus: v[v.length - 1] as Campus })} />
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pp-label mb-1.5">Year</legend>
          <Chips options={YEARS} value={[p.year]} onChange={(v) => v.length && set({ year: v[v.length - 1] as Year })} render={(y) => yearLabel(Number(y))} />
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="meet" className="pp-label">Your Google Meet link</label>
          <input id="meet" inputMode="url" className="pp-field" placeholder="https://meet.google.com/abc-defg-hij" value={p.meetLink ?? ""} onChange={(e) => set({ meetLink: e.target.value || null })} />
          <p className="text-[13px] text-pp-muted">Open meet.google.com, choose “Create a meeting for later” and paste the link. Applicants join you here.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="city" className="pp-label">Home city</label>
          <input id="city" className="pp-field" value={p.homeCity ?? ""} onChange={(e) => set({ homeCity: e.target.value || null })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="state" className="pp-label">Home state</label>
          <select id="state" className="pp-field" value={p.homeState ?? ""} onChange={(e) => set({ homeState: e.target.value || null })}>
            <option value="">Select state</option>
            {STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pp-label mb-1.5">Hostel or day scholar</legend>
          <Chips options={RESIDENCE} value={p.residence ? [p.residence] : []} onChange={(v) => set({ residence: v[v.length - 1] ?? null })} />
        </fieldset>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="bio" className="pp-label">About you</label>
          <textarea id="bio" rows={4} maxLength={500} className="pp-field py-3" value={p.bio} onChange={(e) => set({ bio: e.target.value })} placeholder="Why you joined Vedam, what you enjoy, what you can help with. Share your own experience only." />
          <p className="text-[13px] text-pp-muted">{p.bio.length}/500</p>
        </div>
      </section>

      <section className="pp-card flex flex-col gap-5 p-5 sm:p-6">
        <fieldset>
          <legend className="pp-label mb-2.5">Topics you can talk about</legend>
          <Chips options={TOPICS} value={p.topics} onChange={(v) => set({ topics: v as Topic[] })} />
        </fieldset>
        <div className="flex flex-col gap-2">
          <label htmlFor="ask" className="pp-label">“Ask me about” <span className="font-normal text-pp-muted">(up to 6 short lines)</span></label>
          <div className="flex gap-2">
            <input id="ask" className="pp-field" value={askInput} maxLength={40} placeholder="e.g. Cleared VSAT on 2nd try" onChange={(e) => setAskInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAsk())} />
            <button type="button" className="pp-btn-secondary" onClick={addAsk} disabled={!askInput.trim() || p.askMeAbout.length >= 6}>Add</button>
          </div>
          {p.askMeAbout.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {p.askMeAbout.map((a) => (
                <li key={a}>
                  <button type="button" onClick={() => set({ askMeAbout: p.askMeAbout.filter((x) => x !== a) })} className="pp-tag gap-1.5 hover:bg-pp-violet-100" aria-label={`Remove ${a}`}>
                    {a} <span aria-hidden>×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <fieldset>
          <legend className="pp-label mb-2.5">Languages you speak</legend>
          <Chips options={LANGUAGES} value={p.languages} onChange={(v) => set({ languages: v })} />
        </fieldset>
        <fieldset>
          <legend className="pp-label mb-2.5">Clubs</legend>
          <Chips options={CLUBS} value={p.clubs} onChange={(v) => set({ clubs: v })} />
        </fieldset>
        <div className="grid gap-5 sm:grid-cols-2">
          <fieldset>
            <legend className="pp-label mb-2.5">Session types</legend>
            <Chips options={SESSION_TYPES} value={p.sessionTypes} onChange={(v) => set({ sessionTypes: v as SessionType[] })} render={(v) => (v === "1:1" ? "1:1 chat" : "Group chat")} />
          </fieldset>
          <fieldset>
            <legend className="pp-label mb-2.5">Session length</legend>
            <Chips options={DURATIONS} value={p.durations} onChange={(v) => set({ durations: v as Duration[] })} render={(v) => `${v} min`} />
          </fieldset>
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-pp-line bg-pp-card/95 px-4 py-4 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:rounded-2xl sm:border">
        <button type="button" className="pp-btn-primary sm:px-10" onClick={save} disabled={busy}>
          {busy ? "Saving…" : token ? "Save profile" : "Create my senior profile"}
        </button>
        {status && (
          <p role="status" className={`text-[14px] font-medium ${status.kind === "ok" ? "text-[#4ADE80]" : "text-[#FF7A6E]"}`}>
            {status.msg}
          </p>
        )}
      </div>
    </div>
  );
}
