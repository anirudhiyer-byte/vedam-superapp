"use client";

import { DURATIONS, LANGUAGES, RESIDENCE, SESSION_TYPES, STATES, TIME_OF_DAY, TOPICS, YEARS, type Topic } from "@/lib/peerpath/constants";
import { nextDays } from "@/lib/peerpath/slots";
import { yearLabel } from "@/components/peerpath/ui";
import type { Filters } from "./filters";

type Props = {
  value: Filters;
  onChange: (f: Filters) => void;
  showTopics?: boolean;
  languagesInUse: string[];
  statesInUse: string[];
};

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = "f-" + title.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2.5 border-t border-pp-line pt-4 first:border-t-0 first:pt-0">
      <h3 id={id} className="text-[14px] font-semibold text-pp-heading">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button type="button" aria-pressed={on} aria-label={label} onClick={onClick} className={`pp-chip ${on ? "pp-chip-on" : ""}`}>
      {children}
    </button>
  );
}

export function FilterPanel({ value: f, onChange, showTopics = true, languagesInUse, statesInUse }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const days = nextDays(7);
  // Offer languages and states that seniors actually have; fall back to the full list.
  const langs = languagesInUse.length ? LANGUAGES.filter((l) => languagesInUse.includes(l)) : LANGUAGES;
  const states = statesInUse.length ? STATES.filter((s) => statesInUse.includes(s)) : STATES;

  return (
    <div className="flex flex-col gap-4">
      {showTopics && (
        <Section title="What do you want to ask about?">
          <div className="flex flex-wrap gap-2">
            {TOPICS.map((t: Topic) => (
              <Chip key={t} on={f.topics.includes(t)} onClick={() => set({ topics: toggle(f.topics, t) })}>
                {t}
              </Chip>
            ))}
          </div>
        </Section>
      )}

      <Section title="Day">
        <div className="flex flex-wrap gap-2">
          {days.map((d) => (
            <Chip key={d.key} on={f.date === d.key} onClick={() => set({ date: f.date === d.key ? null : d.key })} label={`${d.dow} ${d.date} ${d.month}`}>
              {d.dow === "Today" ? "Today" : `${d.dow} ${d.date}`}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Time of day">
        <div className="flex flex-wrap gap-2">
          {TIME_OF_DAY.map((t) => (
            <Chip key={t.id} on={f.timeOfDay.includes(t.id)} onClick={() => set({ timeOfDay: toggle(f.timeOfDay, t.id) })}>
              {t.label} <span className="ml-1 opacity-70">{t.hint}</span>
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Session type">
        <div className="flex flex-wrap gap-2">
          {SESSION_TYPES.map((t) => (
            <Chip key={t} on={f.sessionType === t} onClick={() => set({ sessionType: f.sessionType === t ? null : t })}>
              {t === "1:1" ? "1:1 chat" : "Group chat"}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Duration">
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <Chip key={d} on={f.duration === d} onClick={() => set({ duration: f.duration === d ? null : d })}>
              {d === 15 ? "15 min · quick question" : "30 min"}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Language">
        <div className="flex flex-wrap gap-2">
          {langs.map((l) => (
            <Chip key={l} on={f.languages.includes(l)} onClick={() => set({ languages: toggle(f.languages, l) })}>
              {l}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Senior's year">
        <div className="flex flex-wrap gap-2">
          {YEARS.map((y) => (
            <Chip key={y} on={f.years.includes(y)} onClick={() => set({ years: toggle(f.years, y) })}>
              {yearLabel(y)}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Rating">
        <div className="flex flex-wrap gap-2">
          {[0, 4, 4.5].map((r) => (
            <Chip key={r} on={f.minRating === r} onClick={() => set({ minRating: r })}>
              {r === 0 ? "Any" : `${r}★ & up`}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Senior from your state">
        <label className="sr-only" htmlFor="home-state">Home state</label>
        <select id="home-state" className="pp-field" value={f.homeState} onChange={(e) => set({ homeState: e.target.value })}>
          <option value="">Any state</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Hostel or day scholar">
        <div className="flex flex-wrap gap-2">
          {RESIDENCE.map((r) => (
            <Chip key={r} on={f.residence === r} onClick={() => set({ residence: f.residence === r ? null : r })}>
              {r}
            </Chip>
          ))}
        </div>
      </Section>
    </div>
  );
}
