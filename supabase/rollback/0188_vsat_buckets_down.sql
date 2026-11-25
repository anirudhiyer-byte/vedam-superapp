-- Rollback of 0188_vsat_buckets: puts back the 0098 body of vsat_settings_bands_set (same grants), drops the Buckets
-- functions and the vsat_bucket_sets table. A VSAT's own bands saved or copied (lock) from the Buckets page stay in
-- vsat_scholarship_bands as that VSAT's bands (they are ordinary per-VSAT bands); lock and ARPU target go with the table.

create or replace function public.vsat_settings_bands_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_campus text; v_date uuid; old jsonb; n int; b jsonb; i int; prev_min numeric; cat int;
  mn numeric; mx numeric; st numeric; a0 numeric; a1 numeric; new_set jsonb := '[]'::jsonb;
begin
  perform public.vsat__settings_admin();
  perform public.vsat__check_keys(p, array['exam_date_id', 'campus', 'bands']);
  v_campus := p->>'campus';
  if v_campus is null or v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  if p ? 'exam_date_id' and jsonb_typeof(p->'exam_date_id') not in ('string', 'null') then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end if;
  begin v_date := nullif(p->>'exam_date_id', '')::uuid; exception when others then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end;
  if v_date is not null and not exists (select 1 from public.vsat_exam_dates d where d.id = v_date) then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end if;
  if jsonb_typeof(p->'bands') is distinct from 'array' then raise exception 'BAD_VALUE: bands' using errcode = '22023'; end if;
  n := jsonb_array_length(p->'bands');
  if n = 0 and v_date is null then raise exception 'BAD_BANDS: the default set cannot be empty' using errcode = '22023'; end if;
  if n > 8 then raise exception 'BAD_BANDS: at most 8 categories' using errcode = '22023'; end if;

  -- categories 1..n in order, top band ends at 100, each band starts where the next one (lower) ends, last starts at 0
  for i in 0 .. n - 1 loop
    b := (select e from jsonb_array_elements(p->'bands') with ordinality x(e, o) order by (e->>'category')::numeric nulls last, o offset i limit 1);
    perform public.vsat__check_keys(b, array['category', 'min_score', 'max_score', 'steps', 'min_award', 'max_award']);
    cat := public.vsat__settings_num(b, 'category', 1, 8, true)::int;
    if cat <> i + 1 then raise exception 'BAD_BANDS: categories must be 1 to % in order', n using errcode = '22023'; end if;
    mn := public.vsat__settings_num(b, 'min_score', 0, 100, true);
    mx := public.vsat__settings_num(b, 'max_score', 0, 100, true);
    st := public.vsat__settings_num(b, 'steps', 1, 10, true);
    a0 := public.vsat__settings_num(b, 'min_award', 0, 100, true);
    a1 := public.vsat__settings_num(b, 'max_award', 0, 100, true);
    if st <> trunc(st) then raise exception 'BAD_BANDS: steps must be a whole number' using errcode = '22023'; end if;
    if mn >= mx then raise exception 'BAD_BANDS: category % score range', cat using errcode = '22023'; end if;
    if a0 > a1 then raise exception 'BAD_BANDS: category % award range', cat using errcode = '22023'; end if;
    if i = 0 and mx <> 100 then raise exception 'BAD_BANDS: category 1 must end at 100' using errcode = '22023'; end if;
    if i > 0 and mx <> prev_min then raise exception 'BAD_BANDS: category % must end where category % starts', cat, cat - 1 using errcode = '22023'; end if;
    if i = n - 1 and mn <> 0 then raise exception 'BAD_BANDS: the last category must start at 0' using errcode = '22023'; end if;
    prev_min := mn;
    new_set := new_set || jsonb_build_object('category', cat, 'min_score', mn, 'max_score', mx, 'steps', st::int, 'min_award', a0, 'max_award', a1);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('category', x.category, 'min_score', x.min_score, 'max_score', x.max_score, 'steps', x.steps,
                                               'min_award', x.min_award, 'max_award', x.max_award) order by x.category), '[]'::jsonb)
    into old from public.vsat_scholarship_bands x where x.campus = v_campus and x.exam_date_id is not distinct from v_date;
  delete from public.vsat_scholarship_bands x where x.campus = v_campus and x.exam_date_id is not distinct from v_date;
  insert into public.vsat_scholarship_bands (exam_date_id, campus, category, min_score, max_score, steps, min_award, max_award)
  select v_date, v_campus, (e->>'category')::int, (e->>'min_score')::numeric, (e->>'max_score')::numeric, (e->>'steps')::int,
         (e->>'min_award')::numeric, (e->>'max_award')::numeric
    from jsonb_array_elements(new_set) e;
  perform public.vsat__settings_log('bands', v_campus || ':' || coalesce(v_date::text, 'default'), old, new_set);
  return jsonb_build_object('ok', true, 'categories', n);
end $$;

drop function if exists public.vsat_buckets_lock(jsonb);
drop function if exists public.vsat_buckets_save(jsonb);
drop function if exists public.vsat_buckets_suggest(jsonb);
drop function if exists public.vsat_buckets_preview(jsonb);
drop function if exists public.vsat_buckets_get(jsonb);
drop function if exists public.vsat__bucket_args(jsonb, text[]);
drop function if exists public.vsat__bucket_viewer();
drop function if exists public.vsat__bucket_arpu(uuid, text, jsonb);
drop function if exists public.vsat__bucket_pct(numeric, jsonb, numeric, int, boolean);
drop function if exists public.vsat__bucket_cat(numeric, jsonb);
drop function if exists public.vsat__bucket_pop(uuid, text);
drop function if exists public.vsat__calc_safe(jsonb, text, uuid);
drop function if exists public.vsat__bands_in_use(text, uuid);
drop function if exists public.vsat__bands_check(jsonb, boolean);
drop table if exists public.vsat_bucket_sets;
