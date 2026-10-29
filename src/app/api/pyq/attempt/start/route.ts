import { NextResponse } from "next/server";
import { svc, requireUser, sanitizeQuestion, revealOf, PAPER_COLS, QUESTION_COLS, type AnswerRow } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "bom1"; // same region as the staging database (ap-south-1)

/** POST /api/pyq/attempt/start  { paper_id, session_id? }  (session_id links the attempt to the visitor's browser session)
 *  Resumes the user's open attempt for this paper, or creates a new one.
 *  Returns the paper, the sanitised questions (no answers), and — for a
 *  resumed attempt — the saved answer state. Only for questions whose result the
 *  candidate already chose to see are the correct answer, solution and grading
 *  included (so "Show result" restores); an answered-but-unrevealed question
 *  carries no hint of whether it is right. */
export async function POST(req: Request) {
  const gate = await requireUser();
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  const paperId = body.paper_id as string | undefined;
  if (!paperId) return NextResponse.json({ error: "paper_id is required" }, { status: 400 });

  const db = svc();

  // Profile-complete gate: a student must finish their profile before starting a
  // test. Admins (@vedam.org) are exempt so they can keep testing pre-launch.
  if (!gate.email.endsWith("@vedam.org")) {
    const { data: prof } = await db
      .from("profiles").select("profile_completed").eq("id", gate.userId).maybeSingle();
    if (!prof?.profile_completed) {
      return NextResponse.json(
        { error: "Please complete your profile to start a test.", code: "profile_incomplete" },
        { status: 403 },
      );
    }
  }

  const { data: paper, error: pErr } = await db
    .from("pyq_papers")
    .select(PAPER_COLS)
    .eq("id", paperId).maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!paper || !paper.is_published) return NextResponse.json({ error: "Paper not found" }, { status: 404 });

  const { data: qRows, error: qErr } = await db
    .from("pyq_questions")
    .select(QUESTION_COLS)
    .eq("paper_id", paperId).order("q_no", { ascending: true });
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  const questions = (qRows ?? []).map(sanitizeQuestion);

  // Resume an in-progress attempt, else create one.
  const { data: open } = await db
    .from("pyq_attempts")
    .select("id, started_at, last_question_id, session_id")
    .eq("user_id", gate.userId).eq("paper_id", paperId).eq("status", "in_progress")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  // An attempt opened before session tracking existed has no browser id yet: fill it in on resume
  // (never overwrite one that is already set).
  const sessionId = typeof body.session_id === "string" ? body.session_id.slice(0, 64) : null;
  if (open && !open.session_id && sessionId) {
    await db.from("pyq_attempts").update({ session_id: sessionId }).eq("id", open.id).is("session_id", null);
  }

  let attemptId = open?.id as string | undefined;
  let startedAt = open?.started_at as string | undefined;
  const lastQuestionId = (open?.last_question_id as string | null | undefined) ?? null;
  if (!attemptId) {
    const { data: created, error: cErr } = await db
      .from("pyq_attempts")
      .insert({ user_id: gate.userId, paper_id: paperId, status: "in_progress", session_id: typeof body.session_id === "string" ? body.session_id.slice(0, 64) : null })
      .select("id, started_at").single();
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    attemptId = created.id; startedAt = created.started_at;
  }

  // Saved answers (for resume). Attach reveal payload where already answered/revealed.
  const { data: aRows } = await db
    .from("pyq_answers")
    .select("question_id, selected_key, selected_value, selected_keys, marked_for_later, is_correct, awarded, revealed")
    .eq("attempt_id", attemptId);
  const answers = (aRows ?? []) as AnswerRow[];

  const qById = new Map<string, Record<string, unknown>>();
  for (const q of (qRows ?? []) as Array<Record<string, unknown>>) qById.set(q.id as string, q);
  const hidden = { correct_key: null, correct_value: null, correct_keys: null, solution: null, solution_figure_url: null };
  const answerState = answers.map((a) => {
    const q = a.revealed ? qById.get(a.question_id) : undefined;
    return {
      ...a,
      selected_value: a.selected_value == null ? null : Number(a.selected_value),
      selected_keys: a.selected_keys ?? null,
      is_correct: q ? a.is_correct : null,
      awarded: q && a.awarded != null ? Number(a.awarded) : null,
      ...(q ? revealOf(q) : hidden),
    };
  });

  return NextResponse.json({
    attempt_id: attemptId,
    started_at: startedAt,
    last_question_id: lastQuestionId,
    paper,
    questions,
    answers: answerState,
  });
}
