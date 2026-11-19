-- 0108 · Growth · Season Dashboard (VSAT Admin → Growth → Overview → Season Dashboard), admin only.
--
-- Three cards (Total Leads / Paid Applications / Enrolments) and a drill-down list behind each one.
-- Logic idea from the Vedam CRM Season Dashboard, on Vedam One's own data:
--   leads     = lead_manager rows, by the IST date of created_at
--   paid      = leads with a vsat_payments row, by the IST date of their first paid_at   ("paid" is ONLY vsat_payments)
--   enrolled  = leads with an application_manager row where enrollment_stage = 'approved',
--               by the IST date of coalesce(enrollment_paid_at, last_updated_date)
--   window    = a From–To range (IST dates), OR one campaign:
--                 a campaign locks the window to campaign_start..campaign_end for leads, and paid / enrolled are the
--                 leads whose application is on that campaign's exam date (application_manager.exam_date_id →
--                 vsat_exam_dates.exam_date = vsat_campaigns.exam_date), whenever they paid / enrolled.
--
-- One private helper (growth__season_ids) decides who is in each card. The card number and the list behind it both
-- read it, so they can never disagree.
--
-- Security: admin only (growth__admin → is_admin()), checked inside every function. SECURITY DEFINER, search_path '',
-- revoked from public/anon, granted to authenticated; private helpers are not callable by browsers. Request objects
-- with unknown keys are refused. Sort and filter columns are checked against a fixed list; user text is only ever used
-- as a value in LIKE (with %, _ and \ escaped), never put into SQL text. Page size <= 100, export <= 5000 rows.
--
-- Not touched: any table, RLS, existing function.
-- Rollback: supabase/rollback/0108_growth_season_dashboard_down.sql
-- Tests:    supabase/tests/growth_season.test.sql

-- the columns a list can show / sort / filter by (must match src/lib/growth/season.ts; a unit test compares them)
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

-- LIKE pattern text for a user term: % _ \ lose their meaning
create or replace function public.growth__like_esc(p text)
returns text language sql immutable set search_path to '' as $fn$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_');
$fn$;

-- the window of a request: From–To, or one campaign (which locks it)
create or replace function public.growth__season_window(p jsonb)
returns table (d_from date, d_to date, exam date, camp_name text, locked boolean)
language plpgsql stable security definer set search_path to '' as $fn$
declare v_id uuid; c record; f date; t date;
begin
  if p ? 'campaign_id' and jsonb_typeof(p->'campaign_id') <> 'null' then
    if p ? 'from' or p ? 'to' then raise exception 'BAD_VALUE: from' using errcode = '22023'; end if;
    begin v_id := (p->>'campaign_id')::uuid; exception when others then raise exception 'BAD_VALUE: campaign_id' using errcode = '22023'; end;
    select name, campaign_start, campaign_end, exam_date into c from public.vsat_campaigns where id = v_id;
    if not found then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
    if c.campaign_start is null or c.campaign_end is null then raise exception 'BAD_VALUE: campaign_id' using errcode = '22023'; end if;
    return query select c.campaign_start, c.campaign_end, c.exam_date, c.name, true;
  else
    f := public.growth__date(p, 'from'); t := public.growth__date(p, 'to');
    if f is null then raise exception 'REQUIRED: from' using errcode = '22023'; end if;
    if t is null then raise exception 'REQUIRED: to' using errcode = '22023'; end if;
    if t < f then raise exception 'BAD_VALUE: to' using errcode = '22023'; end if;
    return query select f, t, null::date, null::text, false;
  end if;
end $fn$;

-- who is in a card (one lead_id per lead)
create or replace function public.growth__season_ids(p_kind text, p_from date, p_to date, p_exam date)
returns setof uuid language plpgsql stable security definer set search_path to '' as $fn$
begin
  if p_kind = 'leads' then
    return query select lm.lead_id from public.lead_manager lm
      where (lm.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
  elsif p_kind = 'paid' then
    return query select vp.lead_id
      from (select x.lead_id, (min(x.paid_at) at time zone 'Asia/Kolkata')::date d from public.vsat_payments x group by x.lead_id) vp
      where case when p_exam is null then vp.d between p_from and p_to
                 else exists (select 1 from public.application_manager am join public.vsat_exam_dates ed on ed.id = am.exam_date_id
                               where am.lead_id = vp.lead_id and ed.exam_date = p_exam) end;
  elsif p_kind = 'enrolled' then
    return query select e.lead_id
      from (select am.lead_id,
                   (min(coalesce(am.enrollment_paid_at, am.last_updated_date)) at time zone 'Asia/Kolkata')::date d,
                   coalesce(bool_or(ed.exam_date = p_exam), false) on_exam
              from public.application_manager am left join public.vsat_exam_dates ed on ed.id = am.exam_date_id
             where am.enrollment_stage = 'approved' and am.lead_id is not null
             group by am.lead_id) e
      where case when p_exam is null then e.d between p_from and p_to else e.on_exam end;
  end if;
end $fn$;

-- the rows behind a card, one jsonb object per lead (keys = growth__season_cols)
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

-- the three cards
create or replace function public.growth_season_counts(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare w record;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['from', 'to', 'campaign_id']);
  select * into w from public.growth__season_window(p);
  return jsonb_build_object(
    'leads',    (select count(*) from public.growth__season_ids('leads',    w.d_from, w.d_to, w.exam)),
    'paid',     (select count(*) from public.growth__season_ids('paid',     w.d_from, w.d_to, w.exam)),
    'enrolled', (select count(*) from public.growth__season_ids('enrolled', w.d_from, w.d_to, w.exam)),
    'from', w.d_from, 'to', w.d_to, 'locked', w.locked, 'campaign', w.camp_name);
end $fn$;

-- the list behind one card: search, column filters, sort, page, or export (one call, up to 5000 rows)
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

-- grants: browsers may call only the two public functions
revoke all on function public.growth__season_cols(text) from public, anon, authenticated;
revoke all on function public.growth__like_esc(text) from public, anon, authenticated;
revoke all on function public.growth__season_window(jsonb) from public, anon, authenticated;
revoke all on function public.growth__season_ids(text, date, date, date) from public, anon, authenticated;
revoke all on function public.growth__season_rows(text, date, date, date) from public, anon, authenticated;
revoke all on function public.growth_season_counts(jsonb) from public, anon;
revoke all on function public.growth_season_drill(jsonb) from public, anon;
grant execute on function public.growth_season_counts(jsonb) to authenticated;
grant execute on function public.growth_season_drill(jsonb) to authenticated;
