-- PYQ: board-paper format (read-only theory sections) + resume point.
-- Apply to staging (kyhakenhbgcissmaacws) first, then production BEFORE
-- deploying the code that selects these columns. Idempotent.
--
-- Board papers (CBSE) are shown like the real paper: general instructions,
-- Sections A–E, marks per question, internal "OR" choices. Section A is
-- answerable and scored; theory questions (qtype 'theory') are read-only —
-- the candidate reads the question and can show/hide the marking-scheme answer.
-- Theory questions are never graded and never count towards the score.
--
--   pyq_questions.qtype            – now also 'theory'
--   pyq_questions.section          – e.g. 'Section B' (null for entrance exams)
--   pyq_questions.or_stem / or_solution (+ figures)
--                                  – the internal-choice alternative ("OR")
--   pyq_papers.instructions        – the paper's General Instructions
--   pyq_papers.sections            – [{"name":"Section B","note":"… 2 marks each"}]
--   pyq_papers.duration_mins / max_marks – as printed on the paper
--   pyq_papers.theory_questions    – how many questions are read-only theory
--   pyq_attempts.last_question_id  – where the candidate left off (resume point)

alter table public.pyq_questions add column if not exists section text;
alter table public.pyq_questions add column if not exists or_stem text;
alter table public.pyq_questions add column if not exists or_stem_figure_url text;
alter table public.pyq_questions add column if not exists or_solution text;
alter table public.pyq_questions add column if not exists or_solution_figure_url text;

alter table public.pyq_papers add column if not exists instructions text;
alter table public.pyq_papers add column if not exists sections jsonb;
alter table public.pyq_papers add column if not exists duration_mins integer;
alter table public.pyq_papers add column if not exists max_marks numeric;
alter table public.pyq_papers add column if not exists theory_questions integer not null default 0;

alter table public.pyq_attempts add column if not exists last_question_id uuid
  references public.pyq_questions(id) on delete set null;

-- Widen the qtype check (same catalog-driven drop as 0017).
do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attname = 'qtype'
    where c.conrelid = 'public.pyq_questions'::regclass
      and c.contype = 'c'
      and c.conkey = array[a.attnum]
  loop
    execute format('alter table public.pyq_questions drop constraint %I', r.conname);
  end loop;
  alter table public.pyq_questions add constraint pyq_questions_qtype_check
    check (qtype in ('mcq','numeric','multi','theory'));
end $$;
