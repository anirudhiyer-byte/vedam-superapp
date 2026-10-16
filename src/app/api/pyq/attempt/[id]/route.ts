import { NextResponse } from "next/server";
import { svc, requireUser, grade, isScored, PAPER_COLS, QUESTION_COLS } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/pyq/attempt/[id]
 *  Owner-only. Returns a submitted attempt's stored summary + topic breakdown,
 *  plus a freshly-built review (questions with correct answers, solutions and
 *  the candidate's selections). Used by the result screen and history. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (!gate.ok) return gate.res;
  const { id } = await ctx.params;

  const db = svc();
  const { data: att } = await db
    .from("pyq_attempts")
    .select("id, user_id, paper_id, status, started_at, submitted_at, duration_secs, score, max_score, correct, wrong, unattempted, accuracy, topic_breakdown")
    .eq("id", id).maybeSingle();
  if (!att || att.user_id !== gate.userId) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });

  const { data: paper } = await db
    .from("pyq_papers")
    .select(PAPER_COLS)
    .eq("id", att.paper_id).maybeSingle();

  const { data: qRows } = await db
    .from("pyq_questions")
    .select(QUESTION_COLS)
    .eq("paper_id", att.paper_id).order("q_no", { ascending: true });

  const { data: aRows } = await db
    .from("pyq_answers")
    .select("question_id, selected_key, selected_value, selected_keys, marked_for_later")
    .eq("attempt_id", id);
  const answerByQ = new Map<string, { selected_key: string | null; selected_value: number | null; selected_keys: string[] | null; marked_for_later: boolean }>();
  for (const a of (aRows ?? [])) answerByQ.set(a.question_id as string, a as never);

  const review = (qRows ?? []).filter((q) => isScored(q.qtype)).map((q) => {
    const a = answerByQ.get(q.id as string);
    const g = grade(
      { qtype: q.qtype as string, correct_key: (q.correct_key as string) ?? null, correct_value: (q.correct_value as number) ?? null, correct_keys: (q.correct_keys as string[]) ?? null, marks_correct: q.marks_correct as number, marks_wrong: q.marks_wrong as number },
      a?.selected_key ?? null, a?.selected_value ?? null, a?.selected_keys ?? null
    );
    return {
      id: q.id, q_no: q.q_no, topic: q.topic, qtype: q.qtype, stem: q.stem, options: q.options,
      correct_key: q.correct_key, correct_value: q.correct_value == null ? null : Number(q.correct_value), solution: q.solution,
      correct_keys: (q.correct_keys as string[]) ?? null,
      stem_figure_url: q.stem_figure_url ?? null, solution_figure_url: q.solution_figure_url ?? null, option_figure_urls: q.option_figure_urls ?? null,
      selected_key: a?.selected_key ?? null, selected_value: a?.selected_value == null ? null : Number(a.selected_value),
      selected_keys: a?.selected_keys ?? null,
      marked_for_later: a?.marked_for_later ?? false,
      is_correct: g.attempted ? g.is_correct : null, awarded: g.attempted ? g.awarded : 0,
    };
  });

  const attempted = (att.correct ?? 0) + (att.wrong ?? 0);
  return NextResponse.json({
    attempt_id: att.id,
    status: att.status,
    paper,
    summary: {
      score: att.score, max_score: att.max_score, correct: att.correct, wrong: att.wrong,
      unattempted: att.unattempted, attempted, accuracy: att.accuracy, duration_secs: att.duration_secs,
    },
    topic_breakdown: att.topic_breakdown ?? [],
    review,
  });
}
