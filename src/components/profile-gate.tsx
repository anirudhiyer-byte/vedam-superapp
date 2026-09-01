"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { INDIA_STATES, STATE_CITIES } from "@/lib/india-cities";

/**
 * Hard, inescapable profile gate. If a signed-in user is missing state OR city,
 * a modal blocks the whole app on every page until both are filled. No close,
 * no dismiss, no escape — it only clears when saved.
 */
export function ProfileGate() {
  const [supabase] = useState(() => createClient());
  const [needs, setNeeds] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const u = session?.user;
      if (!u) { if (active) setNeeds(false); return; }
      const { data: p } = await supabase.from("profiles").select("state, city").eq("id", u.id).maybeSingle();
      if (!active) return;
      setUid(u.id);
      setNeeds(!(p?.state && p?.city));
    })();
    // re-check when auth changes (login/logout)
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      if (!s?.user) { setNeeds(false); return; }
      const { data: p } = await supabase.from("profiles").select("state, city").eq("id", s.user.id).maybeSingle();
      setUid(s.user.id); setNeeds(!(p?.state && p?.city));
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [supabase]);

  // lock body scroll while the gate is up
  useEffect(() => {
    if (needs) { const prev = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = prev; }; }
  }, [needs]);

  if (!needs) return null;

  async function save() {
    setErr(null);
    if (!state) return setErr("Please select your state.");
    if (!city) return setErr("Please select your city.");
    if (!uid) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ state, city }).eq("id", uid);
    setBusy(false);
    if (error) return setErr("Couldn't save — please try again.");
    setNeeds(false);
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[rgba(20,10,45,.7)] p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-surface p-7 shadow-[0_40px_90px_-30px_rgba(43,19,92,.7)]">
        <div className="text-3xl">📍</div>
        <h2 className="mt-2 font-display text-2xl font-extrabold text-heading">Complete your profile</h2>
        <p className="mt-1.5 font-body text-sm text-muted">Tell us where you&apos;re from to continue — you&apos;ll show up on your state&apos;s leaderboard and see more relevant events. This is required.</p>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block font-body text-xs font-semibold text-foreground">State / UT</label>
            <SearchableSelect options={INDIA_STATES} value={state} onChange={(v) => { setState(v); setCity(""); }} placeholder="Select state…" />
          </div>
          <div>
            <label className="mb-1.5 block font-body text-xs font-semibold text-foreground">City</label>
            <SearchableSelect options={state ? (STATE_CITIES[state] ?? []) : []} value={city} onChange={setCity} placeholder={state ? "Search city…" : "Pick a state first"} disabled={!state} />
          </div>
        </div>
        {err && <p className="mt-3 font-body text-sm text-red-500">{err}</p>}
        <button onClick={save} disabled={busy} className="mt-5 w-full rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save & continue"}</button>
      </div>
    </div>
  );
}
