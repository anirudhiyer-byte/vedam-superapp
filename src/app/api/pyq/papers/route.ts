import { NextResponse } from "next/server";
import { svc, requireUser, type PaperRow } from "@/lib/pyq/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/pyq/papers
 *  The published paper catalogue for the picker, grouped exam → subject → year.
 *  Returns only non-sensitive metadata (never questions). */
export async function GET() {
  const gate = await requireUser();
  if (!gate.ok) return gate.res;

  const { data, error } = await svc()
    .from("pyq_papers")
    .select("id, exam, subject, year, set_label, title, duration_mins, marks_correct, marks_wrong, total_questions, is_published, sort_order")
    .eq("is_published", true)
    .gt("total_questions", 0)
    .order("exam", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("year", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const papers = (data ?? []) as PaperRow[];
  const exams = Array.from(new Set(papers.map((p) => p.exam)));
  return NextResponse.json({ papers, exams });
}
