"use client";
import { useEffect, useRef, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { STATE_CITIES } from "@/lib/india-cities";

const OTHER = "Other — type your city";

/**
 * City picker with an exhaustive, state-scoped list (india-cities.ts) plus an
 * "Other" escape hatch so a town that isn't listed never blocks anyone. When the
 * user picks "Other" we show a free-text box; the typed value is stored as-is.
 * `inputClassName` lets a caller match its own theme (defaults to the shared tokens).
 */
export function CitySelect({
  state, value, onChange, disabled = false, invalid = false, placeholder, inputClassName,
}: {
  state: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  inputClassName?: string;
}) {
  const cities = state ? (STATE_CITIES[state] ?? []) : [];
  // "manual" = the user is typing an Other value (or a prefilled value isn't in the list)
  const [manual, setManual] = useState(() => !!value && !cities.includes(value));
  const prevState = useRef(state);
  useEffect(() => {
    // when the selected state changes, drop back to the list for the new state
    if (prevState.current !== state) { prevState.current = state; setManual(false); }
  }, [state]);

  const inputCls =
    inputClassName ??
    "w-full rounded-lg border border-border-strong bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))] disabled:opacity-50";

  if (manual) {
    return (
      <div className="space-y-1.5">
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your city / town"
          className={`${inputCls} ${invalid ? "border-[#d14343]" : ""}`}
          autoFocus
        />
        <button
          type="button"
          onClick={() => { setManual(false); onChange(""); }}
          className="text-xs font-medium text-accent hover:underline"
        >
          ← choose from the list
        </button>
      </div>
    );
  }

  return (
    <SearchableSelect
      options={[...cities, OTHER]}
      value={value}
      disabled={disabled}
      placeholder={placeholder ?? (state ? "Select city…" : "Pick a state first")}
      onChange={(v) => { if (v === OTHER) { setManual(true); onChange(""); } else onChange(v); }}
    />
  );
}
