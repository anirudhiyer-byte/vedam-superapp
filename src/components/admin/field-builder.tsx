"use client";

import { type EventField, FIELD_TYPES, NEEDS_OPTIONS } from "@/lib/events";

const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";
const mini = "rounded-md border border-border px-2 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40";

export function FieldBuilder({
  value, onChange, addLabel = "Add a question",
}: {
  value: EventField[];
  onChange: (v: EventField[]) => void;
  addLabel?: string;
}) {
  const fields = value || [];
  const upd = (i: number, patch: Partial<EventField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const next = fields.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const del = (i: number) => onChange(fields.filter((_, j) => j !== i));
  const add = () => onChange([...fields, { key: "", label: "", type: "text", required: false, options: [], placeholder: "" }]);

  return (
    <div className="space-y-3">
      {fields.map((f, i) => (
        <div key={i} className="rounded-xl border border-border bg-background p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block font-body text-xs font-semibold text-foreground">Question / label</span>
              <input className={input} value={f.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="e.g. Permanent location (city)" />
            </label>
            <label className="block">
              <span className="mb-1 block font-body text-xs font-semibold text-foreground">Type</span>
              <select className={input} value={f.type} onChange={(e) => upd(i, { type: e.target.value as EventField["type"] })}>
                {FIELD_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </label>
          </div>

          {NEEDS_OPTIONS(f.type) && (
            <label className="mt-3 block">
              <span className="mb-1 block font-body text-xs font-semibold text-foreground">Options (one per line)</span>
              <textarea className={input} rows={3} value={(f.options || []).join("\n")}
                onChange={(e) => upd(i, { options: e.target.value.split("\n") })} placeholder={"Option 1\nOption 2"} />
            </label>
          )}
          {!NEEDS_OPTIONS(f.type) && f.type !== "checkbox" && (
            <label className="mt-3 block">
              <span className="mb-1 block font-body text-xs font-semibold text-foreground">Placeholder (optional)</span>
              <input className={input} value={f.placeholder || ""} onChange={(e) => upd(i, { placeholder: e.target.value })} placeholder="Hint text shown in the box" />
            </label>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 font-body text-xs font-semibold text-foreground">
              <input type="checkbox" checked={!!f.required} onChange={(e) => upd(i, { required: e.target.checked })} className="h-4 w-4 accent-[color:rgb(var(--accent))]" />
              Required
            </label>
            <div className="ml-auto flex gap-1.5">
              <button type="button" className={mini} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button type="button" className={mini} onClick={() => move(i, 1)} disabled={i === fields.length - 1}>↓</button>
              <button type="button" className="rounded-md border border-red-400/40 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-500/5" onClick={() => del(i)}>Delete</button>
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-warm" onClick={add}>+ {addLabel}</button>
    </div>
  );
}
