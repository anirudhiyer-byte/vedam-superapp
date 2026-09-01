"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function ProjectSubmission({ registrationId, points, alreadyUrl }: { registrationId: string; points: number; alreadyUrl: string | null }) {
  const [supabase] = useState(() => createClient());
  const [url, setUrl] = useState("");
  const [rating, setRating] = useState(0);
  const [done, setDone] = useState<boolean>(!!alreadyUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!/github\.com\//i.test(url)) return setErr("Enter a valid public GitHub repo URL.");
    if (rating < 1) return setErr("Please rate the masterclass.");
    setBusy(true);
    const { data } = await supabase.rpc("submit_project", { p_registration_id: registrationId, p_github_url: url.trim(), p_rating: rating });
    const r = data as { ok?: boolean; already?: boolean; error?: string };
    setBusy(false);
    if (r?.error) return setErr(r.error);
    setDone(true);
  }

  if (done) return (
    <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#b7e4c7] bg-[#eafaf0] px-4 py-3 font-body text-sm font-semibold text-[#1a7f4b]">✓ Project submitted — thank you!</div>
  );

  return (
    <div className="mt-3 rounded-xl border border-dashed border-border-strong bg-surface-warm/40 p-4">
      <h3 className="font-display text-sm font-bold text-heading">Submit your project {points > 0 && <span className="font-mono text-xs font-normal text-primary">· +{points} pts</span>}</h3>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/you/project" className="mt-2 w-full rounded-lg border border-border-strong bg-background px-3 py-2 font-mono text-xs text-foreground outline-none" />
      <div className="mt-2 rounded-lg border border-[#ffe0c2] bg-[#fff6ec] px-3 py-2 font-body text-xs text-[#7a5a2a]">⚠️ Make sure the repo is <b>public</b> so our team can access it.</div>
      <div className="mt-3 font-body text-xs font-semibold text-foreground">Rate this masterclass <span className="text-red-500">*</span></div>
      <div className="mt-1 flex gap-1 text-2xl">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRating(n)} className={n <= rating ? "text-[#F5C542]" : "text-border-strong"}>★</button>)}
      </div>
      {err && <p className="mt-2 font-body text-xs text-red-500">{err}</p>}
      <button onClick={submit} disabled={busy} className="mt-3 w-full rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{busy ? "Submitting…" : "Submit project"}</button>
    </div>
  );
}
