import { NextResponse } from "next/server";
import { svc, requireUser, grade, revealOf, parseValue } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/pyq/attempt/answer
 *  { attempt_id, question_id, selected_key?, selected_value?, marked_for_later?, reveal? }
 *
 *  Upserts the answer row for one question and grades it server-side.
 *  - `selected_key` answers an MCQ; `selected_value` answers a numeric question
 *    (null / "" clears it).
 *  - The correct answer + solution are returned ONLY when the candidate asks to
 *    see the result (`reveal: true`) on an attempted question, or already did so.
 *    Choosing an option never returns the answer.
 *  - Once the result has been seen, the answer is locked: a changed selection
 *    gets 409, so a candidate can't peek at the solution and then switch.
 *  `marked_for_later` can be sent on its own. */
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
    .select("id, paper_id, qtype, correct_key, correct_value, solution, solution_figure_url, marks_correct, marks_wrong")
    .eq("id", questionId).maybeSingle();
  if (!q) return NextResponse.json({ error: "Question not found" }, { status: 404 });
  if (att.paper_id !== q.paper_id) return NextResponse.json({ error: "Question not in this paper" }, { status: 400 });

  const parsedValue = parseValue(b.selected_value);
  if (Number.isNaN(parsedValue)) return NextResponse.json({ error: "Enter a number" }, { status: 400 });
  const selectedKey = (b.selected_key ?? null) as string | null;

  // Preserve prior values when a field isn't being changed this call.
  const { data: prior } = await db
    .from("pyq_answers")
    .select("selected_key, selected_value, marked_for_later, revealed")
    .eq("attempt_id", attemptId).eq("question_id", questionId).maybeSingle();

  const priorKey = (prior?.selected_key ?? null) as string | null;
  const priorValue = prior?.selected_value == null ? null : Number(prior.selected_value);
  const hasSelectionField = "selected_key" in b || "selected_value" in b;
  const finalKey = hasSelectionField ? selectedKey : priorKey;
  const finalValue = hasSelectionField ? (parsedValue ?? null) : priorValue;
  const marked = "marked_for_later" in b ? !!b.marked_for_later : (prior?.marked_for_later ?? false);
  const wasRevealed = prior?.revealed ?? false;

  // Locked after "Show result".
  if (wasRevealed && hasSelectionField && (finalKey !== priorKey || finalValue !== priorValue)) {
    return NextResponse.json({ error: "Your answer is locked because you've seen the solution" }, { status: 409 });
  }

  const g = grade(q, finalKey, finalValue);
  if (b.reveal === true && !g.attempted) {
    return NextResponse.json({ error: "Answer the question to see the result" }, { status: 400 });
  }
  const revealed = wasRevealed || (b.reveal === true && g.attempted);

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

  const reveal = revealed && g.attempted
    ? { ...revealOf(q), is_correct: g.is_correct, awarded: g.awarded }
    : null;

  return NextResponse.json({ ok: true, attempted: g.attempted, marked_for_later: marked, revealed, reveal });
}
