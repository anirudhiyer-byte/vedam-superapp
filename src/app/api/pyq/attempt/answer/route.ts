import { NextResponse } from "next/server";
import { svc, requireUser, grade } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/pyq/attempt/answer
 *  { attempt_id, question_id, selected_key?, selected_value?, marked_for_later?, reveal? }
 *
 *  Upserts the answer row for one question. When a selection is present the
 *  server grades it and — only then — returns the correct key + solution, so
 *  the "Show result" affordance can appear for an attempted question and never
 *  before. `marked_for_later` and selection can be sent independently. */
export async function POST(req: Request) {
  const gate = await requireUser();
  if (!gate.ok) return gate.res;
  const b = await req.json().catch(() => ({}));
  const attemptId = b.attempt_id as string | undefined;
  const questionId = b.question_id as string | undefined;
  if (!attemptId || !questionId) return NextResponse.json({ error: "attempt_id and question_id are required" }, { status: 400 });

  const db = svc();

  // Ownership + state check.
  const { data: att } = await db.from("pyq_attempts").select("id, user_id, status, paper_id").eq("id", attemptId).maybeSingle();
  if (!att || att.user_id !== gate.userId) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  if (att.status !== "in_progress") return NextResponse.json({ error: "Attempt already submitted" }, { status: 409 });

  // The question must belong to this attempt's paper.
  const { data: q } = await db
    .from("pyq_questions")
    .select("id, paper_id, qtype, correct_key, correct_value, solution, marks_correct, marks_wrong")
    .eq("id", questionId).maybeSingle();
  if (!q) return NextResponse.json({ error: "Question not found" }, { status: 404 });
  if (att.paper_id !== q.paper_id) return NextResponse.json({ error: "Question not in this paper" }, { status: 400 });

  const selectedKey = (b.selected_key ?? null) as string | null;
  const selectedValue = b.selected_value === undefined || b.selected_value === null || b.selected_value === ""
    ? null : Number(b.selected_value);

  // Preserve prior values when a field isn't being changed this call.
  const { data: prior } = await db
    .from("pyq_answers")
    .select("selected_key, selected_value, marked_for_later, revealed")
    .eq("attempt_id", attemptId).eq("question_id", questionId).maybeSingle();

  const hasSelectionField = "selected_key" in b || "selected_value" in b;
  const finalKey = hasSelectionField ? selectedKey : (prior?.selected_key ?? null);
  const finalValue = hasSelectionField ? selectedValue : (prior?.selected_value ?? null);
  const marked = "marked_for_later" in b ? !!b.marked_for_later : (prior?.marked_for_later ?? false);
  const revealed = b.reveal === true ? true : (prior?.revealed ?? false);

  const g = grade(q, finalKey, finalValue);

  const { error: upErr } = await db.from("pyq_answers").upsert({
    attempt_id: attemptId,
    question_id: questionId,
    selected_key: finalKey,
    selected_value: finalValue,
    marked_for_later: marked,
    is_correct: g.attempted ? g.is_correct : null,
    awarded: g.attempted ? g.awarded : null,
    revealed,
    answered_at: new Date().toISOString(),
  }, { onConflict: "attempt_id,question_id" });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Reveal the answer only for an attempted question.
  const reveal = g.attempted
    ? { correct_key: q.correct_key, correct_value: q.correct_value, solution: q.solution, is_correct: g.is_correct, awarded: g.awarded }
    : null;

  return NextResponse.json({ ok: true, attempted: g.attempted, marked_for_later: marked, reveal });
}
