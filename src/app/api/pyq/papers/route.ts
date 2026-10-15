import { NextResponse } from "next/server";
import { createClient as createServer } from "@/lib/supabase/server";
import { svc, PAPER_COLS, type PaperRow } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MyStatus = {
  in_progress_id: string | null;
  last: { attempt_id: string; score: number; max_score: number; submitted_at: string } | null;
};

/** GET /api/pyq/papers
 *  The published paper catalogue (metadata only — never questions or answers).
 *  Public, so the logged-out landing (S1) can show the exam tiles. When the
 *  caller is signed in, each paper also carries `my`: their in-progress attempt
 *  (for "Resume") and their latest submitted score (for "Score x/y · Re-attempt"). */
export async function GET() {
  const sb = await createServer();
  const { data: { user } } = await sb.auth.getUser();
  const db = svc();

  const { data, error } = await db
    .from("pyq_papers")
    .select(PAPER_COLS)
    .eq("is_published", true)
    .gt("total_questions", 0)
    .order("exam", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("year", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const papers = (data ?? []) as PaperRow[];

  const my = new Map<string, MyStatus>();
  if (user) {
    const { data: atts } = await db
      .from("pyq_attempts")
      .select("id, paper_id, status, score, max_score, submitted_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    for (const a of atts ?? []) {
      const s = my.get(a.paper_id) ?? { in_progress_id: null, last: null };
      if (a.status === "in_progress" && !s.in_progress_id) s.in_progress_id = a.id;
      if (a.status === "submitted" && !s.last) {
        s.last = { attempt_id: a.id, score: Number(a.score ?? 0), max_score: Number(a.max_score ?? 0), submitted_at: a.submitted_at };
      }
      my.set(a.paper_id, s);
    }
  }

  return NextResponse.json({
    signed_in: !!user,
    papers: papers.map((p) => ({ ...p, my: my.get(p.id) ?? null })),
  });
}
