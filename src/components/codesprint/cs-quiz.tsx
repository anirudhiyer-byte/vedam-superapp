"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Q = { id: string; question: string; options: string[] };
type Result = { question: string; chosen: number; correct_index: number; is_correct: boolean; explanation: string | null };

export function CsQuiz({ moduleId, onComplete }: { moduleId: string; onComplete: (certId: string | null) => void }) {
  const [supabase] = useState(() => createClient());
  const [qs, setQs] = useState<Q[]>([]);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [phase, setPhase] = useState<"take" | "result">("take");
  const [res, setRes] = useState<{ score: number; total: number; passed: boolean; results: Result[]; cert_id: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { supabase.rpc("cs_get_quiz", { p_module_id: moduleId }).then(({ data }) => setQs((data as Q[]) ?? [])); }, [supabase, moduleId]);

  function choose(idx: number) { const a = [...answers]; a[i] = idx; setAnswers(a); }
  async function finish() {
    setBusy(true);
    const { data } = await supabase.rpc("cs_submit_quiz", { p_module_id: moduleId, p_answers: JSON.stringify(answers.map((x) => x ?? -1)) });
    setRes(data as typeof res); setPhase("result"); setBusy(false);
    if ((data as { module_complete?: boolean })?.module_complete) onComplete((data as { cert_id?: string }).cert_id ?? null);
  }
  function retry() { setAnswers([]); setI(0); setRes(null); setPhase("take"); }

  if (qs.length === 0) return null;

  if (phase === "result" && res) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className={["rounded-xl p-4 text-center", res.passed ? "border border-[#b7e4c7] bg-[#eafaf0] text-[#12703f]" : "border border-red-300 bg-red-50 text-red-600"].join(" ")}>
          <div className="text-2xl">{res.passed ? "🎉" : "😕"}</div>
          <div className="mt-1 font-display text-lg font-extrabold">{res.passed ? `Quiz passed — ${res.score}/${res.total}!` : `${res.score}/${res.total} — need 60% to pass`}</div>
          {res.passed && <div className="mt-0.5 font-body text-sm">Module complete · certificate unlocked</div>}
        </div>
        <div className="mt-4 space-y-3">
          {res.results.map((r, k) => (
            <div key={k} className="rounded-xl border border-border p-3">
              <p className="font-display text-sm font-semibold text-heading">{k + 1}. {r.question}</p>
              <p className={["mt-1 font-body text-xs", r.is_correct ? "text-[#12703f]" : "text-red-500"].join(" ")}>{r.is_correct ? "✓ Correct" : `✗ Your answer: ${qs[k]?.options[r.chosen] ?? "—"} · Correct: ${qs[k]?.options[r.correct_index] ?? ""}`}</p>
              {r.explanation && <p className="mt-1.5 border-l-2 border-accent bg-surface-warm/40 px-3 py-2 font-body text-xs text-muted">💡 {r.explanation}</p>}
            </div>
          ))}
        </div>
        {!res.passed && <button onClick={retry} className="mt-4 w-full rounded-xl bg-brand-gradient px-4 py-3 text-sm font-bold text-white">Retry quiz</button>}
      </div>
    );
  }

  const q = qs[i];
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between"><span className="font-mono text-xs font-semibold uppercase tracking-wide text-accent">Module quiz</span><span className="font-mono text-xs text-muted">Question {i + 1} of {qs.length}</span></div>
      <h3 className="mt-3 font-display text-lg font-bold text-heading">{q.question}</h3>
      <div className="mt-3 space-y-2">
        {q.options.map((o, idx) => (
          <button key={idx} onClick={() => choose(idx)} className={["block w-full rounded-xl border px-4 py-3 text-left font-body text-sm font-semibold transition-colors", answers[i] === idx ? "border-accent bg-surface-warm" : "border-border-strong hover:bg-surface-warm/50"].join(" ")}>{o}</button>
        ))}
      </div>
      <div className="mt-4 flex justify-between">
        <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted disabled:opacity-40">← Back</button>
        {i < qs.length - 1
          ? <button onClick={() => setI(i + 1)} disabled={answers[i] == null} className="rounded-lg bg-brand-gradient px-5 py-2 text-sm font-bold text-white disabled:opacity-50">Next →</button>
          : <button onClick={finish} disabled={busy || answers[i] == null} className="rounded-lg bg-brand-gradient px-5 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "Submitting…" : "Submit quiz"}</button>}
      </div>
      <p className="mt-3 font-body text-xs text-muted">Pass with 60%+ after the last lecture to complete the module. You can retry if needed.</p>
    </div>
  );
}
