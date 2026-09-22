"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

function Box({ registrationId, kind, points, already, label }: { registrationId: string; kind: "participation" | "podium"; points: number; already: string | null; label: string }) {
  const [supabase] = useState(() => createClient());
  const [url, setUrl] = useState(""); const [done, setDone] = useState(!!already); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit() {
    setErr(null);
    if (!/linkedin\.com\//i.test(url)) return setErr("Enter a valid LinkedIn post URL.");
    setBusy(true);
    const { data } = await supabase.rpc("submit_linkedin_kind", { p_registration_id: registrationId, p_url: url.trim(), p_kind: kind });
    setBusy(false);
    const r = data as { ok?: boolean; already?: boolean; error?: string } | null;
    if (r?.error) return setErr(r.error);
    setDone(true);
  }
  if (done) return <div className="rounded-xl border border-[#34c759]/30 bg-[#34c759]/10 p-3 text-sm text-[#8ff0ab]">✓ {label} shared{points > 0 ? ` — +${points} pts` : ""}</div>;
  return (
    <div className="rounded-xl border border-white/12 bg-white/[0.04] p-3">
      <div className="font-body text-sm font-semibold text-white">{label}{points > 0 ? <span className="ml-1 text-xs font-normal text-[#F97D03]">+{points} pts</span> : null}</div>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/posts/…" className="mt-2 w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none [color-scheme:dark]" />
      {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
      <button onClick={submit} disabled={busy} className="mt-2 rounded-lg bg-brand-gradient px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">{busy ? "Submitting…" : "Submit"}</button>
    </div>
  );
}

export function LinkedinSubmission({ registrationId, isWinner, participationPoints, podiumPoints, alreadyParticipation, alreadyPodium }: { registrationId: string; isWinner: boolean; participationPoints: number; podiumPoints: number; alreadyParticipation: string | null; alreadyPodium: string | null }) {
  return (
    <div className="space-y-3">
      <Box registrationId={registrationId} kind="participation" points={participationPoints} already={alreadyParticipation} label="Share your participation certificate on LinkedIn" />
      {isWinner && <Box registrationId={registrationId} kind="podium" points={podiumPoints} already={alreadyPodium} label="Share your podium finish on LinkedIn 🏆" />}
    </div>
  );
}
