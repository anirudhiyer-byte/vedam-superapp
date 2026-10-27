-- PYQ lock-down (fixes from the pre-production review).
-- 1) No app code reads PYQ tables with a user's own login — every read and write goes through
--    the service role in /api/pyq/*. So logged-in users get no direct table access at all:
--    the published catalogue (titles, instructions, source file ids) is no longer readable via
--    the Supabase REST API with the public key, and staging's leftover broad grants are removed.
--    The catalogue policy from 0014 is neutralised (matches no rows) rather than dropped.
revoke all on public.pyq_papers, public.pyq_questions, public.pyq_attempts, public.pyq_answers from anon, authenticated;
alter policy pyq_papers_read_published on public.pyq_papers using (false);

-- 2) Figures: a public bucket serves its public URLs without any storage.objects policy; the
--    read policy from 0016 only added the ability to LIST the bucket. Neutralise it so nobody
--    can enumerate the files (figure links keep working).
alter policy "pyq figures public read" on storage.objects using (false);
