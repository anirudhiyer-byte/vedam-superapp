import { NextResponse } from "next/server";
import { svc, requireUser } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/pyq/attempt/position  { attempt_id, question_id }
 *  Remembers the question the candidate is on, so leaving the paper (Back) and
 *  coming back later resumes at the same question. Owner-only, in-progress only. */
export async function POST(req: Request) {
  const gate = await requireUser();
  if (!gate.ok) return gate.res;
  const b = await req.json().catch(() => ({}));
  const attemptId = b.attempt_id as string | undefined;
  const questionId = b.question_id as string | undefined;
  if (!attemptId || !questionId) return NextResponse.json({ error: "attempt_id and question_id are required" }, { status: 400 });

  const db = svc();
  const { data: att } = await db.from("pyq_attempts").select("id, user_id, status, paper_id").eq("id", attemptId).maybeSingle();
  if (!att || att.user_id !== gate.userId) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  if (att.status !== "in_progress") return NextResponse.json({ ok: true, ignored: true });

  const { data: q } = await db.from("pyq_questions").select("id, paper_id").eq("id", questionId).maybeSingle();
  if (!q || q.paper_id !== att.paper_id) return NextResponse.json({ error: "Question not in this paper" }, { status: 400 });

  const { error } = await db.from("pyq_attempts").update({ last_question_id: questionId }).eq("id", attemptId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
