-- PYQ: real exam marking schemes
--
-- Real papers use fractional and exam-specific marking:
--   JEE Main        +4 / -1
--   WBJEE           Category 1: +1 / -0.25, Category 2: +2 / -0.5
--   MHT-CET (PCM)   no negative marking; Physics/Chemistry +1, Mathematics +2
--   CBSE Class 12   Section A objective: +1, no negative marking
-- Marks were integers in 0014, which can't hold -0.25 / -0.5. Switch every
-- marks/score column to numeric, and add a human-readable marking note per
-- paper so the picker can show the real scheme (mixed schemes like WBJEE
-- can't be expressed as a single +x / -y pair).

alter table public.pyq_papers
  alter column marks_correct type numeric,
  alter column marks_wrong   type numeric;
alter table public.pyq_papers add column if not exists marking_note text;

alter table public.pyq_questions
  alter column marks_correct type numeric,
  alter column marks_wrong   type numeric;

alter table public.pyq_attempts
  alter column score     type numeric,
  alter column max_score type numeric;
