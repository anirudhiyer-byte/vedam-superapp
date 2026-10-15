"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ types */
type QOption = { key: string; text: string };
type Paper = {
  id: string; exam: string; subject: string; year: number; set_label: string | null;
  title: string; duration_mins: number; marks_correct: number; marks_wrong: number; total_questions: number;
};
type Question = {
  id: string; q_no: number; topic: string | null; qtype: "mcq" | "numeric";
  stem: string; options: QOption[]; marks_correct: number; marks_wrong: number;
};
type Reveal = { correct_key: string | null; solution: string | null; is_correct: boolean | null };
type AnswerState = {
  selected_key: string | null; marked_for_later: boolean; revealed: boolean; reveal?: Reveal;
};
type TopicStat = { topic: string; correct: number; attempted: number; total: number; pct: number };
type ReviewItem = {
  id: string; q_no: number; topic: string | null; stem: string; options: QOption[];
  correct_key: string | null; solution: string | null; selected_key: string | null;
  marked_for_later: boolean; is_correct: boolean | null; awarded: number;
};
type ResultData = {
  summary: { score: number; max_score: number; correct: number; wrong: number; unattempted: number; attempted: number; accuracy: number; duration_secs: number | null };
  topic_breakdown: TopicStat[]; review: ReviewItem[]; paper?: Paper | null;
};

type Phase = "loading" | "signin" | "picker" | "starting" | "test" | "submitting" | "result";

/* --------------------------------------------------------------- helpers */
const EXAM_ORDER = ["JEE Main", "WBJEE", "MHT-CET", "Board"];
function barColor(pct: number) { return pct >= 67 ? "#22c55e" : pct >= 34 ? "#f59e0b" : "#ef4444"; }
function fmtClock(s: number) { const m = Math.floor(s / 60), r = s % 60; return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`; }
async function jpost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j?.error || "Request failed"); return j as T;
}

/* =================================================================== app */
export function PyqApp() {
  const [supabase] = useState(() => createClient());
  const [phase, setPhase] = useState<Phase>("loading");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [err, setErr] = useState("");

  // active attempt
  const [attemptId, setAttemptId] = useState<string>("");
  const [paper, setPaper] = useState<Paper | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [i, setI] = useState(0);
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState<ResultData | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---- bootstrap: require session, then load catalogue ---- */
  useEffect(() => {
    let on = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!on) return;
      if (!session?.user) { setPhase("signin"); return; }
      try {
        const r = await fetch("/api/pyq/papers");
        const j = await r.json();
        if (!on) return;
        if (!r.ok) throw new Error(j?.error || "Could not load papers");
        setPapers(j.papers as Paper[]);
        setPhase("picker");
      } catch (e) { if (on) { setErr((e as Error).message); setPhase("picker"); } }
    })();
    return () => { on = false; };
  }, [supabase]);

  /* ---- timer ---- */
  const stopTimer = useCallback(() => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } }, []);
  const submit = useCallback(async () => {
    stopTimer();
    setPhase("submitting");
    try {
      const spent = paper ? paper.duration_mins * 60 - secs : undefined;
      const j = await jpost<ResultData>("/api/pyq/attempt/submit", { attempt_id: attemptId, duration_secs: spent });
      setResult(j); setPhase("result");
    } catch (e) { setErr((e as Error).message); setPhase("test"); }
  }, [attemptId, paper, secs, stopTimer]);

  useEffect(() => {
    if (phase !== "test") return;
    timerRef.current = setInterval(() => {
      setSecs((s) => { if (s <= 1) { return 0; } return s - 1; });
    }, 1000);
    return stopTimer;
  }, [phase, stopTimer]);
  useEffect(() => { if (phase === "test" && secs === 0 && paper) void submit(); }, [secs, phase, paper, submit]);

  /* ---- start an attempt ---- */
  async function startPaper(p: Paper) {
    setErr(""); setPhase("starting");
    try {
      const j = await jpost<{ attempt_id: string; paper: Paper; questions: Question[]; answers: Array<{ question_id: string; selected_key: string | null; marked_for_later: boolean; revealed: boolean; correct_key: string | null; solution: string | null; is_correct: boolean | null }> }>(
        "/api/pyq/attempt/start", { paper_id: p.id });
      const amap: Record<string, AnswerState> = {};
      for (const a of j.answers ?? []) {
        amap[a.question_id] = {
          selected_key: a.selected_key, marked_for_later: a.marked_for_later, revealed: a.revealed,
          reveal: a.selected_key != null ? { correct_key: a.correct_key, solution: a.solution, is_correct: a.is_correct } : undefined,
        };
      }
      setAttemptId(j.attempt_id); setPaper(j.paper); setQuestions(j.questions);
      setAnswers(amap); setI(0); setSecs(j.paper.duration_mins * 60); setResult(null);
      setPhase("test");
    } catch (e) { setErr((e as Error).message); setPhase("picker"); }
  }

  /* ---- answer interactions ---- */
  function patch(qid: string, next: Partial<AnswerState>) {
    setAnswers((prev) => {
      const base: AnswerState = prev[qid] ?? { selected_key: null, marked_for_later: false, revealed: false };
      return { ...prev, [qid]: { ...base, ...next } };
    });
  }
  async function choose(qid: string, key: string) {
    patch(qid, { selected_key: key });
    try {
      const j = await jpost<{ reveal: Reveal | null }>("/api/pyq/attempt/answer", { attempt_id: attemptId, question_id: qid, selected_key: key });
      if (j.reveal) patch(qid, { reveal: j.reveal });
    } catch { /* keep local selection; will be re-graded on submit */ }
  }
  async function toggleMark(qid: string) {
    const nextMark = !(answers[qid]?.marked_for_later);
    patch(qid, { marked_for_later: nextMark });
    try { await jpost("/api/pyq/attempt/answer", { attempt_id: attemptId, question_id: qid, marked_for_later: nextMark }); } catch { /* best effort */ }
  }
  async function toggleReveal(qid: string) {
    const willReveal = !(answers[qid]?.revealed);
    patch(qid, { revealed: willReveal });
    if (willReveal) { try { await jpost("/api/pyq/attempt/answer", { attempt_id: attemptId, question_id: qid, reveal: true }); } catch { /* best effort */ } }
  }

  /* ----------------------------------------------------------- renders */
  if (phase === "loading" || phase === "starting" || phase === "submitting") {
    const label = phase === "submitting" ? "Scoring your attempt…" : phase === "starting" ? "Loading your paper…" : "Loading…";
    return <Shell><div className="grid min-h-[50vh] place-items-center text-white/60">{label}</div></Shell>;
  }
  if (phase === "signin") {
    return <Shell><Centered>
      <h1 className="text-2xl font-semibold">Sign in to practice</h1>
      <p className="mt-2 text-white/60">PYQ Practice is part of your Vedam One account.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/login" className="rounded-full border border-white/15 px-5 py-2 text-sm font-medium hover:bg-white/5">Sign in</Link>
        <Link href="/register" className="rounded-full bg-[#7629fc] px-5 py-2 text-sm font-semibold hover:bg-[#8a3dff]">Register</Link>
      </div>
    </Centered></Shell>;
  }
  if (phase === "picker") return <Shell><Picker papers={papers} err={err} onStart={startPaper} /></Shell>;
  if (phase === "result" && result) return <Shell><Result data={result} paper={paper} onDone={() => { setPhase("picker"); }} /></Shell>;
  if (phase === "test" && paper) {
    return <Shell wide><Runner
      paper={paper} questions={questions} answers={answers} i={i} secs={secs} err={err}
      setI={setI} choose={choose} toggleMark={toggleMark} toggleReveal={toggleReveal} onSubmit={submit}
    /></Shell>;
  }
  return <Shell><Centered><p className="text-white/60">Something went wrong. Please reload.</p></Centered></Shell>;
}

/* ============================================================== layout */
function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-black px-5 pb-24 pt-10 text-white sm:px-8">
      <div className={`mx-auto ${wide ? "max-w-6xl" : "max-w-5xl"}`}>{children}</div>
    </div>
  );
}
function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-[50vh] place-items-center text-center">{children}</div>;
}

/* ============================================================== picker */
function Picker({ papers, err, onStart }: { papers: Paper[]; err: string; onStart: (p: Paper) => void }) {
  const byExam = useMemo(() => {
    const m = new Map<string, Paper[]>();
    for (const p of papers) { if (!m.has(p.exam)) m.set(p.exam, []); m.get(p.exam)!.push(p); }
    return Array.from(m.entries()).sort((a, b) => {
      const ia = EXAM_ORDER.indexOf(a[0]), ib = EXAM_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [papers]);

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b48bff]">PYQ Practice</p>
      <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Previous-year papers</h1>
      <p className="mt-2 max-w-2xl text-white/60">Attempt real exam papers in a timed interface. You get +4 for a correct answer, −1 for a wrong one, and instant topic-wise analysis at the end.</p>
      {err && <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{err}</p>}

      {byExam.length === 0 && <p className="mt-10 text-white/50">No papers are published yet.</p>}

      <div className="mt-8 space-y-10">
        {byExam.map(([exam, list]) => (
          <section key={exam}>
            <h2 className="mb-3 text-lg font-semibold text-white/90">{exam}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((p) => (
                <button key={p.id} onClick={() => onStart(p)}
                  className="group rounded-2xl border border-white/10 bg-[#140a2b] p-5 text-left transition-all hover:-translate-y-0.5 hover:border-[#7629fc]/60 hover:shadow-[0_0_28px_rgba(118,41,252,0.25)]">
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <span className="rounded-full bg-[#7629fc]/20 px-2 py-0.5 font-medium text-[#c4a4ff]">{p.subject}</span>
                    <span>{p.year}</span>
                  </div>
                  <div className="mt-2 font-semibold leading-snug">{p.set_label ?? p.title}</div>
                  <div className="mt-3 flex items-center justify-between text-xs text-white/55">
                    <span>{p.total_questions} questions</span><span>{p.duration_mins} min</span>
                  </div>
                  <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[#b48bff] group-hover:text-white">Start practicing →</div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ============================================================== runner */
function Runner({ paper, questions, answers, i, secs, err, setI, choose, toggleMark, toggleReveal, onSubmit }: {
  paper: Paper; questions: Question[]; answers: Record<string, AnswerState>; i: number; secs: number; err: string;
  setI: (n: number) => void; choose: (qid: string, key: string) => void; toggleMark: (qid: string) => void;
  toggleReveal: (qid: string) => void; onSubmit: () => void;
}) {
  const q = questions[i];
  const a = q ? answers[q.id] : undefined;
  const answered = !!a?.selected_key;
  const revealed = !!a?.revealed && !!a?.reveal;
  const low = secs <= 60;
  const answeredCount = questions.filter((qq) => answers[qq.id]?.selected_key).length;

  if (!q) return <Centered><p className="text-white/60">This paper has no questions.</p></Centered>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      {/* main */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-white/45">{paper.exam} · {paper.subject} · {paper.year}</div>
            <div className="text-sm text-white/70">{paper.set_label}</div>
          </div>
          <div className={`rounded-full border px-4 py-1.5 font-mono text-sm ${low ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-white/15 bg-white/5 text-white/80"}`}>
            ⏱ {fmtClock(secs)}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-[#120a28] p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[#b48bff]">Question {q.q_no}</span>
            {q.topic && <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs text-white/55">{q.topic}</span>}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">{q.stem}</p>

          <div className="mt-5 space-y-2.5">
            {q.options.map((o) => {
              const sel = a?.selected_key === o.key;
              const isCorrect = revealed && a?.reveal?.correct_key === o.key;
              const isWrongPick = revealed && sel && a?.reveal?.correct_key !== o.key;
              const base = "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all";
              const cls = isCorrect ? "border-green-500/60 bg-green-500/10"
                : isWrongPick ? "border-red-500/60 bg-red-500/10"
                : sel ? "border-[#7629fc] bg-[#7629fc]/15"
                : "border-white/10 bg-white/[0.03] hover:border-white/25";
              return (
                <button key={o.key} onClick={() => choose(q.id, o.key)} className={`${base} ${cls}`}>
                  <span className={`grid h-7 w-7 flex-none place-items-center rounded-full border text-xs font-semibold ${sel || isCorrect ? "border-transparent bg-white/90 text-black" : "border-white/20 text-white/70"}`}>{o.key}</span>
                  <span className="text-white/90">{o.text}</span>
                  {isCorrect && <span className="ml-auto text-xs font-medium text-green-400">✓ correct</span>}
                  {isWrongPick && <span className="ml-auto text-xs font-medium text-red-400">✗ your answer</span>}
                </button>
              );
            })}
          </div>

          {/* reveal / hint */}
          <div className="mt-4">
            {answered ? (
              <button onClick={() => toggleReveal(q.id)} className="rounded-full border border-white/15 px-4 py-1.5 text-sm font-medium text-white/85 hover:bg-white/5">
                {revealed ? "Hide result" : "Show result"}
              </button>
            ) : (
              <p className="text-xs text-white/40">Select an option to enable “Show result”.</p>
            )}
            {revealed && a?.reveal?.solution && (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-4 text-sm leading-relaxed text-white/75">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#b48bff]">Solution</div>
                <p className="whitespace-pre-wrap">{a.reveal.solution}</p>
              </div>
            )}
          </div>
        </div>

        {err && <p className="mt-3 text-sm text-red-300">{err}</p>}

        {/* controls */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white/85 enabled:hover:bg-white/5 disabled:opacity-40">← Back</button>
          <button onClick={() => toggleMark(q.id)}
            className={`rounded-full border px-4 py-2 text-sm font-medium ${a?.marked_for_later ? "border-amber-400/60 bg-amber-400/15 text-amber-300" : "border-white/15 text-white/85 hover:bg-white/5"}`}>
            {a?.marked_for_later ? "★ Marked for later" : "☆ Mark for later"}
          </button>
          {i < questions.length - 1 ? (
            <button onClick={() => setI(Math.min(questions.length - 1, i + 1))}
              className="ml-auto rounded-full bg-[#7629fc] px-5 py-2 text-sm font-semibold hover:bg-[#8a3dff]">Save &amp; Next →</button>
          ) : (
            <button onClick={onSubmit} className="ml-auto rounded-full bg-green-600 px-5 py-2 text-sm font-semibold hover:bg-green-500">Submit test</button>
          )}
        </div>
      </div>

      {/* palette */}
      <aside className="h-max rounded-2xl border border-white/10 bg-[#120a28] p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">Questions</span>
          <span className="text-white/50">{answeredCount}/{questions.length}</span>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-2">
          {questions.map((qq, idx) => {
            const st = answers[qq.id];
            const cur = idx === i;
            const done = !!st?.selected_key;
            const mark = !!st?.marked_for_later;
            const bg = cur ? "bg-white text-black" : mark ? "bg-amber-400/20 text-amber-200 border border-amber-400/40" : done ? "bg-green-500/20 text-green-200 border border-green-500/40" : "bg-white/5 text-white/60 border border-white/10";
            return <button key={qq.id} onClick={() => setI(idx)} className={`h-9 rounded-lg text-sm font-medium ${bg}`}>{qq.q_no}</button>;
          })}
        </div>
        <div className="mt-4 space-y-1.5 text-xs text-white/50">
          <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded bg-green-500/40" /> Answered</div>
          <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded bg-amber-400/40" /> Marked for later</div>
          <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded bg-white/10" /> Not answered</div>
        </div>
        <button onClick={onSubmit} className="mt-5 w-full rounded-full border border-green-500/40 bg-green-600/20 py-2 text-sm font-semibold text-green-200 hover:bg-green-600/30">Submit test</button>
      </aside>
    </div>
  );
}

/* ============================================================== result */
function Result({ data, paper, onDone }: { data: ResultData; paper: Paper | null; onDone: () => void }) {
  const s = data.summary;
  const p = data.paper ?? paper;
  const mins = s.duration_secs != null ? Math.floor(s.duration_secs / 60) : null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b48bff]">Result</p>
      <h1 className="mt-2 text-3xl font-semibold">{p ? `${p.exam} · ${p.subject} · ${p.year}` : "Your attempt"}</h1>
      {p?.set_label && <p className="text-white/60">{p.set_label}</p>}

      {/* score cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Score" value={`${s.score} / ${s.max_score}`} accent="#7629fc" />
        <Stat label="Accuracy" value={`${s.accuracy}%`} accent="#22c55e" />
        <Stat label="Correct · Wrong" value={`${s.correct} · ${s.wrong}`} accent="#f59e0b" />
        <Stat label="Unattempted" value={`${s.unattempted}`} sub={mins != null ? `Time: ${mins} min` : undefined} accent="#64748b" />
      </div>

      {/* topic analysis */}
      {data.topic_breakdown.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold">Topic-wise analysis</h2>
          <div className="space-y-3">
            {data.topic_breakdown.map((t) => (
              <div key={t.topic}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-white/80">{t.topic}</span>
                  <span className="text-white/50">{t.correct}/{t.total} · {t.pct}%</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/8">
                  <div className="h-full rounded-full transition-all" style={{ width: `${t.pct}%`, background: barColor(t.pct) }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-white/40">Green ≥ 67% (strong) · Amber 34–66% · Red &lt; 34% (needs work).</p>
        </section>
      )}

      {/* question review */}
      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold">Question-wise review</h2>
        <div className="space-y-4">
          {data.review.map((r) => {
            const correct = r.is_correct === true;
            const wrong = r.is_correct === false;
            const tag = correct ? { t: "Correct", c: "text-green-400" } : wrong ? { t: "Wrong", c: "text-red-400" } : { t: "Skipped", c: "text-white/40" };
            return (
              <div key={r.id} className="rounded-2xl border border-white/10 bg-[#120a28] p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#b48bff]">Q{r.q_no}{r.topic ? ` · ${r.topic}` : ""}</span>
                  <span className={`text-xs font-semibold ${tag.c}`}>{tag.t} {r.is_correct != null ? `(${r.awarded > 0 ? "+" : ""}${r.awarded})` : ""}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/90">{r.stem}</p>
                <div className="mt-3 space-y-1.5">
                  {r.options.map((o) => {
                    const isCorrect = r.correct_key === o.key;
                    const isYour = r.selected_key === o.key;
                    const cls = isCorrect ? "border-green-500/50 bg-green-500/10" : isYour ? "border-red-500/50 bg-red-500/10" : "border-white/10";
                    return (
                      <div key={o.key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
                        <span className="font-semibold text-white/60">{o.key}</span><span className="text-white/85">{o.text}</span>
                        {isCorrect && <span className="ml-auto text-xs text-green-400">correct</span>}
                        {isYour && !isCorrect && <span className="ml-auto text-xs text-red-400">your answer</span>}
                      </div>
                    );
                  })}
                </div>
                {r.solution && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3 text-sm leading-relaxed text-white/70">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[#b48bff]">Solution</span>
                    <p className="mt-1 whitespace-pre-wrap">{r.solution}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-8">
        <button onClick={onDone} className="rounded-full bg-[#7629fc] px-6 py-2.5 text-sm font-semibold hover:bg-[#8a3dff]">← Back to papers</button>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#120a28] p-5">
      <div className="text-xs uppercase tracking-wide text-white/45">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: accent }}>{value}</div>
      {sub && <div className="mt-1 text-xs text-white/40">{sub}</div>}
    </div>
  );
}
