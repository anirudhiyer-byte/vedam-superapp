-- 0110 · Growth · Season Dashboard: the list popups show the CRM's columns, same names, same order.
--
-- The CRM Season Dashboard lists show the raw columns of its tables:
--   Total Leads              22 columns (lead_id … primary_registration_campaign)
--   Paid Applications / Enrolments   41 columns (application_no … updated_at)
-- 0108 showed a shorter, renamed set. 0110 returns exactly the CRM keys, filled from lead_manager / application_manager
-- (the same tables; most names are the same). Agreed mapping where the name differs:
--   user_id → lead_manager.public_id · campaign_name / campaign_medium / campaign_source → utm_campaign / utm_medium / utm_source
--   current_stage → application_manager.application_sub_stage · sem_created_on → application_manager.created_at
--   user_registration_date → user_registration_date, else created_at (the lead's sign-up time)
-- Dates are IST, written YYYY-MM-DDTHH:MM:SS so they sort as text. Numbers stay numbers (they sort as numbers).
--
-- Changed: growth__season_cols (the allowed list), growth__season_rows (the rows), growth_season_drill (default sort is
-- now user_registration_date, newest first; search looks at every column, like the CRM). Same signatures and grants.
-- NOT changed: who is counted (growth__season_ids, 0109), the cards (growth_season_counts), any table or data.
-- Rollback: supabase/rollback/0110_growth_season_crm_columns_down.sql (puts back the 0108 bodies of the three functions).

-- the columns a list can show / sort / filter by (must match src/lib/growth/season.ts; a unit test compares them)
create or replace function public.growth__season_cols(p_kind text)
returns text[] language sql immutable set search_path to '' as $fn$
  select case when p_kind = 'leads' then array[
      'lead_id','user_id','lead_stage','updated_at','campaign_name','publisher_name',
      'campaign_medium','campaign_source','registered_name','registered_email','campus_preference','conversion_status',
      'registered_mobile','latest_traffic_channel','lead_verification_date','user_registration_date','primary_traffic_channel','latest_registration_date',
      'email_verification_status','mobile_verification_status','latest_registration_campaign','primary_registration_campaign']
    when p_kind in ('paid', 'enrolled') then array[
      'application_no','lead_id','registered_name','registered_email','registered_mobile','registration_channel',
      'user_registration_date','email_verification_status','lead_status','lead_stage','enrolment_status','conversion_status',
      'application_submitted','form_status','application_stage','form_stage','current_stage','campus_preference',
      'year_of_passing_class_12th','class_12th_stream','class_12th_year_of_passing_form','where_did_you_get_to_know_about_vedam','exam_date','exam_slot',
      'correspondence_country','correspondence_state','correspondence_city','traffic_channel','publisher_name','campaign_source',
      'campaign_medium','campaign_name','latest_registration_campaign','latest_registration_date','sem_created_on','payment_amount',
      'payment_status','payment_approved_date','seat_booking_amount','seat_booking_amount_date','updated_at']
    end;
$fn$;

-- the rows behind a card, one jsonb object per lead (keys = growth__season_cols)
create or replace function public.growth__season_rows(p_kind text, p_from date, p_to date, p_exam date)
returns table (lead_id uuid, r jsonb)
language plpgsql stable security definer set search_path to '' as $fn$
begin
  if p_kind = 'leads' then
    return query
      select lm.lead_id, jsonb_build_object(
        'lead_id', lm.lead_id,
        'user_id', lm.public_id,
        'lead_stage', lm.lead_stage::text,
        'updated_at', to_char(lm.updated_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
        'campaign_name', lm.utm_campaign,
        'publisher_name', lm.publisher_name,
        'campaign_medium', lm.utm_medium,
        'campaign_source', lm.utm_source,
        'registered_name', lm.registered_name,
        'registered_email', lm.registered_email,
        'campus_preference', lm.campus_preference,
        'conversion_status', lm.conversion_status,
        'registered_mobile', lm.registered_mobile,
        'latest_traffic_channel', lm.latest_traffic_channel,
        'lead_verification_date', to_char(lm.lead_verification_date at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
        'user_registration_date', to_char(coalesce(lm.user_registration_date, lm.created_at) at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
        'primary_traffic_channel', lm.primary_traffic_channel,
        'latest_registration_date', to_char(lm.latest_registration_date at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
        'email_verification_status', lm.email_verification_status,
        'mobile_verification_status', lm.mobile_verification_status,
        'latest_registration_campaign', lm.latest_registration_campaign,
        'primary_registration_campaign', lm.primary_registration_campaign)
      from public.lead_manager lm
      where lm.lead_id in (select i from public.growth__season_ids('leads', p_from, p_to, p_exam) i);
  else
    return query
      select lm.lead_id, jsonb_build_object(
        'application_no', am.application_no,
        'lead_id', lm.lead_id,
        'registered_name', coalesce(am.registered_name, lm.registered_name),
        'registered_email', coalesce(am.registered_email, lm.registered_email),
        'registered_mobile', coalesce(am.registered_mobile, lm.registered_mobile),
        'registration_channel', lm.registration_channel,
        'user_registration_date', to_char(coalesce(lm.user_registration_date, lm.created_at) at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
        'email_verification_status', lm.email_verification_status,
        'lead_status', lm.lead_status,
        'lead_stage', lm.lead_stage::text,
        'enrolment_status', lm.enrolment_status,
        'conversion_status', coalesce(am.conversion_status, lm.conversion_status),
        'application_submitted', lm.application_submitted,
        'form_status', am.form_status,
        'application_stage', coalesce(am.application_stage_2::text, am.application_stage_1::text),
        'form_stage', coalesce(am.form_stage_2::text, am.form_stage_1::text),
        'current_stage', am.application_sub_stage,
        'campus_preference', coalesce(am.campus_applied, lm.campus_preference),
        'year_of_passing_class_12th', coalesce(am.class12_year, lm.passing_year),
        'class_12th_stream', coalesce(am.class_12_stream, lm.class_12_stream),
        'class_12th_year_of_passing_form', am.class12_year,
        'where_did_you_get_to_know_about_vedam', lm.source_hearabout,
        'exam_date', ed.exam_date::text,
        'exam_slot', to_char(ed.start_at at time zone 'Asia/Kolkata', 'HH24:MI') || '–' || to_char(ed.end_at at time zone 'Asia/Kolkata', 'HH24:MI'),
        'correspondence_country', coalesce(am.country, lm.registered_country),
        'correspondence_state', coalesce(am.state, lm.state),
        'correspondence_city', coalesce(am.city, lm.city),
        'traffic_channel', lm.primary_traffic_channel,
        'publisher_name', lm.publisher_name,
        'campaign_source', coalesce(am.primary_utm_source, lm.utm_source),
        'campaign_medium', coalesce(am.primary_utm_medium, lm.utm_medium),
        'campaign_name', coalesce(am.primary_utm_campaign, lm.utm_campaign),
        'latest_registration_campaign', lm.latest_registration_campaign,
        'latest_registration_date', to_char(lm.latest_registration_date at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
        'sem_created_on', to_char(am.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
        'payment_amount', coalesce(vp.amount, am.payment_amount),
        'payment_status', am.payment_status,
        'payment_approved_date', to_char(coalesce(vp.paid_at, am.payment_approved_date) at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
        'seat_booking_amount', coalesce(am.seat_booking_amount, am.enrollment_amount),
        'seat_booking_amount_date', to_char(coalesce(am.seat_booking_amount_date, am.enrollment_paid_at) at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'),
        'updated_at', to_char(coalesce(am.last_updated_date, lm.updated_at) at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'))
      from public.lead_manager lm
      left join lateral (select a.* from public.application_manager a where a.lead_id = lm.lead_id
                          order by (a.enrollment_stage = 'approved') desc, a.last_updated_date desc nulls last limit 1) am on true
      left join public.vsat_exam_dates ed on ed.id = am.exam_date_id
      left join lateral (select min(x.paid_at) paid_at, (array_agg(x.amount order by x.paid_at))[1] amount
                           from public.vsat_payments x where x.lead_id = lm.lead_id) vp on true
      where lm.lead_id in (select i from public.growth__season_ids(p_kind, p_from, p_to, p_exam) i);
  end if;
end $fn$;

-- the list behind one card: search, column filters, sort, page, or export (one call, up to 5000 rows)
create or replace function public.growth_season_drill(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  w record; v_kind text; v_cols text[]; v_search text; v_inc text[] := '{}'; v_exc text[] := '{}'; v_n int := 0; t text; v_t text;
  v_filters jsonb := '{}'::jsonb; k text; v_col text := 'user_registration_date'; v_dir text := 'desc';
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
           lower((select string_agg(x.value, ' ') from jsonb_each_text(s.r) x)) h   -- 0110: search every column, like the CRM
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
