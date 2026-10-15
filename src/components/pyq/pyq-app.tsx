"use client";

/* PYQ module — replicates the approved "PYQ Exam Prototype" + "PYQ Workflow
   Wireframe" journey inside the Vedam One shell.

   New user (logged out):   S1 Landing → S2 Create account → S4 Pick paper → S5 Attempt → S6 Result
   Returning (signed in):   S3 Dashboard → Resume / S4 Pick paper → S5 Attempt → S6 Result
                            (header "PYQ" lands signed-in users on S3 — skips S1 & S2)

   Deliberate differences from the static prototype, per later product decisions:
   no timer; answers are NOT locked (re-selectable) and "Show result" appears only
   once the question is attempted; marks follow each exam's real scheme; S2 is the
   real Vedam One signup (Part-1 OTP + Part-2 details), not a mock.

   URL is the source of truth so refresh / back work:
     /pyq                         → S3 (signed in) or S1 (logged out)
     /pyq?view=register&next=…    → S2
     /pyq?view=papers[&exam=…]    → S4
     /pyq?paper=<paperId>         → S5 (starts or resumes)
     /pyq?result=<attemptId>      → S6 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RegisterForm } from "@/components/register-form";

/* ------------------------------------------------------------------ types */
type QOption = { key: string; text: string };
type MyStatus = {
  in_progress_id: string | null;
  last: { attempt_id: string; score: number; max_score: number; submitted_at: string } | null;
} | null;
type Paper = {
  id: string; exam: string; subject: string; year: number; set_label: string | null; title: string;
  marks_correct: number; marks_wrong: number; marking_note: string | null; total_questions: number; my?: MyStatus;
};
type Question = {
  id: string; q_no: number; topic: string | null; qtype: "mcq" | "numeric";
  stem: string; options: QOption[]; marks_correct: number; marks_wrong: number;
};
type Reveal = { correct_key: string | null; solution: string | null; is_correct: boolean | null };
type AnswerState = { selected_key: string | null; marked_for_later: boolean; revealed: boolean; reveal?: Reveal };
type TopicStat = { topic: string; correct: number; attempted: number; total: number; pct: number };
type ReviewItem = {
  id: string; q_no: number; topic: string | null; stem: string; options: QOption[];
  correct_key: string | null; solution: string | null; selected_key: string | null;
  marked_for_later: boolean; is_correct: boolean | null; awarded: number;
};
type ResultData = {
  attempt_id?: string; paper?: Paper | null;
  summary: { score: number; max_score: number; correct: number; wrong: number; unattempted: number; attempted: number; accuracy: number; duration_secs: number | null };
  topic_breakdown: TopicStat[]; review: ReviewItem[];
};
type MeData = {
  name: string | null;
  in_progress: { attempt_id: string; paper: Paper; answered: number; total: number } | null;
  attempts: { attempt_id: string; paper: Paper; submitted_at: string; score: number; max_score: number }[];
  stats: { papers_attempted: number; avg_accuracy: number | null };
};
type Route =
  | { s: "landing" } | { s: "register" } | { s: "dashboard" }
  | { s: "picker"; exam?: string } | { s: "test"; paperId: string } | { s: "result"; attemptId: string };

/* ---------------------------------------------------------------- labels */
// Prototype order & naming: tiles "CBSE Boards · JEE Main · WBJEE · MH-CET", tabs "Boards · JEE · WBJEE · MH-CET".
const EXAM_ORDER = ["CBSE Class 12", "JEE Main", "WBJEE", "MHT-CET"];
const EXAM_TILE: Record<string, { title: string; sub: string }> = {
  "CBSE Class 12": { title: "CBSE Boards", sub: "Phy · Chem · Maths · CS" },
  "JEE Main": { title: "JEE Main", sub: "Year → Shift" },
  "WBJEE": { title: "WBJEE", sub: "All sets" },
  "MHT-CET": { title: "MH-CET", sub: "PCM / PCB" },
};
const EXAM_TAB: Record<string, string> = { "CBSE Class 12": "Boards", "JEE Main": "JEE", "WBJEE": "WBJEE", "MHT-CET": "MH-CET" };
const SET_WORD: Record<string, string> = { "CBSE Class 12": "Set", "JEE Main": "Shift", "WBJEE": "Set", "MHT-CET": "Shift" };
const DEFAULT_EXAM = "JEE Main";

const examTitle = (e: string) => EXAM_TILE[e]?.title ?? e;
const paperName = (p: Pick<Paper, "subject" | "year" | "set_label">) => `${p.subject} · ${p.year}${p.set_label ? ` · ${p.set_label}` : ""}`;
const fullPaperName = (p: Pick<Paper, "exam" | "subject" | "year" | "set_label">) => `${examTitle(p.exam)} · ${paperName(p)}`;

/* --------------------------------------------------------------- helpers */
function fmtNum(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}
const FRACTION: Record<string, string> = { "0.25": "¼", "0.5": "½", "0.75": "¾" };
const fmtMark = (n: number) => FRACTION[String(Math.abs(n))] ?? fmtNum(Math.abs(n));
function markLabel(correct: number | string, wrong: number | string) {
  const c = Number(correct), w = Number(wrong);
  return w === 0 ? `+${fmtMark(c)} · no negative` : `+${fmtMark(c)} / −${fmtMark(w)}`;
}
const paperMarking = (p: Paper) => p.marking_note ?? markLabel(p.marks_correct, p.marks_wrong);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const barColor = (pct: number) => (pct >= 67 ? "var(--ok)" : pct >= 34 ? "var(--orange)" : "var(--bad)");

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json(); if (!r.ok) throw new Error(j?.error || "Request failed"); return j as T;
}
async function jpost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j?.error || "Request failed"); return j as T;
}

/** S2 URL — the real RegisterForm reads `next` from the query and lands the user there after signup. */
const registerUrl = (back: string) => `/pyq?view=register&next=${encodeURIComponent(back)}`;

function parseRoute(signedIn: boolean): { route: Route; normalize?: string } {
  const q = new URLSearchParams(window.location.search);
  const here = window.location.pathname + window.location.search;
  const result = q.get("result");
  if (result) return signedIn ? { route: { s: "result", attemptId: result } } : { route: { s: "register" }, normalize: registerUrl(here) };
  const paper = q.get("paper");
  if (paper) return signedIn ? { route: { s: "test", paperId: paper } } : { route: { s: "register" }, normalize: registerUrl(here) };
  const view = q.get("view");
  if (view === "papers") return { route: { s: "picker", exam: q.get("exam") ?? undefined } };
  if (view === "register") {
    if (signedIn) return { route: { s: "dashboard" }, normalize: "/pyq" };
    return q.get("next") ? { route: { s: "register" } } : { route: { s: "register" }, normalize: registerUrl("/pyq?view=papers") };
  }
  return { route: signedIn ? { s: "dashboard" } : { s: "landing" } };
}

/* =================================================================== app */
export function PyqApp({ signedIn, firstName }: { signedIn: boolean; firstName: string }) {
  const [route, setRoute] = useState<Route | null>(null);
  const [papers, setPapers] = useState<Paper[] | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultCache = useRef<Record<string, ResultData>>({});

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 2200);
  }, []);

  const sync = useCallback(() => {
    const { route: r, normalize } = parseRoute(signedIn);
    if (normalize && normalize !== window.location.pathname + window.location.search) window.history.replaceState(null, "", normalize);
    setRoute(r);
  }, [signedIn]);

  const go = useCallback((url: string, replace = false) => {
    if (replace) window.history.replaceState(null, "", url); else window.history.pushState(null, "", url);
    sync();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [sync]);

  // Re-read the route whenever the query changes — covers our own pushState,
  // browser back/forward, AND Next <Link> navigations (e.g. clicking "PYQ" in
  // the Vedam One header while inside the module → back to S3 / S1).
  const searchParams = useSearchParams();
  useEffect(() => { sync(); }, [searchParams, sync]);
  useEffect(() => {
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [sync]);

  // Catalogue: needed by S1 (tile counts) and S4. Re-pulled on entering those
  // screens so per-paper status (Resume / Score) is always fresh.
  const loadPapers = useCallback(async () => {
    try { const j = await jget<{ papers: Paper[] }>("/api/pyq/papers"); setPapers(j.papers); }
    catch (e) { toast((e as Error).message); setPapers((p) => p ?? []); }
  }, [toast]);
  useEffect(() => { if (route && (route.s === "landing" || route.s === "picker")) void loadPapers(); }, [route, loadPapers]);

  let screen: React.ReactNode = <Loading />;
  if (route) {
    switch (route.s) {
      case "landing": screen = <Landing papers={papers} go={go} />; break;
      case "register": screen = <Register />; break;
      case "dashboard": screen = <Dashboard firstName={firstName} go={go} toast={toast} />; break;
      case "picker": screen = <Picker key={route.exam ?? "_"} papers={papers} initialExam={route.exam} signedIn={signedIn} go={go} />; break;
      case "test":
        screen = <Test key={route.paperId} paperId={route.paperId} go={go} toast={toast}
          onSubmitted={(id, data) => { resultCache.current[id] = data; go(`/pyq?result=${id}`, true); }} />;
        break;
      case "result": screen = <Result key={route.attemptId} attemptId={route.attemptId} cached={resultCache.current[route.attemptId]} go={go} toast={toast} />; break;
    }
  }

  return (
    <div className="pyq">
      <main className="wrap">{screen}</main>
      <div className={`toast ${toastMsg ? "show" : ""}`} role="status">{toastMsg}</div>
    </div>
  );
}

function Loading({ label = "Loading…" }: { label?: string }) {
  return <section className="screen"><div className="loading">{label}</div></section>;
}

/* ============================================================ S1 Landing */
function Landing({ papers, go }: { papers: Paper[] | null; go: (u: string) => void }) {
  const counts = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of EXAM_ORDER) {
      const list = (papers ?? []).filter((p) => p.exam === e);
      if (!papers) { m[e] = ""; continue; }
      if (e === "CBSE Class 12") { const n = new Set(list.map((p) => p.subject)).size; m[e] = `${n} subject${n === 1 ? "" : "s"}`; }
      else { const n = new Set(list.map((p) => p.year)).size; m[e] = n ? `${n} year${n === 1 ? "" : "s"}` : "Coming soon"; }
    }
    return m;
  }, [papers]);

  return (
    <section className="screen">
      <div className="hero">
        <div>
          <div className="eyebrow">Previous Year Questions</div>
          <h1>Attempt real <span className="k">PYQ papers</span> online, free.</h1>
          <p>Boards, JEE, WBJEE &amp; MH-CET — last 3 years, every set, with instant solutions and a weak-vs-strong analysis after each paper.</p>
          <div className="cta">
            <button className="btn primary" onClick={() => go(registerUrl("/pyq?view=papers"))}>Start practicing →</button>
            <button className="btn ghost" onClick={() => window.location.assign("/login?next=" + encodeURIComponent("/pyq"))}>I already have an account</button>
          </div>
        </div>
        <div className="heroart" aria-hidden>
          <div className="mini">
            <div className="mtop"><span className="topicpill">Electromagnetic Induction</span><span className="marks">+4 / −1</span></div>
            <div className="mq">Self-inductance of a coil depends on:</div>
            <div className="mo"><i>A</i>Only on geometry</div>
            <div className="mo"><i>B</i>Only on medium property</div>
            <div className="mo ok"><i>C</i>Geometry and medium property<span className="t">✓ correct</span></div>
            <div className="mo"><i>D</i>Value of current through the inductor</div>
          </div>
        </div>
      </div>

      <div className="exam-tiles">
        {EXAM_ORDER.map((e) => (
          <button key={e} className="tile panel" onClick={() => go(registerUrl(`/pyq?view=papers&exam=${encodeURIComponent(e)}`))}>
            <div className="big">{EXAM_TILE[e].title}</div>
            <div className="sm">{EXAM_TILE[e].sub}</div>
            <div className="cnt">{counts[e] ? `${counts[e]} ▸` : " "}</div>
          </button>
        ))}
      </div>

      <div className="how">
        {[
          ["1", "Pick a paper", "Choose your exam, subject, year and set."],
          ["2", "Attempt online", "MCQ interface — mark for later, reveal the solution once you answer."],
          ["3", "See your analysis", "Score, accuracy and topic-wise strengths & gaps."],
        ].map(([n, t, d]) => (
          <div key={n} className="c panel">
            <div className="n">{n}</div>
            <h3 style={{ fontSize: 16 }}>{t}</h3>
            <p className="muted" style={{ fontSize: 13.5, margin: "7px 0 0" }}>{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ===================================================== S2 Create account */
function Register() {
  // The real Vedam One signup (Part-1: name · WhatsApp · email → OTP, then
  // Part-2: grad year · stream · state · city). It reads `?next=` from this URL
  // and returns the user to the paper picker (or the paper they clicked).
  return (
    <section className="screen">
      <div className="regwrap">
        <div className="eyebrow">Create your free account</div>
        <div className="native">
          <Suspense fallback={<div className="loading">Loading…</div>}><RegisterForm /></Suspense>
        </div>
      </div>
    </section>
  );
}

/* ========================================================== S3 Dashboard */
function Dashboard({ firstName, go, toast }: { firstName: string; go: (u: string) => void; toast: (m: string) => void }) {
  const [me, setMe] = useState<MeData | null>(null);
  useEffect(() => {
    let on = true;
    jget<MeData>("/api/pyq/me").then((d) => { if (on) setMe(d); }).catch((e) => { if (on) { toast((e as Error).message); setMe({ name: null, in_progress: null, attempts: [], stats: { papers_attempted: 0, avg_accuracy: null } }); } });
    return () => { on = false; };
  }, [toast]);

  const nm = firstName || (me?.name ?? "").trim().split(/\s+/)[0] || "there";
  const ip = me?.in_progress;
  const pct = ip && ip.total ? Math.round((ip.answered / ip.total) * 100) : 0;

  return (
    <section className="screen">
      <div className="eyebrow">PYQ Dashboard</div>
      <h2 style={{ fontSize: 28, marginTop: 6 }}>Welcome back, {nm} 👋</h2>
      {!me ? <div className="loading">Loading your attempts…</div> : (
        <div className="dgrid">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {ip && (
              <div className="resume">
                <div className="tag">▶ RESUME IN PROGRESS</div>
                <h3 style={{ fontSize: 18, marginTop: 6 }}>{fullPaperName(ip.paper)}</h3>
                <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                  Question {Math.min(ip.answered + 1, ip.total || 1)} of {ip.total} · {ip.answered} answered
                </div>
                <div className="pbar"><i style={{ width: `${Math.max(pct, 4)}%` }} /></div>
                <button className="btn orange" onClick={() => go(`/pyq?paper=${ip.paper.id}`)}>Continue attempt →</button>
              </div>
            )}
            <div className="panel" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 15 }}>Past attempts</h3>
              {me.attempts.length === 0 && <div className="empty">No attempts yet — pick a paper to start.</div>}
              {me.attempts.map((a) => (
                <button key={a.attempt_id} className="attempt panel" onClick={() => go(`/pyq?result=${a.attempt_id}`)}>
                  <div>
                    <b>{fullPaperName(a.paper)}</b>
                    <div className="muted" style={{ fontSize: 12 }}>{a.submitted_at ? shortDate(a.submitted_at) : ""} · {a.paper.total_questions} Q</div>
                  </div>
                  <span className="sc">{fmtNum(a.score)}/{fmtNum(a.max_score)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="statcol">
            <div className="stat panel"><b className="num">{me.stats.papers_attempted}</b><span>Papers attempted</span></div>
            <div className="stat panel"><b className="num">{me.stats.avg_accuracy == null ? "—" : `${me.stats.avg_accuracy}%`}</b><span>Avg accuracy</span></div>
            <button className="btn primary" style={{ justifyContent: "center" }} onClick={() => go("/pyq?view=papers")}>Browse all papers →</button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ======================================================= S4 Pick a paper */
function Picker({ papers, initialExam, signedIn, go }: { papers: Paper[] | null; initialExam?: string; signedIn: boolean; go: (u: string, r?: boolean) => void }) {
  const [exam, setExam] = useState(initialExam && EXAM_ORDER.includes(initialExam) ? initialExam : DEFAULT_EXAM);
  const [subject, setSubject] = useState("");
  const [year, setYear] = useState("");
  const [setLabel, setSetLabel] = useState("");

  const ofExam = useMemo(() => (papers ?? []).filter((p) => p.exam === exam), [papers, exam]);
  const subjects = useMemo(() => Array.from(new Set(ofExam.map((p) => p.subject))), [ofExam]);
  const years = useMemo(() => Array.from(new Set(ofExam.map((p) => p.year))).sort((a, b) => b - a), [ofExam]);
  const sets = useMemo(() => Array.from(new Set(ofExam.map((p) => p.set_label).filter(Boolean) as string[])), [ofExam]);
  const list = ofExam.filter((p) => (!subject || p.subject === subject) && (!year || String(p.year) === year) && (!setLabel || p.set_label === setLabel));

  function pickExam(e: string) {
    setExam(e); setSubject(""); setYear(""); setSetLabel("");
    window.history.replaceState(null, "", `/pyq?view=papers&exam=${encodeURIComponent(e)}`);
  }
  // Logged-out visitors are routed through S2 and come straight back to the paper.
  const open = (paperId: string) => go(signedIn ? `/pyq?paper=${paperId}` : registerUrl(`/pyq?paper=${paperId}`));
  const word = SET_WORD[exam] ?? "Set";

  return (
    <section className="screen">
      <div className="eyebrow">Choose a paper</div>
      <h2 style={{ fontSize: 26, marginTop: 6 }}>Previous Year Papers</h2>
      <div className="tabs">
        {EXAM_ORDER.map((e) => (
          <button key={e} className={`tab ${e === exam ? "on" : ""}`} onClick={() => pickExam(e)}>{EXAM_TAB[e]}</button>
        ))}
      </div>
      <div className="filters">
        <select className="sel" value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">Subject · All</option>
          {subjects.map((s) => <option key={s} value={s}>Subject · {s}</option>)}
        </select>
        <select className="sel" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Year · All</option>
          {years.map((y) => <option key={y} value={String(y)}>Year · {y}</option>)}
        </select>
        <select className="sel" value={setLabel} onChange={(e) => setSetLabel(e.target.value)}>
          <option value="">{word} · All</option>
          {sets.map((s) => <option key={s} value={s}>{word} · {s}</option>)}
        </select>
      </div>

      {!papers ? <div className="loading">Loading papers…</div> : list.length === 0 ? (
        <div className="empty">{ofExam.length === 0 ? `${examTitle(exam)} papers are coming soon.` : "No papers match these filters."}</div>
      ) : (
        <div className="papers">
          {list.map((p) => {
            const st = p.my;
            return (
              <div key={p.id} className="paper panel">
                <h3 style={{ fontSize: 17 }}>{paperName(p)}</h3>
                <div className="pm">{p.total_questions} questions · {paperMarking(p)}</div>
                <div className="foot">
                  {st?.in_progress_id ? <span className="badge prog">In progress</span>
                    : st?.last ? <span className="badge done">Score {fmtNum(st.last.score)}/{fmtNum(st.last.max_score)}</span>
                    : <span className="badge new">Not attempted</span>}
                  <span className="push">
                    {st?.in_progress_id ? (
                      <button className="btn primary sm" onClick={() => open(p.id)}>Resume →</button>
                    ) : st?.last ? (
                      <>
                        <button className="btn ghost sm" onClick={() => go(`/pyq?result=${st.last!.attempt_id}`)}>Review</button>
                        <button className="btn sm" onClick={() => open(p.id)}>Re-attempt</button>
                      </>
                    ) : (
                      <button className="btn primary sm" onClick={() => open(p.id)}>Attempt →</button>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ========================================================= S5 Attempt */
function Test({ paperId, go, toast, onSubmitted }: {
  paperId: string; go: (u: string, r?: boolean) => void; toast: (m: string) => void;
  onSubmitted: (attemptId: string, data: ResultData) => void;
}) {
  const [attemptId, setAttemptId] = useState("");
  const [paper, setPaper] = useState<Paper | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [i, setI] = useState(0);
  const [failed, setFailed] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const j = await jpost<{
          attempt_id: string; paper: Paper; questions: Question[];
          answers: Array<{ question_id: string; selected_key: string | null; marked_for_later: boolean; revealed: boolean; correct_key: string | null; solution: string | null; is_correct: boolean | null }>;
        }>("/api/pyq/attempt/start", { paper_id: paperId });
        if (!on) return;
        const amap: Record<string, AnswerState> = {};
        for (const a of j.answers ?? []) {
          amap[a.question_id] = {
            selected_key: a.selected_key, marked_for_later: a.marked_for_later, revealed: a.revealed,
            reveal: a.selected_key != null ? { correct_key: a.correct_key, solution: a.solution, is_correct: a.is_correct } : undefined,
          };
        }
        // Resuming → open on the first question not yet answered.
        const firstOpen = j.questions.findIndex((q) => !amap[q.id]?.selected_key);
        setAttemptId(j.attempt_id); setPaper(j.paper); setQuestions(j.questions); setAnswers(amap);
        setI(firstOpen > 0 ? firstOpen : 0);
        startedAt.current = Date.now();
      } catch (e) { if (on) setFailed((e as Error).message); }
    })();
    return () => { on = false; };
  }, [paperId]);

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
    } catch { toast("Couldn't save that answer — check your connection."); }
  }
  async function toggleMark(qid: string) {
    const nextMark = !answers[qid]?.marked_for_later;
    patch(qid, { marked_for_later: nextMark });
    try { await jpost("/api/pyq/attempt/answer", { attempt_id: attemptId, question_id: qid, marked_for_later: nextMark }); } catch { /* best effort */ }
  }
  async function toggleReveal(qid: string) {
    const will = !answers[qid]?.revealed;
    patch(qid, { revealed: will });
    if (will) { try { await jpost("/api/pyq/attempt/answer", { attempt_id: attemptId, question_id: qid, reveal: true }); } catch { /* best effort */ } }
  }
  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const spent = Math.round((Date.now() - startedAt.current) / 1000);
      const j = await jpost<ResultData>("/api/pyq/attempt/submit", { attempt_id: attemptId, duration_secs: spent });
      onSubmitted(attemptId, { ...j, paper });
    } catch (e) { toast((e as Error).message); setSubmitting(false); }
  }

  if (failed) return (
    <section className="screen"><div className="empty">{failed}</div>
      <button className="btn" onClick={() => go("/pyq?view=papers")}>← Back to papers</button></section>
  );
  if (!paper) return <Loading label="Loading your paper…" />;
  if (submitting) return <Loading label="Scoring your attempt…" />;
  if (questions.length === 0) return <section className="screen"><div className="empty">This paper has no questions yet.</div></section>;

  const q = questions[i];
  const a = answers[q.id];
  const answered = !!a?.selected_key;
  const rev = answered && !!a?.revealed && !!a?.reveal;
  const correctKey = a?.reveal?.correct_key ?? null;
  const correctOpt = q.options.find((o) => o.key === correctKey);
  const ansd = questions.filter((qq) => answers[qq.id]?.selected_key).length;
  const mkd = questions.filter((qq) => answers[qq.id]?.marked_for_later).length;
  const N = questions.length;

  return (
    <section className="screen">
      <div className="examhead">
        <div>
          <div className="nm">{fullPaperName(paper)}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{N} questions · {paperMarking(paper)}</div>
        </div>
        <button className="btn sm push" onClick={submit}>Submit test</button>
      </div>

      <div className="exam">
        <div className="qcard panel">
          <div className="qtop">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="qno">Question {i + 1}<span className="muted" style={{ fontWeight: 600, fontSize: 14 }}>/{N}</span></span>
              {q.topic && <span className="topicpill">{q.topic}</span>}
              <span className="marks">{markLabel(q.marks_correct, q.marks_wrong)}</span>
            </div>
            <button className={`markbtn ${a?.marked_for_later ? "on" : ""}`} onClick={() => toggleMark(q.id)}>
              {a?.marked_for_later ? "★ Marked" : "☆ Mark for later"}
            </button>
          </div>

          <div className="stem">{q.stem}</div>

          <div className="opts">
            {q.options.map((o) => {
              const sel = a?.selected_key === o.key;
              let cls = "opt";
              if (rev && o.key === correctKey) cls = "opt correct";
              else if (rev && sel) cls = "opt wrong";
              else if (sel) cls = "opt sel";
              return (
                <button key={o.key} className={cls} onClick={() => choose(q.id, o.key)}>
                  <span className="k">{o.key}</span><span>{o.text}</span>
                  {rev && o.key === correctKey && <span className="tick" style={{ color: "var(--ok)" }}>✓ correct</span>}
                  {rev && sel && o.key !== correctKey && <span className="tick" style={{ color: "var(--bad)" }}>✗ your answer</span>}
                </button>
              );
            })}
          </div>

          <div className="locknote">
            {answered ? "You can change your answer any time before you submit." : "Select an option to enable “Show result”."}
          </div>

          {rev && (
            <div className="resultbox">
              <div className="hd">✓ Correct answer: {correctKey}{correctOpt ? `. ${correctOpt.text}` : ""}</div>
              {a?.reveal?.solution && <div className="sol">{a.reveal.solution}</div>}
            </div>
          )}

          <div className="qactions">
            <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>← Back to previous</button>
            {answered && (
              <button className="btn ghost" onClick={() => toggleReveal(q.id)}>{a?.revealed ? "Hide result" : "Show result"}</button>
            )}
            <span className="sp" />
            <button className="btn primary" disabled={i === N - 1} onClick={() => setI(i + 1)}>Save &amp; Next →</button>
          </div>
        </div>

        <aside className="palette panel">
          <h3>Question palette</h3>
          <div className="legend">
            <span><i className="lg a" />Answered</span><span><i className="lg m" />Marked</span>
            <span><i className="lg" />Not done</span><span><i className="lg c" />Current</span>
          </div>
          <div className="cells">
            {questions.map((qq, idx) => {
              const st = answers[qq.id];
              let c = "cell";
              if (idx === i) c += " c";
              if (st?.selected_key) c += " a"; else if (st?.marked_for_later) c += " m";
              return <button key={qq.id} className={c} onClick={() => setI(idx)}>{idx + 1}</button>;
            })}
          </div>
          <div className="countline"><span>Answered <b>{ansd}</b></span><span>Marked <b>{mkd}</b></span></div>
          <button className="btn primary sm" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} onClick={submit}>Submit test</button>
        </aside>
      </div>
    </section>
  );
}

/* ================================================ S6 Result & analysis */
function Result({ attemptId, cached, go, toast }: { attemptId: string; cached?: ResultData; go: (u: string) => void; toast: (m: string) => void }) {
  const [data, setData] = useState<ResultData | null>(cached ?? null);
  const [failed, setFailed] = useState("");
  useEffect(() => {
    if (cached) return;
    let on = true;
    jget<ResultData>(`/api/pyq/attempt/${attemptId}`).then((d) => { if (on) setData(d); }).catch((e) => { if (on) { setFailed((e as Error).message); toast((e as Error).message); } });
    return () => { on = false; };
  }, [attemptId, cached, toast]);

  if (failed) return <section className="screen"><div className="empty">{failed}</div><button className="btn" onClick={() => go("/pyq")}>← Back to dashboard</button></section>;
  if (!data) return <Loading label="Loading your result…" />;

  const s = data.summary;
  const p = data.paper;
  const acc = s.attempted ? Math.round((s.correct / s.attempted) * 100) : 0;

  return (
    <section className="screen">
      <div className="scorehero">
        <div className="eyebrow" style={{ color: "#d9c6ff" }}>Result · {p ? fullPaperName(p) : "Your attempt"}</div>
        <div className="big num">{fmtNum(s.score)}<span> / {fmtNum(s.max_score)}</span></div>
        <div className="muted" style={{ marginTop: 6 }}>{s.correct} correct · {s.wrong} wrong · {s.unattempted} unattempted</div>
        <div className="kpis">
          <div className="kpi panel"><b className="num" style={{ color: "var(--ok)" }}>{s.correct}</b><span>Correct</span></div>
          <div className="kpi panel"><b className="num" style={{ color: "var(--bad)" }}>{s.wrong}</b><span>Wrong</span></div>
          <div className="kpi panel"><b className="num">{s.unattempted}</b><span>Skipped</span></div>
          <div className="kpi panel"><b className="num" style={{ color: "var(--cyan)" }}>{acc}%</b><span>Accuracy</span></div>
        </div>
      </div>

      <div className="twocol">
        <div className="tbars panel">
          <h3 style={{ fontSize: 16 }}>Strong vs weak — by topic</h3>
          {data.topic_breakdown.map((t) => (
            <div key={t.topic} className="tbar">
              <div className="lab"><span>{t.topic}</span><span className="muted">{t.correct}/{t.total}</span></div>
              <div className="track"><i style={{ width: `${t.pct}%`, background: barColor(t.pct) }} /></div>
            </div>
          ))}
        </div>
        <div className="review panel">
          <h3 style={{ fontSize: 16 }}>Question-wise review</h3>
          {data.review.map((r, idx) => {
            const yours = r.selected_key ? r.options.find((o) => o.key === r.selected_key) : null;
            const right = r.options.find((o) => o.key === r.correct_key);
            const got = r.is_correct === true;
            return (
              <div key={r.id} className="rev">
                {r.topic && <div className="tp">{r.topic}</div>}
                <div className="q">Q{idx + 1}. {r.stem}</div>
                <div className="ans">
                  <span className={`y ${r.selected_key == null ? "" : got ? "ok" : "no"}`}>
                    Your answer: {r.selected_key == null ? "Not attempted" : `${r.selected_key}. ${yours?.text ?? ""}`}
                    {r.selected_key != null && ` (${Number(r.awarded) > 0 ? "+" : ""}${fmtNum(r.awarded)})`}
                  </span>
                  <span style={{ color: "var(--ok)" }}>Correct: {r.correct_key}. {right?.text ?? ""}</span>
                </div>
                {r.solution && <div className="sol">{r.solution}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="actions">
        {p && <button className="btn" onClick={() => go(`/pyq?paper=${p.id}`)}>↻ Re-attempt</button>}
        <button className="btn ghost" onClick={() => go(p ? `/pyq?view=papers&exam=${encodeURIComponent(p.exam)}` : "/pyq?view=papers")}>Next paper</button>
        <button className="btn primary" onClick={() => go("/pyq")}>Back to dashboard</button>
      </div>
    </section>
  );
}
