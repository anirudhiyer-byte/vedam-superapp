-- 0164 · Store the mock launch date separately from the real exam date.
--
-- The real VSAT is tied to a fixed exam date (vsat_exam_dates); the mock is taken on a rolling
-- window, usually on a different day. Wheebox keys its result lookup by date, so the mock bulk
-- pull needs the day the student actually sat the mock, not the exam-date anchor.
--
-- /api/vsat/exam/launch writes this on every mock launch (latest wins); the mock branch of
-- /api/vsat/exam/bulk-pull-result uses it as the per-student date anchor, falling back to the
-- exam date when it's null (e.g. mocks taken before this column existed).
-- Rollback: supabase/rollback/0164_mock_launched_at_down.sql

alter table public.application_manager add column if not exists mock_launched_at timestamptz;
comment on column public.application_manager.mock_launched_at is
  'When the student most recently launched the mock test (set by /api/vsat/exam/launch). Wheebox result-date anchor for the mock bulk pull, independent of the real exam date.';
