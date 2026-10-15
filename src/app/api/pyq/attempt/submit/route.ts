import { NextResponse } from "next/server";
import { svc, requireUser, grade, QUESTION_COLS } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TopicStat = { topic: string; correct: number; attempted: number; total: number; pct: number };

/** POST /api/pyq/attempt/submit  { attempt_id, duration_secs? }
 *  Authoritatively (re)grades every question from the saved answers, writes the
 *  attempt summary + topic breakdown, and returns the full result for the
 *  review screen. Grading here is deterministic and server-side — the client
 *  score is never trusted. */
export async function POST(req: Request) {
  const gate = await requireUser();
  if (!gate.ok) return gate.res;
  const b = await req.json().catch(() => ({}));
  const attemptId = b.attempt_id as string | undefined;
  if (!attemptId) return NextResponse.json({ error: "attempt_id is required" }, { status: 400 });

  const db = svc();
  const { data: att } = await db.from("pyq_attempts").select("id, user_id, paper_id, status, started_at").eq("id", attemptId).maybeSingle();
  if (!att || att.user_id !== gate.userId) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });

  const { data: qRows } = await db
    .from("pyq_questions")
    .select(QUESTION_COLS)
    .eq("paper_id", att.paper_id).order("q_no", { ascending: true });
  const questions = (qRows ?? []) as Array<Record<string, unknown>>;

  const { data: aRows } = await db
    .from("pyq_answers")
    .select("question_id, selected_key, selected_value, selected_keys, marked_for_later, revealed")
    .eq("attempt_id", attemptId);
  const answerByQ = new Map<string, { selected_key: string | null; selected_value: number | null; selected_keys: string[] | null; marked_for_later: boolean; revealed: boolean }>();
  for (const a of (aRows ?? [])) answerByQ.set(a.question_id as string, a as never);

  let score = 0, maxScore = 0, correct = 0, wrong = 0, unattempted = 0;
  const topics = new Map<string, TopicStat>();
  const review = questions.map((q) => {
    const a = answerByQ.get(q.id as string);
    const g = grade(
      { qtype: q.qtype as string, correct_key: (q.correct_key as string) ?? null, correct_value: (q.correct_value as number) ?? null, correct_keys: (q.correct_keys as string[]) ?? null, marks_correct: q.marks_correct as number, marks_wrong: q.marks_wrong as number },
      a?.selected_key ?? null, a?.selected_value ?? null, a?.selected_keys ?? null
    );
    maxScore += Number(q.marks_correct ?? 4);
    score += g.awarded;
    // A partially-correct multi-answer (is_correct false) counts as wrong here; its partial marks are in `score`.
    if (!g.attempted) unattempted++;
    else if (g.is_correct) correct++;
    else wrong++;

    const topic = (q.topic as string) || "General";
    const t = topics.get(topic) ?? { topic, correct: 0, attempted: 0, total: 0, pct: 0 };
    t.total++;
    if (g.attempted) { t.attempted++; if (g.is_correct) t.correct++; } // fully correct only
    topics.set(topic, t);

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

  const topicBreakdown = Array.from(topics.values()).map((t) => ({
    ...t, pct: t.total ? Math.round((t.correct / t.total) * 100) : 0,
  })).sort((a, b) => b.pct - a.pct);

  const attempted = correct + wrong;
  const accuracy = attempted ? Math.round((correct / attempted) * 1000) / 10 : 0;
  const durationSecs = Number.isFinite(Number(b.duration_secs)) ? Math.max(0, Math.floor(Number(b.duration_secs))) : null;

  const { error: upErr } = await db.from("pyq_attempts").update({
    status: "submitted", submitted_at: new Date().toISOString(), duration_secs: durationSecs,
    score, max_score: maxScore, correct, wrong, unattempted, accuracy, topic_breakdown: topicBreakdown,
  }).eq("id", attemptId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({
    attempt_id: attemptId,
    summary: { score, max_score: maxScore, correct, wrong, unattempted, attempted, accuracy, duration_secs: durationSecs },
    topic_breakdown: topicBreakdown,
    review,
  });
}
