"use client";

import { MathText } from "./math-text";

/* PYQ module — replicates the approved "PYQ Exam Prototype" + "PYQ Workflow
   Wireframe" journey inside the Vedam One shell.

   Everyone enters on S1 Landing (header "PYQ" → /pyq), new or returning.
   New user (logged out):   S1 Landing → S2 Create account → S4 Pick paper → S5 Attempt → S6 Result
   Returning (signed in):   S1 Landing (Continue / My dashboard) → S3 Dashboard → Resume / S4 → S5 → S6
   Board papers: Section A is answered and scored; Sections B–E ('theory') are
   read-only — the question is shown with a Show/Hide answer toggle.
   S5 has a Back button: progress (answers + current question) is saved and the
   paper resumes at the same question later.

   Deliberate differences from the static prototype, per later product decisions:
   no timer; answers are NOT locked (re-selectable) and "Show result" appears only
   once the question is attempted; marks follow each exam's real scheme; S2 is the
   real Vedam One signup (Part-1 OTP + Part-2 details), not a mock.

   URL is the source of truth so refresh / back work:
     /pyq                         → S1 (everyone)
     /pyq?view=dashboard          → S3 (signed in; logged out → S1)
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
  /** Board papers: printed General Instructions, section notes, time and max marks; how many questions are read-only theory. */
  instructions?: string | null; sections?: { name: string; note?: string | null }[] | null;
  duration_mins?: number | null; max_marks?: number | null; theory_questions?: number;
};
/** Figure URLs (public `pyq-figures` bucket). Option figures are keyed by option letter. */
type Figs = { stem_figure_url?: string | null; option_figure_urls?: Record<string, string> | null };
/** 'multi' = one or more options correct (WBJEE Category 3), answered with selected_keys.
 *  'theory' = board subjective question: read-only, shown with a Show/Hide answer, never scored. */
type QType = "mcq" | "numeric" | "multi" | "theory";
type Question = {
  id: string; q_no: number; topic: string | null; qtype: QType;
  stem: string; options: QOption[]; marks_correct: number; marks_wrong: number;
  section?: string | null; or_stem?: string | null; or_stem_figure_url?: string | null;
  /** Theory only (the server sends these for read-only questions; null otherwise). */
  solution?: string | null; solution_figure_url?: string | null; or_solution?: string | null; or_solution_figure_url?: string | null;
} & Figs;
type Reveal = {
  correct_key: string | null; correct_value: number | null; correct_keys?: string[] | null; solution: string | null;
  solution_figure_url?: string | null; is_correct: boolean | null; awarded?: number | null;
};
/** `locked` = the server has recorded that the solution was seen (answer can no
 *  longer change); `shown` = the result box is currently open on screen. */
type AnswerState = {
  selected_key: string | null; selected_value: number | null; selected_keys: string[] | null; marked_for_later: boolean;
  locked: boolean; shown: boolean; reveal?: Reveal;
};
type TopicStat = { topic: string; correct: number; attempted: number; total: number; pct: number };
type ReviewItem = {
  id: string; q_no: number; topic: string | null; qtype?: QType; stem: string; options: QOption[];
  correct_key: string | null; correct_value?: number | null; correct_keys?: string[] | null; solution: string | null; solution_figure_url?: string | null;
  selected_key: string | null; selected_value?: number | null; selected_keys?: string[] | null;
  marked_for_later: boolean; is_correct: boolean | null; awarded: number;
} & Figs;
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
/** A numeric answer shown back to the user, exactly as stored (no rounding). */
const fmtVal = (v: number | string | null | undefined) => (v == null || v === "" ? "—" : String(Number(v)));
const isAnswered = (a?: AnswerState) => !!a && (a.selected_key != null || a.selected_value != null || !!a.selected_keys?.length);
/** Multi-answer partial credit: not fully correct, yet marks were awarded (a wrong option scores marks_wrong ≤ 0). */
const isPartial = (is_correct: boolean | null | undefined, awarded: number | null | undefined) => is_correct === false && Number(awarded ?? 0) > 0;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const isTheory = (q: { qtype?: QType }) => q.qtype === "theory";
const theoryCount = (p: Pick<Paper, "theory_questions">) => Number(p.theory_questions ?? 0);
/** "16 questions" or, for a board paper, "16 objective + 17 theory questions". */
const questionCountLabel = (p: Pick<Paper, "total_questions" | "theory_questions">) => {
  const t = theoryCount(p);
  return t ? `${p.total_questions - t} objective + ${t} theory questions` : `${p.total_questions} questions`;
};
const marksWord = (n: number | string) => `${fmtNum(n)} mark${Number(n) === 1 ? "" : "s"}`;
const DASHBOARD = "/pyq?view=dashboard";

/** A question / option / solution figure. Plain <img>: these are external
 *  Storage URLs and are already sized for the web. */
function Fig({ src, alt, className = "qfig" }: { src?: string | null; alt: string; className?: string }) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} alt={alt} loading="lazy" />;
}
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
  if (view === "dashboard") return signedIn ? { route: { s: "dashboard" } } : { route: { s: "landing" }, normalize: "/pyq" };
  if (view === "papers") return { route: { s: "picker", exam: q.get("exam") ?? undefined } };
  if (view === "register") {
    if (signedIn) return { route: { s: "dashboard" }, normalize: DASHBOARD };
    return q.get("next") ? { route: { s: "register" } } : { route: { s: "register" }, normalize: registerUrl("/pyq?view=papers") };
  }
  return { route: { s: "landing" } };
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
      case "landing": screen = <Landing papers={papers} go={go} signedIn={signedIn} firstName={firstName} />; break;
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

/* Hero demo — a looping, purely decorative "cursor attempts a question" animation that
   mirrors the real attempt screen: cursor glides in → picks an option (randomly right or
   wrong) → clicks "Show result" → correct option turns green, a wrong pick turns red, and the
   solution box opens → next question. Respects prefers-reduced-motion (static card) and
   pauses while off-screen. */
const HERO_DEMO = [
  { topic: "Electromagnetic Induction", q: "Self-inductance of a coil depends on:", o: ["Only on geometry", "Only on medium property", "Geometry and medium property", "Value of current through the inductor"], c: 2,
    sol: "L = μ₀μᵣN²A/ℓ — it depends on the coil's geometry and the medium, not on the current." },
  { topic: "Chemical Bonding", q: "The shape of an NH₃ molecule is:", o: ["Trigonal pyramidal", "Trigonal planar", "Linear", "Tetrahedral"], c: 0,
    sol: "N has 3 bond pairs and 1 lone pair (sp³), so the shape is trigonal pyramidal." },
  { topic: "Differentiation", q: "If f(x) = x², then f′(3) equals:", o: ["2", "6", "9", "3"], c: 1,
    sol: "f′(x) = 2x, so f′(3) = 2 × 3 = 6." },
];

function HeroDemo() {
  const [qi, setQi] = useState(0);
  const [st, setSt] = useState({ hov: -1, sel: -1, rev: false, fade: false, btnHov: false });
  const [cur, setCur] = useState({ x: 0, y: 0, show: false, press: false });
  const [vis, setVis] = useState(true);
  const [still, setStill] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const opts = useRef<(HTMLDivElement | null)[]>([]);
  const btn = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setStill(true);
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (still || !vis) return;
    const d = HERO_DEMO[qi];
    // Random outcome each round: ~50% the correct option, otherwise a random wrong one.
    const wrong = [0, 1, 2, 3].filter((i) => i !== d.c);
    const pick = Math.random() < 0.5 ? d.c : wrong[Math.floor(Math.random() * wrong.length)];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };
    const aimEl = (el: HTMLElement | null) => {
      if (el) setCur((c) => ({ ...c, show: true, press: false, x: el.offsetLeft + el.offsetWidth * 0.8, y: el.offsetTop + el.offsetHeight * 0.5 }));
    };
    const r = root.current;
    setSt({ hov: -1, sel: -1, rev: false, fade: false, btnHov: false });
    setCur({ x: r ? r.offsetWidth - 34 : 0, y: r ? r.offsetHeight + 6 : 0, show: false, press: false });
    at(500, () => aimEl(opts.current[pick]));
    at(1500, () => setSt((s) => ({ ...s, hov: pick })));
    at(1900, () => setCur((c) => ({ ...c, press: true })));
    at(2050, () => { setCur((c) => ({ ...c, press: false })); setSt((s) => ({ ...s, hov: -1, sel: pick })); });
    at(2900, () => aimEl(btn.current));
    at(3700, () => setSt((s) => ({ ...s, btnHov: true })));
    at(4000, () => setCur((c) => ({ ...c, press: true })));
    at(4150, () => { setCur((c) => ({ ...c, press: false, show: false })); setSt((s) => ({ ...s, btnHov: false, rev: true })); });
    at(8800, () => setSt((s) => ({ ...s, fade: true })));
    at(9300, () => setQi((n) => (n + 1) % HERO_DEMO.length));
    return () => timers.forEach(clearTimeout);
  }, [qi, vis, still]);

  const d = HERO_DEMO[still ? 0 : qi];
  const sel = still ? d.c : st.sel;
  const rev = still || st.rev;
  return (
    <div className="mini" ref={root}>
      <div className={"mbody" + (st.fade ? " fade" : "")}>
        <div className="mtop"><span className="topicpill">{d.topic}</span><span className="marks">+4 / −1</span></div>
        <div className="mq">{d.q}</div>
        {d.o.map((t, i) => {
          const isKey = rev && i === d.c;
          const isBad = rev && sel === i && i !== d.c;
          return (
            <div
              key={i}
              ref={(el) => { opts.current[i] = el; }}
              className={"mo" + (st.hov === i ? " hov" : "") + (sel === i && !rev ? " sel" : "") + (isBad ? " bad" : "") + (isKey ? " ok" : "")}
            >
              <i>{"ABCD"[i]}</i>{t}
              {isKey && <span className="t">✓ correct</span>}
              {isBad && <span className="t bad">✗ your answer</span>}
            </div>
          );
        })}
        <div className="mshowrow">
          <div ref={btn} className={"mshow" + (sel >= 0 && !rev ? " on" : "") + (st.btnHov ? " hov" : "")}>Show result</div>
        </div>
        <div className={"mres" + (rev ? " on" : "")}>
          <div className="hd">✓ Correct answer: {"ABCD"[d.c]}. {d.o[d.c]}</div>
          <div className="sol">{d.sol}</div>
        </div>
      </div>
      {!still && (
        <div className={"cur" + (cur.show ? " on" : "") + (cur.press ? " press" : "")} style={{ transform: `translate(${cur.x}px,${cur.y}px)` }}>
          <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l15 8.5-6.6 1.9L9.6 19.5z" fill="#fff" stroke="#0b0618" strokeWidth="1.4" strokeLinejoin="round" /></svg>
        </div>
      )}
    </div>
  );
}

/* ============================================================ S1 Landing */
function Landing({ papers, go, signedIn, firstName }: { papers: Paper[] | null; go: (u: string) => void; signedIn: boolean; firstName: string }) {
  // Signed-in visitors skip signup: tiles and CTAs go straight to the papers / their dashboard.
  const toPapers = (exam?: string) => {
    const url = exam ? `/pyq?view=papers&exam=${encodeURIComponent(exam)}` : "/pyq?view=papers";
    go(signedIn ? url : registerUrl(url));
  };
  const counts = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of EXAM_ORDER) {
      const list = (papers ?? []).filter((p) => p.exam === e);
      if (!papers) { m[e] = ""; continue; }
      // Show the span of years the papers cover, e.g. "2023–2026" (a single year shows just "2024").
      const ys = list.map((p) => p.year);
      if (!ys.length) { m[e] = "Coming soon"; continue; }
      const lo = Math.min(...ys), hi = Math.max(...ys);
      m[e] = lo === hi ? String(lo) : `${lo}–${hi}`;
    }
    return m;
  }, [papers]);

  return (
    <section className="screen">
      <div className="hero">
        <div>
          <div className="eyebrow">{signedIn && firstName ? `Welcome back, ${firstName}` : "Previous Year Questions"}</div>
          <h1>Attempt real <span className="k">PYQ papers</span> online, free.</h1>
          <p>Boards, JEE, WBJEE &amp; MH-CET — last 3 years, every set, with instant solutions and a weak-vs-strong analysis after each paper.</p>
          <div className="cta">
            {signedIn ? (
              <>
                <button className="btn primary" onClick={() => toPapers()}>Continue practicing →</button>
                <button className="btn ghost" onClick={() => go(DASHBOARD)}>My dashboard</button>
              </>
            ) : (
              <>
                <button className="btn primary" onClick={() => toPapers()}>Start practicing →</button>
                <button className="btn ghost" onClick={() => window.location.assign("/login?next=" + encodeURIComponent("/pyq"))}>I already have an account</button>
              </>
            )}
          </div>
        </div>
        <div className="heroart" aria-hidden>
          <HeroDemo />
        </div>
      </div>

      <div className="exam-tiles">
        {EXAM_ORDER.map((e) => (
          <button key={e} className="tile panel" onClick={() => toPapers(e)}>
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

      {/* Wireframe S1: "Why it's free". */}
      <div className="why panel">
        <div className="eyebrow">Why it&apos;s free</div>
        <h3 style={{ fontSize: 18, marginTop: 6 }}>Real papers, real answer keys — no fee, no limits.</h3>
        <p className="muted">
          Vedam School of Technology runs PYQ Practice as a free resource for every student preparing for the Boards
          and entrance exams. Create one free account, attempt as many papers as you like, and come back to your
          progress any time.
        </p>
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
                    <div className="muted" style={{ fontSize: 12 }}>{a.submitted_at ? shortDate(a.submitted_at) : ""} · {a.paper.total_questions - theoryCount(a.paper)} Q</div>
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
  const list = ofExam.filter((p) => (!subject || p.subject === subject) && (!year || String(p.year) === year) && (!setLabel || p.set_label === setLabel))
    // Latest year first; the sort is stable, so papers within a year keep the server's order.
    .sort((a, b) => b.year - a.year);

  function pickExam(e: string) {
    setExam(e); setSubject(""); setYear(""); setSetLabel("");
    window.history.replaceState(null, "", `/pyq?view=papers&exam=${encodeURIComponent(e)}`);
  }
  // Logged-out visitors are routed through S2 and come straight back to the paper.
  const open = (paperId: string) => go(signedIn ? `/pyq?paper=${paperId}` : registerUrl(`/pyq?paper=${paperId}`));
  const word = SET_WORD[exam] ?? "Set";

  return (
    <section className="screen">
      <button className="btn sm ghost backbtn" style={{ marginBottom: 14 }} onClick={() => go("/pyq")}>← Back</button>
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
                <div className="pm">{questionCountLabel(p)} · {paperMarking(p)}</div>
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
  const [confirming, setConfirming] = useState(false);
  const [showInstr, setShowInstr] = useState(false);
  /** Theory questions whose marking-scheme answer is open on screen. */
  const [shownAns, setShownAns] = useState<Record<string, boolean>>({});
  const startedAt = useRef(Date.now());
  const savedPos = useRef<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const j = await jpost<{
          attempt_id: string; paper: Paper; questions: Question[]; last_question_id?: string | null;
          answers: Array<{
            question_id: string; selected_key: string | null; selected_value: number | null; selected_keys: string[] | null; marked_for_later: boolean; revealed: boolean;
            correct_key: string | null; correct_value: number | null; correct_keys: string[] | null; solution: string | null; solution_figure_url: string | null;
            is_correct: boolean | null; awarded: number | null;
          }>;
        }>("/api/pyq/attempt/start", { paper_id: paperId });
        if (!on) return;
        const amap: Record<string, AnswerState> = {};
        for (const a of j.answers ?? []) {
          // The server only sends the answer for questions whose result was already seen.
          amap[a.question_id] = {
            selected_key: a.selected_key, selected_value: a.selected_value ?? null, selected_keys: a.selected_keys ?? null, marked_for_later: a.marked_for_later,
            locked: a.revealed, shown: a.revealed,
            reveal: a.revealed ? {
              correct_key: a.correct_key, correct_value: a.correct_value, correct_keys: a.correct_keys ?? null, solution: a.solution,
              solution_figure_url: a.solution_figure_url, is_correct: a.is_correct, awarded: a.awarded,
            } : undefined,
          };
        }
        // Resuming → open where the candidate left off (Back saves it); else the
        // first answerable question not yet answered.
        const lastIdx = j.last_question_id ? j.questions.findIndex((q) => q.id === j.last_question_id) : -1;
        const firstOpen = j.questions.findIndex((q) => !isTheory(q) && !isAnswered(amap[q.id]));
        savedPos.current = j.last_question_id ?? null;
        setAttemptId(j.attempt_id); setPaper(j.paper); setQuestions(j.questions); setAnswers(amap);
        setI(lastIdx >= 0 ? lastIdx : firstOpen > 0 ? firstOpen : 0);
        // Board papers open with their General Instructions on a fresh attempt.
        setShowInstr(!!j.paper.instructions && (j.answers ?? []).length === 0 && lastIdx < 0);
        startedAt.current = Date.now();
      } catch (e) { if (on) setFailed((e as Error).message); }
    })();
    return () => { on = false; };
  }, [paperId]);

  /** Remember the current question on the server (resume point). */
  const savePosition = useCallback(async (qid: string) => {
    if (!attemptId || savedPos.current === qid) return;
    savedPos.current = qid;
    try { await jpost("/api/pyq/attempt/position", { attempt_id: attemptId, question_id: qid }); }
    catch { savedPos.current = null; /* best effort; retried on the next move */ }
  }, [attemptId]);
  const currentQid = questions[i]?.id;
  useEffect(() => {
    if (!currentQid) return;
    const t = setTimeout(() => { void savePosition(currentQid); }, 600);
    return () => clearTimeout(t);
  }, [currentQid, savePosition]);

  /** Back: leave the paper at any moment. Answers are saved as they're given;
   *  this also saves the current question so "Resume" opens right here. */
  async function leavePaper() {
    if (currentQid) await savePosition(currentQid);
    toast("Progress saved — resume from this question any time.");
    go(paper ? `/pyq?view=papers&exam=${encodeURIComponent(paper.exam)}` : "/pyq?view=papers");
  }

  // Esc closes the submit confirmation.
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirming(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  function patch(qid: string, next: Partial<AnswerState>) {
    setAnswers((prev) => {
      const base: AnswerState = prev[qid] ?? { selected_key: null, selected_value: null, selected_keys: null, marked_for_later: false, locked: false, shown: false };
      return { ...prev, [qid]: { ...base, ...next } };
    });
  }
  const saveFailed = (e: unknown) => toast((e as Error)?.message || "Couldn't save that answer — check your connection.");
  async function choose(qid: string, key: string) {
    const st = answers[qid];
    if (st?.locked) return;
    const prev = st?.selected_key ?? null;
    patch(qid, { selected_key: key });
    try { await jpost("/api/pyq/attempt/answer", { attempt_id: attemptId, question_id: qid, selected_key: key }); }
    catch (e) { patch(qid, { selected_key: prev }); saveFailed(e); }
  }
  /** Multi-answer: tapping an option toggles it in the selection and saves at
   *  once. An empty selection is sent as [] (clears; stored as NULL). */
  async function toggleKey(qid: string, key: string) {
    const st = answers[qid];
    if (st?.locked) return;
    const prev = st?.selected_keys ?? null;
    const cur = prev ?? [];
    const next = (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]).sort();
    patch(qid, { selected_keys: next.length ? next : null });
    try { await jpost("/api/pyq/attempt/answer", { attempt_id: attemptId, question_id: qid, selected_keys: next }); }
    catch (e) { patch(qid, { selected_keys: prev }); saveFailed(e); }
  }
  async function saveValue(qid: string, raw: string) {
    const st = answers[qid];
    if (st?.locked) return;
    const v = raw === "" ? null : Number(raw);
    const prev = st?.selected_value ?? null;
    patch(qid, { selected_value: v });
    try { await jpost("/api/pyq/attempt/answer", { attempt_id: attemptId, question_id: qid, selected_value: v }); }
    catch (e) { patch(qid, { selected_value: prev }); saveFailed(e); }
  }
  async function toggleMark(qid: string) {
    const nextMark = !answers[qid]?.marked_for_later;
    patch(qid, { marked_for_later: nextMark });
    try { await jpost("/api/pyq/attempt/answer", { attempt_id: attemptId, question_id: qid, marked_for_later: nextMark }); } catch { /* best effort */ }
  }
  /** "Show result" fetches the answer from the server (which locks the answer);
   *  "Hide result" only collapses the box — the lock stays. */
  async function toggleReveal(qid: string) {
    const st = answers[qid];
    if (st?.shown) { patch(qid, { shown: false }); return; }
    if (st?.reveal) { patch(qid, { shown: true }); return; }
    try {
      const j = await jpost<{ reveal: Reveal | null }>("/api/pyq/attempt/answer", { attempt_id: attemptId, question_id: qid, reveal: true });
      if (j.reveal) patch(qid, { reveal: j.reveal, locked: true, shown: true });
    } catch (e) { toast((e as Error)?.message || "Couldn't load the result — check your connection."); }
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
  const numeric = q.qtype === "numeric";
  const multi = q.qtype === "multi";
  const answered = isAnswered(a);
  const locked = !!a?.locked;
  const rev = answered && !!a?.shown && !!a?.reveal;
  const correctKey = a?.reveal?.correct_key ?? null;
  const correctOpt = q.options.find((o) => o.key === correctKey);
  const correctKeys = a?.reveal?.correct_keys ?? [];
  // Single-answer: correct_key plus any other option the official key also accepts.
  const acceptKeys = multi ? correctKeys : [correctKey, ...correctKeys.filter((k) => k !== correctKey)].filter((k): k is string => !!k);
  const isKey = (k: string) => acceptKeys.includes(k);
  const partial = multi && isPartial(a?.reveal?.is_correct, a?.reveal?.awarded);
  const theory = isTheory(q);
  const scoredQs = questions.filter((qq) => !isTheory(qq));
  const nTheory = questions.length - scoredQs.length;
  const ansd = scoredQs.filter((qq) => isAnswered(answers[qq.id])).length;
  const mkd = questions.filter((qq) => answers[qq.id]?.marked_for_later).length;
  const N = questions.length;
  const left = scoredQs.length - ansd;
  // Section banner on the first question of each board-paper section.
  const newSection = !!q.section && (i === 0 || questions[i - 1].section !== q.section);
  const sectionNote = q.section ? paper.sections?.find((x) => x.name === q.section)?.note ?? null : null;
  const ansOpen = !!shownAns[q.id];
  // Palette groups: one block per section (a single unnamed block for entrance exams).
  const groups: { name: string | null; items: { qq: Question; idx: number }[] }[] = [];
  questions.forEach((qq, idx) => {
    const name = qq.section ?? null;
    const g = groups[groups.length - 1];
    if (g && g.name === name) g.items.push({ qq, idx }); else groups.push({ name, items: [{ qq, idx }] });
  });
  const paperMeta = [
    questionCountLabel({ total_questions: N, theory_questions: nTheory }),
    // Time / max marks are shown only for board papers (printed on the paper); entrance papers carry a placeholder duration.
    paper.max_marks && paper.duration_mins ? `Time: ${paper.duration_mins % 60 === 0 ? `${paper.duration_mins / 60} hours` : `${paper.duration_mins} min`}` : null,
    paper.max_marks ? `Max marks: ${fmtNum(paper.max_marks)}` : null,
    paperMarking(paper),
  ].filter(Boolean).join(" · ");

  return (
    <section className="screen">
      <div className="examhead">
        <button className="btn sm ghost backbtn" onClick={() => void leavePaper()} title="Leave now — your progress is saved">← Back</button>
        <div>
          <div className="nm">{fullPaperName(paper)}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{paperMeta}</div>
        </div>
        <span className="push" style={{ display: "flex", gap: 8 }}>
          {paper.instructions && (
            <button className="btn sm ghost" aria-expanded={showInstr} onClick={() => setShowInstr((v) => !v)}>
              {showInstr ? "Hide instructions" : "Instructions"}
            </button>
          )}
        </span>
      </div>

      {showInstr && paper.instructions && (
        <div className="instr panel">
          <h3>General Instructions</h3>
          <div className="instr-body"><MathText text={paper.instructions} /></div>
          <button className="btn sm" onClick={() => setShowInstr(false)}>Start reading the paper →</button>
        </div>
      )}

      <div className="exam">
        <div className="qcard panel">
          {newSection && (
            <div className="secbanner">
              <b>{q.section}</b>
              {sectionNote && <span>{sectionNote}</span>}
            </div>
          )}
          <div className="qtop">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {/* The number printed on the paper, so it matches the PDF and answer key. */}
              <span className="qno">Question {q.q_no}<span className="muted" style={{ fontWeight: 600, fontSize: 14 }}> · {i + 1} of {N}</span></span>
              {q.section && <span className="secpill">{q.section}</span>}
              {q.topic && <span className="topicpill">{q.topic}</span>}
              <span className="marks">{theory ? `${marksWord(q.marks_correct)} · read-only` : markLabel(q.marks_correct, q.marks_wrong)}</span>
            </div>
            <button className={`markbtn ${a?.marked_for_later ? "on" : ""}`} onClick={() => toggleMark(q.id)}>
              {a?.marked_for_later ? "★ Marked" : "☆ Mark for later"}
            </button>
          </div>

          <div className="stem"><MathText text={q.stem} /></div>
          <Fig src={q.stem_figure_url} alt={`Figure for question ${q.q_no}`} />
          {/* Internal choice, printed as "OR" in the board paper. */}
          {q.or_stem && (
            <>
              <div className="ordiv"><span>OR</span></div>
              <div className="stem"><MathText text={q.or_stem} /></div>
              <Fig src={q.or_stem_figure_url} alt={`Figure for the OR question ${q.q_no}`} />
            </>
          )}

          {theory ? (
            <>
              <div className="locknote">Read-only question — it isn&apos;t answered or scored here. Show the answer when you&apos;re ready.</div>
              {ansOpen && (
                <div className="resultbox theory">
                  <div className="hd">Answer (marking scheme)</div>
                  {q.solution ? <div className="sol"><MathText text={q.solution} /></div> : <div className="sol">No answer printed in the marking scheme.</div>}
                  <Fig src={q.solution_figure_url} alt={`Answer figure for question ${q.q_no}`} />
                  {q.or_stem && (q.or_solution || q.or_solution_figure_url) && (
                    <>
                      <div className="hd" style={{ marginTop: 12 }}>Answer to the OR question</div>
                      {q.or_solution && <div className="sol"><MathText text={q.or_solution} /></div>}
                      <Fig src={q.or_solution_figure_url} alt={`Answer figure for the OR question ${q.q_no}`} />
                    </>
                  )}
                </div>
              )}
            </>
          ) : numeric ? (
            <NumericAnswer key={q.id} value={a?.selected_value ?? null} locked={locked} onSave={(v) => saveValue(q.id, v)} />
          ) : (
            <>
              {multi && <div className="multinote">One or more options may be correct.</div>}
              <div className="opts">
                {q.options.map((o) => {
                  const sel = multi ? !!a?.selected_keys?.includes(o.key) : a?.selected_key === o.key;
                  let cls = "opt";
                  if (rev && isKey(o.key)) cls = "opt correct";
                  else if (rev && sel) cls = "opt wrong";
                  else if (sel) cls = "opt sel";
                  const ofig = q.option_figure_urls?.[o.key];
                  return (
                    <button key={o.key} className={cls} disabled={locked} aria-pressed={multi ? sel : undefined}
                      onClick={() => (multi ? toggleKey(q.id, o.key) : choose(q.id, o.key))}>
                      <span className="k">{o.key}</span>
                      <span className="otxt">
                        {o.text && <MathText text={o.text} />}
                        <Fig src={ofig} alt={`Option ${o.key}`} className="ofig" />
                      </span>
                      {rev && isKey(o.key) && <span className="tick" style={{ color: "var(--ok)" }}>✓ correct</span>}
                      {rev && sel && !isKey(o.key) && <span className="tick" style={{ color: "var(--bad)" }}>✗ your answer</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {!theory && <div className="locknote">
            {locked ? "Answer locked — you've seen the solution."
              : answered ? "You can change your answer until you view the result."
              : numeric ? "Enter your answer to enable “Show result”."
              : multi ? "Select one or more options to enable “Show result”."
              : "Select an option to enable “Show result”."}
          </div>}

          {!theory && rev && a?.reveal && (
            <div className="resultbox">
              {numeric && (
                <div className={`verdict ${a.reveal.is_correct ? "ok" : "no"}`}>
                  {a.reveal.is_correct ? "✓ Your answer is correct" : `✗ Your answer: ${fmtVal(a.selected_value)}`}
                </div>
              )}
              {multi && (
                <div className={`verdict ${a.reveal.is_correct ? "ok" : partial ? "part" : "no"}`}>
                  {a.reveal.is_correct ? "✓ Fully correct" : partial ? `◐ Partially correct (+${fmtNum(a.reveal.awarded)})` : "✗ Incorrect"}
                </div>
              )}
              <div className="hd">
                ✓ Correct answer: {numeric ? fmtVal(a.reveal.correct_value)
                  : multi || acceptKeys.length > 1 ? acceptKeys.map((k, n) => {
                    const o = q.options.find((x) => x.key === k);
                    return <span key={k}>{n > 0 && (multi ? ", " : " or ")}{k}{o?.text ? <>. <MathText text={o.text} /></> : null}</span>;
                  })
                  : <>{correctKey}{correctOpt?.text ? <>. <MathText text={correctOpt.text} /></> : null}</>}
              </div>
              {a.reveal.solution && <div className="sol"><MathText text={a.reveal.solution} /></div>}
              <Fig src={a.reveal.solution_figure_url} alt={`Solution figure for question ${q.q_no}`} />
            </div>
          )}

          <div className="qactions">
            <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>← Back to previous</button>
            {theory ? (
              <button className="btn ghost" aria-expanded={ansOpen} onClick={() => setShownAns((m) => ({ ...m, [q.id]: !m[q.id] }))}>
                {ansOpen ? "Hide answer" : "Show answer"}
              </button>
            ) : answered && (
              <button className="btn ghost" onClick={() => toggleReveal(q.id)}>{a?.shown ? "Hide result" : "Show result"}</button>
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
            {nTheory > 0 && <span><i className="lg t" />Read-only</span>}
          </div>
          {groups.map((g) => (
            <div key={g.name ?? "_"}>
              {g.name && <div className="palsec">{g.name}</div>}
              <div className="cells">
                {g.items.map(({ qq, idx }) => {
                  const st = answers[qq.id];
                  let c = "cell";
                  if (idx === i) c += " c";
                  if (isTheory(qq)) c += st?.marked_for_later ? " t m" : " t";
                  else if (isAnswered(st)) c += " a"; else if (st?.marked_for_later) c += " m";
                  return <button key={qq.id} className={c} onClick={() => setI(idx)} aria-label={`Question ${qq.q_no}`}>{qq.q_no}</button>;
                })}
              </div>
            </div>
          ))}
          <div className="countline"><span>Answered <b>{ansd}</b>{nTheory > 0 && <> / {scoredQs.length}</>}</span><span>Marked <b>{mkd}</b></span></div>
          <button className="btn primary sm" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} onClick={() => setConfirming(true)}>Submit test</button>
        </aside>
      </div>

      {confirming && (
        <div className="modal-bg" onClick={() => setConfirming(false)}>
          <div className="modal panel" role="dialog" aria-modal="true" aria-labelledby="pyq-submit-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="pyq-submit-title">Submit this paper?</h3>
            <p className="muted">
              You&apos;ve answered {ansd} of {scoredQs.length}.{" "}
              {left > 0 ? `${left} unanswered question${left === 1 ? "" : "s"} will score 0. ` : ""}
              {nTheory > 0 ? "The theory sections are for reading only and aren't scored. " : ""}
              You can&apos;t change answers after submitting.
            </p>
            <div className="mact">
              <button className="btn" autoFocus onClick={() => setConfirming(false)}>Keep attempting</button>
              <button className="btn primary" onClick={() => { setConfirming(false); void submit(); }}>Submit test</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Answer box for numeric (integer-type) questions. Saves on "Save answer" or Enter. */
function NumericAnswer({ value, locked, onSave }: { value: number | null; locked: boolean; onSave: (v: string) => void }) {
  const saved = value == null ? "" : String(value);
  const [draft, setDraft] = useState(saved);
  useEffect(() => { setDraft(saved); }, [saved]);
  const t = draft.trim().replace(/−/g, "-"); // accept a typographic minus too
  const valid = t === "" || NUMERIC_RE.test(t);
  const dirty = t !== saved;
  const save = () => { if (!locked && valid && dirty) onSave(t); };
  return (
    <div className="numans">
      <label htmlFor="pyq-numans">Your answer</label>
      <input id="pyq-numans" inputMode="decimal" autoComplete="off" placeholder="Enter a number"
        value={draft} disabled={locked} aria-invalid={!valid}
        onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      <button className="btn sm" disabled={locked || !valid || !dirty} onClick={save}>{saved && t === "" ? "Clear answer" : "Save answer"}</button>
      {!valid && <span className="err">Numbers only (e.g. 25, -3, 2.5)</span>}
    </div>
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

  if (failed) return <section className="screen"><div className="empty">{failed}</div><button className="btn" onClick={() => go(DASHBOARD)}>← Back to dashboard</button></section>;
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
        {p && theoryCount(p) > 0 && (
          <div className="muted" style={{ marginTop: 4, fontSize: 12.5 }}>Score covers the objective questions. The theory sections are read-only practice.</div>
        )}
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
          {data.review.map((r) => {
            const numeric = r.qtype === "numeric";
            const multi = r.qtype === "multi";
            const attempted = numeric ? r.selected_value != null : multi ? !!r.selected_keys?.length : r.selected_key != null;
            const got = r.is_correct === true;
            const part = multi && isPartial(r.is_correct, r.awarded);
            // An option shown back: letter, its text (as maths) and/or its figure.
            const optLabel = (key: string | null) => {
              if (!key) return "—";
              const o = r.options.find((x) => x.key === key);
              return <>{key}{o?.text ? <>. <MathText text={o.text} /></> : null}<Fig src={r.option_figure_urls?.[key]} alt={`Option ${key}`} className="ofig sm" /></>;
            };
            // Multi-answer: each chosen / correct option, comma-separated.
            const keysLabel = (keys?: string[] | null, sep = ", ") =>
              keys?.length ? keys.map((k, n) => <span key={k}>{n > 0 && sep}{optLabel(k)}</span>) : "—";
            // Single-answer where the official key accepts more than one option.
            const alts = !numeric && !multi && r.correct_keys?.length
              ? [r.correct_key, ...r.correct_keys.filter((k) => k !== r.correct_key)].filter((k): k is string => !!k)
              : null;
            return (
              <div key={r.id} className="rev">
                {r.topic && <div className="tp">{r.topic}</div>}
                <div className="q">Q{r.q_no}. <MathText text={r.stem} /></div>
                <Fig src={r.stem_figure_url} alt={`Figure for question ${r.q_no}`} />
                <div className="ans">
                  <span className={`y ${!attempted ? "" : got ? "ok" : part ? "part" : "no"}`}>
                    Your answer: {!attempted ? "Not attempted" : numeric ? fmtVal(r.selected_value) : multi ? keysLabel(r.selected_keys) : optLabel(r.selected_key)}
                    {attempted && ` (${Number(r.awarded) > 0 ? "+" : ""}${fmtNum(r.awarded)})`}
                  </span>
                  <span style={{ color: "var(--ok)" }}>Correct: {numeric ? fmtVal(r.correct_value) : multi ? keysLabel(r.correct_keys) : alts && alts.length > 1 ? keysLabel(alts, " or ") : optLabel(r.correct_key)}</span>
                </div>
                {r.solution && <div className="sol"><MathText text={r.solution} /></div>}
                <Fig src={r.solution_figure_url} alt={`Solution figure for question ${r.q_no}`} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="actions">
        {p && <button className="btn" onClick={() => go(`/pyq?paper=${p.id}`)}>↻ Re-attempt</button>}
        <button className="btn ghost" onClick={() => go(p ? `/pyq?view=papers&exam=${encodeURIComponent(p.exam)}` : "/pyq?view=papers")}>Next paper</button>
        <button className="btn primary" onClick={() => go(DASHBOARD)}>Back to dashboard</button>
      </div>
    </section>
  );
}
