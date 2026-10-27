import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { createClient as createServer } from "@/lib/supabase/server";
import { svc, type PaperRow } from "@/lib/pyq/api";
import { canUsePyq } from "@/lib/pyq/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "bom1"; // same region as the staging database (ap-south-1)

type MyStatus = {
  in_progress_id: string | null;
  last: { attempt_id: string; score: number; max_score: number; submitted_at: string } | null;
};

/** Catalogue columns. The long board-paper `instructions` and `sections` are left out:
 *  the picker and landing never show them (the attempt screen gets them from
 *  /attempt/start), and they made this payload ~10x bigger. */
const CATALOGUE_COLS =
  "id, exam, subject, year, set_label, title, marks_correct, marks_wrong, marking_note, total_questions, is_published, sort_order, duration_mins, max_marks, theory_questions";

/** The published catalogue is the same for everyone and changes only when papers are
 *  loaded, so it is cached for 2 minutes instead of being read from the DB on every visit. */
const getCatalogue = unstable_cache(
  async (): Promise<PaperRow[]> => {
    const { data, error } = await svc()
      .from("pyq_papers")
      .select(CATALOGUE_COLS)
      .eq("is_published", true)
      .gt("total_questions", 0)
      .order("exam", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("year", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PaperRow[];
  },
  ["pyq-catalogue-v1"],
  { revalidate: 120, tags: ["pyq-catalogue"] },
);

/** GET /api/pyq/papers
 *  The published paper catalogue (metadata only — never questions or answers).
 *  Public, so the logged-out landing (S1) can show the exam tiles. When the
 *  caller is signed in, each paper also carries `my`: their in-progress attempt
 *  (for "Resume") and their latest submitted score (for "Score x/y · Re-attempt"). */
export async function GET() {
  const sb = await createServer();
  // Sign-in check and the (cached) catalogue run together.
  let papers: PaperRow[];
  let user;
  try {
    const [auth, cat] = await Promise.all([sb.auth.getUser(), getCatalogue()]);
    user = auth.data.user;
    papers = cat;
  } catch (e) {
    console.error("[pyq/papers] catalogue failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not load papers" }, { status: 500 });
  }
  // Pre-launch lock: on production the catalogue is for admins only (see lib/pyq/access).
  if (!(await canUsePyq(sb, user))) return NextResponse.json({ error: "PYQ is not available yet" }, { status: 403 });

  const my = new Map<string, MyStatus>();
  if (user) {
    const { data: atts } = await svc()
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
