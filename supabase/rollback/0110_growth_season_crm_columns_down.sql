-- Rollback 0110 · puts back the 0108 bodies of growth__season_cols, growth__season_rows and growth_season_drill.
-- growth__season_ids (0109) and growth_season_counts are not touched by 0110 or by this rollback.

create or replace function public.growth__season_cols(p_kind text)
returns text[] language sql immutable set search_path to '' as $fn$
  select case when p_kind = 'leads' then array[
      'public_id','name','email','phone','city','state','campus','education','stream','passing_year','school','source',
      'utm_source','utm_medium','utm_campaign','channel','stage','status','owner','created']
    when p_kind in ('paid', 'enrolled') then array[
      'public_id','application_no','name','email','phone','gender','city','state','campus','program','education','stream',
      'class12_pct','jee_percentile','form_status','vsat_registered','exam_date','exam_given','exam_percentile','vps_score',
      'scholarship_pct','offer_status','paid_at','paid_amount','payment_ref','enrollment_stage','enrolled_at','enrollment_amount',
      'utm_source','utm_medium','utm_campaign','owner','created']
    end;
$fn$;

create or replace function public.growth__season_rows(p_kind text, p_from date, p_to date, p_exam date)
returns table (lead_id uuid, r jsonb)
language plpgsql stable security definer set search_path to '' as $fn$
begin
  if p_kind = 'leads' then
    return query
      select lm.lead_id, jsonb_build_object(
        'public_id', lm.public_id, 'name', lm.registered_name, 'email', lm.registered_email, 'phone', lm.registered_mobile,
        'city', lm.city, 'state', lm.state, 'campus', lm.campus_preference, 'education', lm.current_education_level,
        'stream', lm.class_12_stream, 'passing_year', lm.passing_year, 'school', lm.school_name, 'source', lm.lead_source,
        'utm_source', lm.utm_source, 'utm_medium', lm.utm_medium, 'utm_campaign', lm.utm_campaign,
        'channel', lm.primary_traffic_channel, 'stage', lm.lead_stage::text, 'status', lm.lead_status, 'owner', lm.lead_owner,
        'created', to_char(lm.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'))
      from public.lead_manager lm
      where lm.lead_id in (select i from public.growth__season_ids('leads', p_from, p_to, p_exam) i);
  else
    return query
      select lm.lead_id, jsonb_build_object(
        'public_id', lm.public_id, 'application_no', am.application_no,
        'name', coalesce(am.registered_name, lm.registered_name), 'email', coalesce(am.registered_email, lm.registered_email),
        'phone', coalesce(am.registered_mobile, lm.registered_mobile), 'gender', coalesce(am.gender, lm.gender),
        'city', coalesce(am.city, lm.city), 'state', coalesce(am.state, lm.state),
        'campus', coalesce(am.campus_applied, lm.campus_preference), 'program', am.program,
        'education', coalesce(am.current_education_level, lm.current_education_level),
        'stream', coalesce(am.class_12_stream, lm.class_12_stream), 'class12_pct', am.class12_percentage,
        'jee_percentile', coalesce(am.jee_percentile, lm.jee_percentile), 'form_status', am.form_status,
        'vsat_registered', am.vsat_registered, 'exam_date', ed.exam_date::text, 'exam_given', am.exam_given,
        'exam_percentile', am.exam_percentile, 'vps_score', am.vps_score, 'scholarship_pct', am.scholarship_percentage,
        'offer_status', am.offer_status,
        'paid_at', to_char(vp.paid_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'), 'paid_amount', vp.amount, 'payment_ref', vp.payment_ref,
        'enrollment_stage', am.enrollment_stage,
        'enrolled_at', to_char(coalesce(am.enrollment_paid_at, am.last_updated_date) at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'),
        'enrollment_amount', am.enrollment_amount,
        'utm_source', lm.utm_source, 'utm_medium', lm.utm_medium, 'utm_campaign', lm.utm_campaign,
        'owner', coalesce(am.application_owner, lm.lead_owner),
        'created', to_char(lm.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'))
      from public.lead_manager lm
      left join lateral (select a.* from public.application_manager a where a.lead_id = lm.lead_id
                          order by (a.enrollment_stage = 'approved') desc, a.last_updated_date desc nulls last limit 1) am on true
      left join public.vsat_exam_dates ed on ed.id = am.exam_date_id
      left join lateral (select min(x.paid_at) paid_at, (array_agg(x.amount order by x.paid_at))[1] amount, (array_agg(x.payment_ref order by x.paid_at))[1] payment_ref
                           from public.vsat_payments x where x.lead_id = lm.lead_id) vp on true
      where lm.lead_id in (select i from public.growth__season_ids(p_kind, p_from, p_to, p_exam) i);
  end if;
end $fn$;

create or replace function public.growth_season_drill(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  w record; v_kind text; v_cols text[]; v_search text; v_inc text[] := '{}'; v_exc text[] := '{}'; v_n int := 0; t text; v_t text;
  v_filters jsonb := '{}'::jsonb; k text; v_col text := 'created'; v_dir text := 'desc';
  v_page int := 1; v_size int := 50; v_export boolean := false; v_total bigint; v_rows jsonb; v_off int;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['kind', 'from', 'to', 'campaign_id', 'search', 'filters', 'sort', 'page', 'page_size', 'export']);
  v_kind := public.growth__txt(p, 'kind', 20);
  if v_kind is null then raise exception 'REQUIRED: kind' using errcode = '22023'; end if;
  if v_kind not in ('leads', 'paid', 'enrolled') then raise exception 'BAD_VALUE: kind' using errcode = '22023'; end if;
  v_cols := public.growth__season_cols(v_kind);
  select * into w from public.growth__season_window(p - array['kind', 'search', 'filters', 'sort', 'page', 'page_size', 'export']);

  -- search: comma = many terms (any may match), leading ! = leave out rows that match; at most 10 terms of 100 characters
  v_search := public.growth__txt(p, 'search', 600);
  if v_search is not null then
    foreach t in array string_to_array(v_search, ',') loop
      exit when v_n >= 10;
      v_t := btrim(t);
      if left(v_t, 1) = '!' then
        v_t := left(btrim(substr(v_t, 2)), 100);
        if v_t <> '' then v_exc := v_exc || lower(v_t); v_n := v_n + 1; end if;
      elsif v_t <> '' then
        v_inc := v_inc || lower(left(v_t, 100)); v_n := v_n + 1;
      end if;
    end loop;
  end if;

  -- column filters: only known columns, text values
  if p ? 'filters' and jsonb_typeof(p->'filters') <> 'null' then
    if jsonb_typeof(p->'filters') <> 'object' then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
    if (select count(*) from jsonb_object_keys(p->'filters')) > 40 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
    for k in select jsonb_object_keys(p->'filters') loop
      if not (k = any (v_cols)) or jsonb_typeof(p->'filters'->k) <> 'string' or char_length(p->'filters'->>k) > 100 then
        raise exception 'BAD_VALUE: filters' using errcode = '22023';
      end if;
    end loop;
    v_filters := p->'filters';
  end if;

  -- sort: one known column, asc / desc (default: newest lead first)
  if p ? 'sort' and jsonb_typeof(p->'sort') <> 'null' then
    if jsonb_typeof(p->'sort') <> 'object' or exists (select 1 from jsonb_object_keys(p->'sort') x where x not in ('col', 'dir'))
       or jsonb_typeof(p->'sort'->'col') is distinct from 'string' or not ((p->'sort'->>'col') = any (v_cols))
       or coalesce(p->'sort'->>'dir', 'desc') not in ('asc', 'desc') then
      raise exception 'BAD_VALUE: sort' using errcode = '22023';
    end if;
    v_col := p->'sort'->>'col'; v_dir := coalesce(p->'sort'->>'dir', 'desc');
  end if;

  if p ? 'export' and jsonb_typeof(p->'export') <> 'null' then
    if jsonb_typeof(p->'export') <> 'boolean' then raise exception 'BAD_VALUE: export' using errcode = '22023'; end if;
    v_export := (p->>'export')::boolean;
  end if;
  v_page := coalesce(public.growth__num(p, 'page', 1, 100000)::int, 1);
  v_size := coalesce(public.growth__num(p, 'page_size', 1, 100)::int, 50);
  if v_export then v_page := 1; v_size := 5000; end if;
  v_off := (v_page - 1) * v_size;

  with b as (
    select s.lead_id, s.r,
           lower(concat_ws(' ', s.r->>'public_id', s.r->>'application_no', s.r->>'name', s.r->>'email', s.r->>'phone', s.r->>'city', s.r->>'state',
                           s.r->>'utm_source', s.r->>'utm_medium', s.r->>'utm_campaign')) h
      from public.growth__season_rows(v_kind, w.d_from, w.d_to, w.exam) s
  ), f as (
    select * from b
     where (cardinality(v_inc) = 0 or exists (select 1 from unnest(v_inc) q where b.h like '%' || public.growth__like_esc(q) || '%' escape '\'))
       and not exists (select 1 from unnest(v_exc) q where b.h like '%' || public.growth__like_esc(q) || '%' escape '\')
       and not exists (select 1 from jsonb_each_text(v_filters) x
                        where coalesce(b.r->>x.key, '') not ilike '%' || public.growth__like_esc(x.value) || '%' escape '\')
  ), o as (
    select f.r, row_number() over (order by
             (case when v_dir = 'asc'  and jsonb_typeof(f.r->v_col) = 'number' then (f.r->>v_col)::numeric end) asc  nulls last,
             (case when v_dir = 'desc' and jsonb_typeof(f.r->v_col) = 'number' then (f.r->>v_col)::numeric end) desc nulls last,
             (case when v_dir = 'asc'  then f.r->>v_col end) asc  nulls last,
             (case when v_dir = 'desc' then f.r->>v_col end) desc nulls last,
             f.lead_id) rn,
           count(*) over () n
      from f
  )
  select coalesce(max(o.n), 0), coalesce(jsonb_agg(o.r order by o.rn) filter (where o.rn > v_off and o.rn <= v_off + v_size), '[]'::jsonb)
    into v_total, v_rows from o;

  return jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_size, 'rows', v_rows,
                            'truncated', v_export and v_total > v_size);
end $fn$;

-- same grants as 0108 (create or replace keeps them; repeated so this file stands on its own)
revoke all on function public.growth__season_cols(text) from public, anon, authenticated;
revoke all on function public.growth__season_rows(text, date, date, date) from public, anon, authenticated;
revoke all on function public.growth_season_drill(jsonb) from public, anon;
grant execute on function public.growth_season_drill(jsonb) to authenticated;
