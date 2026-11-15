"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, TextField, Icon, FOCUS_RING } from "../../ui/primitives";
import { InlineError, Skeleton } from "../../ui/states";
import { flowsApi } from "../../lib/mock-api";

const MAX_LEN = 30;

/**
 * "Flow Category" picker: search the categories, pick one (radio buttons, so arrow keys work),
 * or create a new one inline. Loads its own list, with loading and error + retry.
 */
export function CategoryPicker({ value, onChange, error, onCreated }: {
  value: string; onChange: (v: string) => void; error?: string; onCreated?: (name: string) => void;
}) {
  const [cats, setCats] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const wasAdding = useRef(false);
  const focusAfter = useRef<"button" | "radio" | null>(null);

  // keyboard focus follows the inline form: into it when it opens, back out when it closes
  useEffect(() => {
    if (adding) { document.getElementById("flow-category-new")?.focus(); wasAdding.current = true; return; }
    if (!wasAdding.current) return;
    wasAdding.current = false;
    const to = focusAfter.current; focusAfter.current = null;
    if (to === "radio") document.querySelector<HTMLElement>("input[name=flow-category]:checked")?.focus();
    else document.getElementById("flow-category-add")?.focus();
  }, [adding]);

  const load = useCallback(() => {
    setCats(null); setLoadError(null);
    flowsApi.categories().then(setCats).catch((e: unknown) => setLoadError(e instanceof Error && e.message ? e.message : "We could not load categories."));
  }, []);
  useEffect(load, [load]);

  const shown = (cats ?? []).filter((c) => c.toLowerCase().includes(query.trim().toLowerCase()));

  const startAdding = () => { setAdding(true); setNewName(query.trim()); setNewError(null); };
  const add = async () => {
    const n = newName.trim();
    if (!n) { setNewError("Field is required."); return; }
    if (n.length > MAX_LEN) { setNewError(`Use up to ${MAX_LEN} characters.`); return; }
    setSaving(true); setNewError(null);
    try {
      const saved = await flowsApi.addCategory(n);
      setCats((c) => [...(c ?? []), saved]);
      onChange(saved); onCreated?.(saved);
      focusAfter.current = "radio"; setAdding(false); setNewName(""); setQuery("");
    } catch (e) {
      setNewError(e instanceof Error && e.message ? e.message : "We could not add the category.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="grid gap-2" aria-describedby={error ? "flow-category-error" : undefined}>
      <legend className="mb-1.5 font-body text-sm font-semibold text-heading">
        Flow Category<span className="text-[#f87171]" aria-hidden> *</span><span className="sr-only"> (required)</span>
      </legend>

      {loadError ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
          <InlineError>{loadError}</InlineError>
          <Button size="sm" touch icon="refresh" onClick={load}>Try again</Button>
        </div>
      ) : cats === null ? (
        <div className="space-y-2" aria-busy><span className="sr-only">Loading categories…</span><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : (
        <>
          <TextField id="flow-category-search" touch ariaLabel="Search categories" placeholder="Search categories" value={query} onChange={setQuery} />
          <div className={`max-h-52 overflow-y-auto rounded-lg border p-1 ${error ? "border-[#f87171]" : "border-border"}`}>
            {shown.length === 0 ? (
              <p className="px-3 py-2.5 font-body text-sm text-muted">No category matches “{query.trim()}”.</p>
            ) : shown.map((c) => (
              <label key={c}
                className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-3 py-2 font-body text-sm focus-within:outline focus-within:outline-2 focus-within:outline-accent-soft ${value === c ? "bg-surface-warm text-heading" : "text-foreground hover:bg-surface-warm/40"}`}>
                <input type="radio" name="flow-category" value={c} checked={value === c} onChange={() => onChange(c)} className="h-4 w-4 accent-[#8A18FF]" />
                {c}
              </label>
            ))}
          </div>

          {adding ? (
            <div className="grid gap-1.5 rounded-lg border border-border bg-background p-3">
              <label htmlFor="flow-category-new" className="font-body text-sm font-semibold text-heading">New category name</label>
              <div className="flex gap-2" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}>
                <div className="min-w-0 flex-1">
                  <TextField id="flow-category-new" touch placeholder="e.g. Scholarships" maxLength={MAX_LEN} value={newName}
                    invalid={!!newError} describedBy={newError ? "flow-category-new-error" : undefined}
                    onChange={(v) => { setNewName(v); if (newError) setNewError(null); }} />
                </div>
                <Button touch variant="solid" disabled={saving} onClick={add}>{saving ? "Adding…" : "Add"}</Button>
                <Button touch variant="ghost" disabled={saving} onClick={() => { focusAfter.current = "button"; setAdding(false); }}>Cancel</Button>
              </div>
              {newError && <InlineError id="flow-category-new-error">{newError}</InlineError>}
            </div>
          ) : (
            <button type="button" id="flow-category-add" onClick={startAdding}
              className={`inline-flex min-h-[44px] items-center gap-1.5 justify-self-start rounded font-body text-sm font-semibold text-accent-soft hover:underline sm:min-h-0 ${FOCUS_RING}`}>
              <Icon name="plus" className="h-3.5 w-3.5" /> Create new category
            </button>
          )}
        </>
      )}
      {error && <InlineError id="flow-category-error">{error}</InlineError>}
    </fieldset>
  );
}
