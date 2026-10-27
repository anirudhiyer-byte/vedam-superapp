-- PYQ promotion (staging -> production). STAGING DATABASE ONLY.
-- Exports papers in the exact bundle format that public.pyq_import_bundle (0019) reads, with
-- figures as bare file names, so production can load the very rows that were checked on staging
-- (git bundles on the pyq-data branch do not include every later staging fix or paper).
-- Called only by the token-guarded `pyq-export` Edge Function with the service role.

create or replace function public.pyq_export_list()
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'exam', exam, 'subject', subject, 'year', year,
                                              'set_label', set_label, 'total_questions', total_questions)
                            order by exam, year, subject, set_label), '[]'::jsonb)
  from pyq_papers where is_published;
$$;

create or replace function public.pyq_export_bundles(p_ids uuid[])
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    -- `sections` is the only jsonb paper field: leave the key out when it is SQL NULL, so the
    -- importer stores SQL NULL (a JSON null value would be stored as JSON 'null').
    'paper', jsonb_build_object(
      'exam', p.exam, 'subject', p.subject, 'year', p.year, 'set_label', p.set_label, 'title', p.title,
      'marks_correct', p.marks_correct, 'marks_wrong', p.marks_wrong, 'marking_note', p.marking_note,
      'instructions', p.instructions, 'duration_mins', p.duration_mins,
      'max_marks', p.max_marks, 'sort_order', p.sort_order, 'source_file_id', p.source_file_id,
      'is_published', p.is_published)
      || case when p.sections is null then '{}'::jsonb else jsonb_build_object('sections', p.sections) end,
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'q_no', q.q_no, 'topic', q.topic, 'qtype', q.qtype, 'section', q.section, 'stem', q.stem,
        'options', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'key', o->>'key', 'text', o->>'text',
                   'figure', regexp_replace(q.option_figure_urls->>(o->>'key'), '^.*/', ''))
                 order by ord), '[]'::jsonb)
          from jsonb_array_elements(q.options) with ordinality t(o, ord)),
        'correct_key', q.correct_key, 'correct_value', q.correct_value, 'correct_keys', to_jsonb(q.correct_keys),
        'solution', q.solution, 'marks_correct', q.marks_correct, 'marks_wrong', q.marks_wrong,
        'stem_figure', regexp_replace(q.stem_figure_url, '^.*/', ''),
        'solution_figure', regexp_replace(q.solution_figure_url, '^.*/', ''),
        'or_stem', q.or_stem, 'or_stem_figure', regexp_replace(q.or_stem_figure_url, '^.*/', ''),
        'or_solution', q.or_solution, 'or_solution_figure', regexp_replace(q.or_solution_figure_url, '^.*/', ''))
        order by q.q_no), '[]'::jsonb)
      from pyq_questions q where q.paper_id = p.id))
    order by p.exam, p.year, p.subject, p.set_label), '[]'::jsonb)
  from pyq_papers p
  where p.id = any(p_ids) and p.is_published;
$$;

revoke all on function public.pyq_export_list() from public, anon, authenticated;
revoke all on function public.pyq_export_bundles(uuid[]) from public, anon, authenticated;
grant execute on function public.pyq_export_list() to service_role;
grant execute on function public.pyq_export_bundles(uuid[]) to service_role;
