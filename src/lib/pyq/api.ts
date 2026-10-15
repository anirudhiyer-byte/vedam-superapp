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
  title: string; marks_correct: number; marks_wrong: number; marking_note: string | null;
  total_questions: number; is_published: boolean; sort_order: number;
};

/** Columns every paper response carries (marks are numeric — WBJEE uses −0.25/−0.5). */
export const PAPER_COLS =
  "id, exam, subject, year, set_label, title, marks_correct, marks_wrong, marking_note, total_questions, is_published, sort_order";

export type QOption = { key: string; text: string };

/** Every question column the PYQ routes read. Figure URLs point at the public
 *  `pyq-figures` Storage bucket; the solution figure is answer material and is
 *  only ever sent alongside the solution (reveal / review), never with the question. */
export const QUESTION_COLS =
  "id, q_no, topic, qtype, stem, options, correct_key, correct_value, correct_keys, solution, marks_correct, marks_wrong, stem_figure_url, solution_figure_url, option_figure_urls";

/** 'multi' = one or more options correct (WBJEE Category 3), answered with selected_keys. */
export type QType = "mcq" | "numeric" | "multi";

/** Question as sent to the browser DURING an attempt — no answer/solution. */
export type QuestionPublic = {
  id: string; q_no: number; topic: string | null; qtype: QType;
  stem: string; options: QOption[]; marks_correct: number; marks_wrong: number;
  stem_figure_url: string | null; option_figure_urls: Record<string, string> | null;
};

/** Full question including the answer — only ever returned for a question whose
 *  result the candidate has chosen to see (reveal), or after the attempt is submitted. */
export type QuestionFull = QuestionPublic & {
  correct_key: string | null; correct_value: number | null; correct_keys: string[] | null;
  solution: string | null; solution_figure_url: string | null;
};

/** The answer payload shown by "Show result" (and restored on resume). */
export function revealOf(q: Record<string, unknown>) {
  return {
    correct_key: (q.correct_key as string) ?? null,
    correct_value: q.correct_value == null ? null : Number(q.correct_value),
    correct_keys: q.qtype === "multi" ? ((q.correct_keys as string[]) ?? null) : null,
    solution: (q.solution as string) ?? null,
    solution_figure_url: (q.solution_figure_url as string) ?? null,
  };
}

export type AnswerRow = {
  question_id: string; selected_key: string | null; selected_value: number | null; selected_keys: string[] | null;
  marked_for_later: boolean; is_correct: boolean | null; awarded: number | null; revealed: boolean;
};

/** A multi-answer selection as stored: deduped, sorted (case-sensitive), and
 *  NULL — never [] — when empty, so "answered" is just `selected_keys is not null`. */
export function normKeys(keys: readonly string[] | null | undefined): string[] | null {
  if (!keys || keys.length === 0) return null;
  return Array.from(new Set(keys)).sort();
}

/** Same multi-answer selection? Compares the normalised (sorted) arrays. */
export function sameKeys(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const x = normKeys(a) ?? [], y = normKeys(b) ?? [];
  return x.length === y.length && x.every((k, i) => k === y[i]);
}

export function sanitizeQuestion(q: Record<string, unknown>): QuestionPublic {
  return {
    id: q.id as string,
    q_no: q.q_no as number,
    topic: (q.topic as string) ?? null,
    qtype: (q.qtype as QType) ?? "mcq",
    stem: q.stem as string,
    options: (q.options as QOption[]) ?? [],
    marks_correct: Number(q.marks_correct ?? 4),
    marks_wrong: Number(q.marks_wrong ?? -1),
    stem_figure_url: (q.stem_figure_url as string) ?? null,
    option_figure_urls: (q.option_figure_urls as Record<string, string>) ?? null,
  };
}

/** Parse a numeric-answer entry. undefined → field not sent; null → cleared;
 *  NaN → invalid input (caller rejects). */
export function parseValue(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(typeof v === "string" ? v.trim() : v);
  return Number.isFinite(n) ? n : NaN;
}

/** Grade one selection against a question. Returns null awarded when unattempted.
 *  Multi-answer ('multi', graded on selected_keys): any wrong option → marks_wrong;
 *  exactly the correct set → marks_correct; a non-empty strict subset of the
 *  correct set → partial credit marks_correct × |S| / |C| (is_correct false). */
export function grade(
  q: { qtype: string; correct_key: string | null; correct_value: number | null; correct_keys?: string[] | null; marks_correct: number; marks_wrong: number },
  selected_key: string | null,
  selected_value: number | null,
  selected_keys: string[] | null = null
): { attempted: boolean; is_correct: boolean | null; awarded: number } {
  if (q.qtype === "multi") {
    const S = normKeys(selected_keys);
    if (!S) return { attempted: false, is_correct: null, awarded: 0 };
    const C = new Set(q.correct_keys ?? []);
    if (S.some((k) => !C.has(k))) return { attempted: true, is_correct: false, awarded: Number(q.marks_wrong) };
    if (S.length === C.size) return { attempted: true, is_correct: true, awarded: Number(q.marks_correct) };
    return { attempted: true, is_correct: false, awarded: (Number(q.marks_correct) * S.length) / C.size };
  }
  const hasSel = q.qtype === "numeric" ? selected_value != null : !!selected_key;
  if (!hasSel) return { attempted: false, is_correct: null, awarded: 0 };
  const correct = q.qtype === "numeric"
    ? selected_value != null && q.correct_value != null && Number(selected_value) === Number(q.correct_value)
    : selected_key === q.correct_key;
  // Number(): numeric columns must never be summed as strings.
  return { attempted: true, is_correct: correct, awarded: Number(correct ? q.marks_correct : q.marks_wrong) };
}
