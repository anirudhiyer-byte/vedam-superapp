-- PYQ multi-answer questions (WBJEE Category 3: one or more options correct).
-- Apply to staging (kyhakenhbgcissmaacws) first, then production BEFORE
-- deploying the code that selects these columns.
--   pyq_questions.qtype         – now also 'multi'
--   pyq_questions.correct_keys  – e.g. {A,C}; the answer key for qtype 'multi'
--   pyq_answers.selected_keys   – the candidate's selection, deduped + sorted;
--                                 stored as NULL (never '{}') when nothing is
--                                 selected, so "answered" = selected_keys is not null
-- Marking is graded in src/lib/pyq/api.ts grade(): exactly the correct set →
-- marks_correct; any wrong option → marks_wrong (0 for WBJEE Cat 3); a correct
-- but incomplete selection → marks_correct × chosen / total correct.

alter table public.pyq_questions add column if not exists correct_keys text[];
alter table public.pyq_answers   add column if not exists selected_keys text[];

-- Widen the qtype check. 0014 declared it inline, so Postgres named it
-- pyq_questions_qtype_check; the name is still looked up from the catalog (any
-- check constraint on exactly the qtype column) and dropped via EXECUTE.
-- Re-running drops and re-adds the same constraint (idempotent).
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
    check (qtype in ('mcq','numeric','multi'));
end $$;
