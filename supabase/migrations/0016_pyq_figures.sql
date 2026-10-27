-- PYQ figures: per-question figure URLs + public Storage bucket.
-- Applied to staging (kyhakenhbgcissmaacws) on 2026-10-15. Apply to production
-- BEFORE deploying the code that selects these columns.
--   stem_figure_url      – diagram printed with the question
--   solution_figure_url  – diagram in the solution (sent only with the answer)
--   option_figure_urls   – {"A": url, …} for options that are drawings

alter table public.pyq_questions add column if not exists stem_figure_url text;
alter table public.pyq_questions add column if not exists solution_figure_url text;
alter table public.pyq_questions add column if not exists option_figure_urls jsonb;

insert into storage.buckets (id, name, public)
values ('pyq-figures', 'pyq-figures', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pyq figures public read') then
    create policy "pyq figures public read" on storage.objects for select using (bucket_id = 'pyq-figures');
  end if;
end $$;
