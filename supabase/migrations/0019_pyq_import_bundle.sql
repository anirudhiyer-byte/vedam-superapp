-- PYQ bulk loader: upsert one paper "bundle" (paper metadata + questions) as
-- produced by the transcription pipeline. Used by an admin from the SQL editor:
--   1) select net.http_get('https://raw.githubusercontent.com/<owner>/<repo>/<commit>/bundles/<paper>.json');
--   2) select public.pyq_import_bundle(content::jsonb, '<figure base url>')
--        from net._http_response where id = <request id>;
-- Figures are stored as bare file names in the bundle and turned into URLs with
-- the given base (e.g. https://<project>.supabase.co/storage/v1/object/public/pyq-figures/pyq_figures/),
-- so the same bundle loads into staging and production.
-- Idempotent: the paper is matched on (exam, subject, year, set_label) and each
-- question on (paper_id, q_no); re-importing updates in place, so attempt
-- history keeps pointing at the same question rows. Questions are never deleted here.
-- Not callable by app users (execute revoked from anon/authenticated).

create or replace function public.pyq_import_bundle(b jsonb, figure_base text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  p   jsonb := b->'paper';
  q   jsonb;
  pid uuid;
  n   int := 0;
  fig_url text;
  opt_figs jsonb;
begin
  if p is null or p->>'exam' is null or p->>'subject' is null or p->>'year' is null then
    raise exception 'bundle.paper needs exam, subject, year';
  end if;

  select id into pid from pyq_papers
   where exam = p->>'exam' and subject = p->>'subject' and year = (p->>'year')::int
     and set_label is not distinct from (p->>'set_label')
   order by created_at limit 1;

  if pid is null then
    insert into pyq_papers (exam, subject, year, set_label, title, marks_correct, marks_wrong, marking_note,
                            instructions, sections, duration_mins, max_marks, sort_order, source_file_id, is_published)
    values (p->>'exam', p->>'subject', (p->>'year')::int, p->>'set_label', p->>'title',
            coalesce((p->>'marks_correct')::numeric, 4), coalesce((p->>'marks_wrong')::numeric, 0), p->>'marking_note',
            p->>'instructions', p->'sections', coalesce((p->>'duration_mins')::int, 60), (p->>'max_marks')::numeric,
            coalesce((p->>'sort_order')::int, 0), p->>'source_file_id', coalesce((p->>'is_published')::boolean, true))
    returning id into pid;
  else
    update pyq_papers set
      title = coalesce(p->>'title', title),
      marks_correct = coalesce((p->>'marks_correct')::numeric, marks_correct),
      marks_wrong = coalesce((p->>'marks_wrong')::numeric, marks_wrong),
      marking_note = coalesce(p->>'marking_note', marking_note),
      instructions = coalesce(p->>'instructions', instructions),
      sections = coalesce(p->'sections', sections),
      duration_mins = coalesce((p->>'duration_mins')::int, duration_mins),
      max_marks = coalesce((p->>'max_marks')::numeric, max_marks),
      sort_order = coalesce((p->>'sort_order')::int, sort_order),
      source_file_id = coalesce(p->>'source_file_id', source_file_id),
      is_published = coalesce((p->>'is_published')::boolean, is_published),
      updated_at = now()
    where id = pid;
  end if;

  for q in select value from jsonb_array_elements(coalesce(b->'questions', '[]'::jsonb)) loop
    select coalesce(jsonb_object_agg(o->>'key', figure_base || (o->>'figure')), null)
      into opt_figs
      from jsonb_array_elements(coalesce(q->'options', '[]'::jsonb)) o
     where nullif(o->>'figure', '') is not null;

    insert into pyq_questions as t (
      paper_id, q_no, topic, qtype, section, stem, options, correct_key, correct_value, correct_keys, solution,
      marks_correct, marks_wrong, stem_figure_url, solution_figure_url, option_figure_urls,
      or_stem, or_stem_figure_url, or_solution, or_solution_figure_url)
    values (
      pid, (q->>'q_no')::int, q->>'topic', q->>'qtype', q->>'section', q->>'stem',
      coalesce((select jsonb_agg(jsonb_build_object('key', o->>'key', 'text', coalesce(o->>'text', '')))
                  from jsonb_array_elements(coalesce(q->'options', '[]'::jsonb)) o), '[]'::jsonb),
      q->>'correct_key', (q->>'correct_value')::numeric,
      case when jsonb_typeof(q->'correct_keys') = 'array'
           then array(select jsonb_array_elements_text(q->'correct_keys')) end,
      q->>'solution', (q->>'marks_correct')::numeric, (q->>'marks_wrong')::numeric,
      figure_base || nullif(q->>'stem_figure', ''), figure_base || nullif(q->>'solution_figure', ''), opt_figs,
      q->>'or_stem', figure_base || nullif(q->>'or_stem_figure', ''), q->>'or_solution', figure_base || nullif(q->>'or_solution_figure', ''))
    on conflict (paper_id, q_no) do update set
      topic = excluded.topic, qtype = excluded.qtype, section = excluded.section, stem = excluded.stem,
      options = excluded.options, correct_key = excluded.correct_key, correct_value = excluded.correct_value,
      correct_keys = excluded.correct_keys, solution = excluded.solution,
      marks_correct = excluded.marks_correct, marks_wrong = excluded.marks_wrong,
      stem_figure_url = excluded.stem_figure_url, solution_figure_url = excluded.solution_figure_url,
      option_figure_urls = excluded.option_figure_urls, or_stem = excluded.or_stem,
      or_stem_figure_url = excluded.or_stem_figure_url, or_solution = excluded.or_solution,
      or_solution_figure_url = excluded.or_solution_figure_url;
    n := n + 1;
  end loop;

  update pyq_papers set
    total_questions = (select count(*) from pyq_questions x where x.paper_id = pid),
    theory_questions = (select count(*) from pyq_questions x where x.paper_id = pid and x.qtype = 'theory')
  where id = pid;

  return jsonb_build_object('paper_id', pid, 'upserted', n,
    'total', (select total_questions from pyq_papers where id = pid));
end $$;

revoke all on function public.pyq_import_bundle(jsonb, text) from public;
revoke all on function public.pyq_import_bundle(jsonb, text) from anon, authenticated;

-- Token for the pyq-figure-sync Edge Function (figures from the pyq-data branch
-- into the pyq-figures bucket). Lives in a schema the API does not expose; the
-- function checks it via pyq_check_sync_token (service_role only).
create schema if not exists private_pyq;
revoke all on schema private_pyq from public, anon, authenticated;
create table if not exists private_pyq.sync_token (token text not null);
insert into private_pyq.sync_token (token)
  select encode(gen_random_bytes(24), 'hex') where not exists (select 1 from private_pyq.sync_token);

create or replace function public.pyq_check_sync_token(t text)
returns boolean language sql stable security definer set search_path = private_pyq, public as $$
  select exists (select 1 from private_pyq.sync_token where token = t and length(t) >= 32);
$$;
revoke all on function public.pyq_check_sync_token(text) from public, anon, authenticated;
grant execute on function public.pyq_check_sync_token(text) to service_role;
