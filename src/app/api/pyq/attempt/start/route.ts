import { NextResponse } from "next/server";
import { svc, requireUser, sanitizeQuestion, PAPER_COLS, type AnswerRow } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/pyq/attempt/start  { paper_id }
 *  Resumes the user's open attempt for this paper, or creates a new one.
 *  Returns the paper, the sanitised questions (no answers), and — for a
 *  resumed attempt — the saved answer state. For questions the candidate had
 *  already attempted or revealed, the correct key + solution are included so
 *  the client can restore the "Show result" state (mirrors the prototype). */
export async function POST(req: Request) {
  const gate = await requireUser();
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  const paperId = body.paper_id as string | undefined;
  if (!paperId) return NextResponse.json({ error: "paper_id is required" }, { status: 400 });

  const db = svc();

  const { data: paper, error: pErr } = await db
    .from("pyq_papers")
    .select(PAPER_COLS)
    .eq("id", paperId).maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!paper || !paper.is_published) return NextResponse.json({ error: "Paper not found" }, { status: 404 });

  const { data: qRows, error: qErr } = await db
    .from("pyq_questions")
    .select("id, q_no, topic, qtype, stem, options, correct_key, correct_value, solution, marks_correct, marks_wrong")
    .eq("paper_id", paperId).order("q_no", { ascending: true });
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  const questions = (qRows ?? []).map(sanitizeQuestion);

  // Resume an in-progress attempt, else create one.
  const { data: open } = await db
    .from("pyq_attempts")
    .select("id, started_at")
    .eq("user_id", gate.userId).eq("paper_id", paperId).eq("status", "in_progress")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();

  let attemptId = open?.id as string | undefined;
  let startedAt = open?.started_at as string | undefined;
  if (!attemptId) {
    const { data: created, error: cErr } = await db
      .from("pyq_attempts")
      .insert({ user_id: gate.userId, paper_id: paperId, status: "in_progress" })
      .select("id, started_at").single();
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    attemptId = created.id; startedAt = created.started_at;
  }

  // Saved answers (for resume). Attach reveal payload where already answered/revealed.
  const { data: aRows } = await db
    .from("pyq_answers")
    .select("question_id, selected_key, selected_value, marked_for_later, is_correct, awarded, revealed")
    .eq("attempt_id", attemptId);
  const answers = (aRows ?? []) as AnswerRow[];

  const keyById = new Map<string, { correct_key: string | null; solution: string | null }>();
  for (const q of (qRows ?? []) as Array<Record<string, unknown>>) {
    keyById.set(q.id as string, { correct_key: (q.correct_key as string) ?? null, solution: (q.solution as string) ?? null });
  }
  const answerState = answers.map((a) => {
    const attempted = a.selected_key != null || a.selected_value != null;
    const reveal = (attempted || a.revealed) ? keyById.get(a.question_id) : undefined;
    return { ...a, correct_key: reveal?.correct_key ?? null, solution: reveal?.solution ?? null };
  });

  return NextResponse.json({
    attempt_id: attemptId,
    started_at: startedAt,
    paper,
    questions,
    answers: answerState,
  });
}
