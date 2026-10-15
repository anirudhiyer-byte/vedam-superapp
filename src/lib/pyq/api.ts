import { NextResponse } from "next/server";
import { createClient as createServer } from "@/lib/supabase/server";
import { createClient as createSvc } from "@supabase/supabase-js";

/** Service-role Supabase client — bypasses RLS; server-only.
 *  Every PYQ read/write goes through this: pyq_questions holds the correct
 *  answers and solutions and is locked to the service role, so answers are
 *  never exposed to the browser except through the sanitising routes below. */
export function svc() {
  return createSvc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** Gate: a signed-in Vedam One user. The PYQ shell page is additionally
 *  admin-gated pre-launch (like College Predictor); this guard is the
 *  future-proof floor for when the module goes public. */
export async function requireUser(): Promise<
  { ok: true; userId: string; email: string } | { ok: false; res: NextResponse }
> {
  const sb = await createServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  return { ok: true, userId: user.id, email: (user.email ?? "").toLowerCase() };
}

// ---- Shapes -----------------------------------------------------------------
export type PaperRow = {
  id: string; exam: string; subject: string; year: number; set_label: string | null;
  title: string; duration_mins: number; marks_correct: number; marks_wrong: number;
  total_questions: number; is_published: boolean; sort_order: number;
};

export type QOption = { key: string; text: string };

/** Question as sent to the browser DURING an attempt — no answer/solution. */
export type QuestionPublic = {
  id: string; q_no: number; topic: string | null; qtype: "mcq" | "numeric";
  stem: string; options: QOption[]; marks_correct: number; marks_wrong: number;
};

/** Full question including the answer — only ever returned for a question the
 *  candidate has already attempted (reveal), or after the attempt is submitted. */
export type QuestionFull = QuestionPublic & {
  correct_key: string | null; correct_value: number | null; solution: string | null;
};

export type AnswerRow = {
  question_id: string; selected_key: string | null; selected_value: number | null;
  marked_for_later: boolean; is_correct: boolean | null; awarded: number | null; revealed: boolean;
};

export function sanitizeQuestion(q: Record<string, unknown>): QuestionPublic {
  return {
    id: q.id as string,
    q_no: q.q_no as number,
    topic: (q.topic as string) ?? null,
    qtype: (q.qtype as "mcq" | "numeric") ?? "mcq",
    stem: q.stem as string,
    options: (q.options as QOption[]) ?? [],
    marks_correct: (q.marks_correct as number) ?? 4,
    marks_wrong: (q.marks_wrong as number) ?? -1,
  };
}

/** Grade one selection against a question. Returns null awarded when unattempted. */
export function grade(
  q: { qtype: string; correct_key: string | null; correct_value: number | null; marks_correct: number; marks_wrong: number },
  selected_key: string | null,
  selected_value: number | null
): { attempted: boolean; is_correct: boolean | null; awarded: number } {
  const hasSel = q.qtype === "numeric" ? selected_value != null : !!selected_key;
  if (!hasSel) return { attempted: false, is_correct: null, awarded: 0 };
  const correct = q.qtype === "numeric"
    ? selected_value != null && q.correct_value != null && Number(selected_value) === Number(q.correct_value)
    : selected_key === q.correct_key;
  return { attempted: true, is_correct: correct, awarded: correct ? q.marks_correct : q.marks_wrong };
}
