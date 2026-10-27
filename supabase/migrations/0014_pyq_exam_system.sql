-- PYQ (Previous Year Questions) Exam System
--
-- MCQ-type interactive attempt module, integrated into Vedam One as a shell
-- section (like CodeSprint / College Predictor). Four new tables, additive only
-- — nothing here touches existing tables. Correct answers and solutions live in
-- pyq_questions, which is LOCKED to the service role: the attempt API serves
-- sanitised questions and only reveals the answer for a question the candidate
-- has already attempted (mirrors the approved prototype's "Show result" rule).
--
-- Source of truth for content: the Vedam PYQ Drive (JEE / WBJEE / MHT-CET /
-- Board), ingested paper-by-paper. source_file_id keeps the Drive provenance.

-- 1) Papers -------------------------------------------------------------------
create table if not exists public.pyq_papers (
  id              uuid primary key default gen_random_uuid(),
  exam            text not null,                 -- 'JEE Main' | 'WBJEE' | 'MHT-CET' | 'Board'
  subject         text not null,                 -- 'Physics' | 'Chemistry' | 'Mathematics' | 'Computer Science' | 'PCM'
  year            integer not null,
  set_label       text,                          -- e.g. '23 Jan · Shift 1', 'April 16 · Shift 2'
  title           text not null,                 -- display title
  duration_mins   integer not null default 60,
  marks_correct   integer not null default 4,
  marks_wrong     integer not null default -1,
  total_questions integer not null default 0,    -- denormalised count, kept in sync by the ingest/seed
  source_file_id  text,                          -- Google Drive file id (provenance)
  is_published    boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 2) Questions (answers live here — service role only) ------------------------
create table if not exists public.pyq_questions (
  id            uuid primary key default gen_random_uuid(),
  paper_id      uuid not null references public.pyq_papers(id) on delete cascade,
  q_no          integer not null,
  topic         text,                            -- chapter/topic tag, drives the result analysis
  qtype         text not null default 'mcq' check (qtype in ('mcq','numeric')),
  stem          text not null,
  options       jsonb not null default '[]'::jsonb,  -- [{"key":"A","text":"..."}, ...] (mcq)
  correct_key   text,                            -- 'A'|'B'|'C'|'D' (mcq)
  correct_value numeric,                         -- numeric-answer questions
  solution      text,
  marks_correct integer not null default 4,
  marks_wrong   integer not null default -1,
  created_at    timestamptz not null default now(),
  unique (paper_id, q_no)
);

-- 3) Attempts -----------------------------------------------------------------
create table if not exists public.pyq_attempts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  paper_id        uuid not null references public.pyq_papers(id) on delete cascade,
  status          text not null default 'in_progress' check (status in ('in_progress','submitted')),
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  duration_secs   integer,
  score           integer,
  max_score       integer,
  correct         integer,
  wrong           integer,
  unattempted     integer,
  accuracy        numeric,
  topic_breakdown jsonb,                          -- [{"topic","correct","total","pct"}]
  created_at      timestamptz not null default now()
);

-- 4) Answers (one row per question per attempt) -------------------------------
create table if not exists public.pyq_answers (
  id               uuid primary key default gen_random_uuid(),
  attempt_id       uuid not null references public.pyq_attempts(id) on delete cascade,
  question_id      uuid not null references public.pyq_questions(id) on delete cascade,
  selected_key     text,
  selected_value   numeric,
  marked_for_later boolean not null default false,
  is_correct       boolean,
  awarded          numeric,
  revealed         boolean not null default false, -- candidate used "Show result" on this question
  answered_at      timestamptz not null default now(),
  unique (attempt_id, question_id)
);

-- Indexes ---------------------------------------------------------------------
create index if not exists pyq_papers_catalogue_idx on public.pyq_papers (is_published, exam, subject, year);
create index if not exists pyq_questions_paper_idx   on public.pyq_questions (paper_id, q_no);
create index if not exists pyq_attempts_user_idx     on public.pyq_attempts (user_id, created_at desc);
create index if not exists pyq_attempts_paper_idx    on public.pyq_attempts (paper_id);
create index if not exists pyq_answers_attempt_idx   on public.pyq_answers (attempt_id);

-- RLS -------------------------------------------------------------------------
-- The attempt API uses the service-role client for every read/write, so the
-- default posture is "service role only". The one concession is read access to
-- the PUBLISHED paper catalogue for signed-in users (harmless — titles only).
alter table public.pyq_papers    enable row level security;
alter table public.pyq_questions enable row level security;
alter table public.pyq_attempts  enable row level security;
alter table public.pyq_answers   enable row level security;

revoke all on public.pyq_papers    from anon, authenticated;
revoke all on public.pyq_questions from anon, authenticated;
revoke all on public.pyq_attempts  from anon, authenticated;
revoke all on public.pyq_answers   from anon, authenticated;

grant all on public.pyq_papers    to service_role;
grant all on public.pyq_questions to service_role;
grant all on public.pyq_attempts  to service_role;
grant all on public.pyq_answers   to service_role;

-- Signed-in users may read the published catalogue (for the paper picker).
grant select on public.pyq_papers to authenticated;
drop policy if exists pyq_papers_read_published on public.pyq_papers;
create policy pyq_papers_read_published on public.pyq_papers
  for select to authenticated using (is_published = true);

-- Everything else: no anon/authenticated policies => service role only.
