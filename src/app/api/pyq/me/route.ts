import { NextResponse } from "next/server";
import { svc, requireUser } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAPER_EMBED = "paper:pyq_papers(id, exam, subject, year, set_label, title, marks_correct, marks_wrong, marking_note, total_questions)";

/** GET /api/pyq/me — the returning-user PYQ Dashboard (S3).
 *  { name, in_progress: {attempt_id, paper, answered, total} | null,
 *    attempts: [{attempt_id, paper, submitted_at, score, max_score}],
 *    stats: { papers_attempted, avg_accuracy } } */
export async function GET() {
  const gate = await requireUser();
  if (!gate.ok) return gate.res;
  const db = svc();

  const { data: prof } = await db.from("profiles").select("full_name").eq("id", gate.userId).maybeSingle();

  const { data: atts, error } = await db
    .from("pyq_attempts")
    .select(`id, paper_id, status, score, max_score, accuracy, submitted_at, created_at, ${PAPER_EMBED}`)
    .eq("user_id", gate.userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = atts ?? [];

  // Most recent unfinished attempt → "Resume in progress".
  const open = rows.find((a) => a.status === "in_progress");
  let inProgress: { attempt_id: string; paper: unknown; answered: number; total: number } | null = null;
  if (open) {
    const { count } = await db
      .from("pyq_answers")
      .select("question_id", { count: "exact", head: true })
      .eq("attempt_id", open.id)
      .not("selected_key", "is", null);
    const paper = open.paper as unknown as { total_questions?: number } | null;
    inProgress = { attempt_id: open.id, paper: open.paper, answered: count ?? 0, total: Number(paper?.total_questions ?? 0) };
  }

  const submitted = rows.filter((a) => a.status === "submitted");
  const attempts = submitted.slice(0, 20).map((a) => ({
    attempt_id: a.id,
    paper: a.paper,
    submitted_at: a.submitted_at,
    score: Number(a.score ?? 0),
    max_score: Number(a.max_score ?? 0),
  }));

  const accs = submitted.map((a) => Number(a.accuracy)).filter((n) => Number.isFinite(n));
  const stats = {
    papers_attempted: new Set(submitted.map((a) => a.paper_id)).size,
    avg_accuracy: accs.length ? Math.round(accs.reduce((x, y) => x + y, 0) / accs.length) : null,
  };

  return NextResponse.json({ name: prof?.full_name ?? null, in_progress: inProgress, attempts, stats });
}
