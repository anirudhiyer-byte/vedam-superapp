-- 0137 · Growth → Marketing channels → Vedantu Channel → Vedantu Performance (admin only)
--
-- Ports the vedamcrm360 "Vedantu Performance" page. Its cards are the totals of the Vedantu Listing columns, worked out
-- on screen from growth_vd_list (0136), exactly as the CRM adds up its listing rows. This migration adds only the drill:
-- the people behind a Leads / Payments / Enrolments card. New functions only: nothing of 0136 or other pages changes.
-- Helpers growth__admin, growth__keys, growth__txt, growth__date, growth__leads, growth__cons_stage and
-- growth__vd_campaign are called, not redefined.
--
-- Rows in view: live (not in the Trash) Vedantu rows, narrowed like the page's filters:
--   start / end   Live Date from / to (YYYY-MM-DD, both optional)
--   campaign      the VSAT name the row's Live Date falls in (worked out, as the Listing's Campaign column)
--   channel       the Channel text, exact (as the Channel dropdown)
-- Who is listed — the SAME rule as the Listing's numbers, so a drill matches its card (the CRM's drill used another rule
-- and did not match). Staff (@vedam.org) are left out by growth__leads.
--   leads    · in_window  leads with the row's UTM whose registration day is inside the row's VSAT dates
--            · all_time   every lead with the row's UTM
--   payments · in_window / all_time   those leads who also have a VSAT payment (vsat_payments)
--   enrollments (all_time only)       those leads who are enrolled
-- Each person is listed once, even when two rows share a UTM (the card adds rows up, so it can be higher; the page says so).
-- Columns: the CRM drill's columns — Leads: 22 lead columns; Payments / Enrolments: 41 application columns (latest
-- application of the lead). Capped at 5,000 (newest registrations first); the page can download what it shows (admins only).
--
-- Security: admin only (growth__admin). Public RPC: SECURITY DEFINER, search_path '', unknown request keys refused,
-- revoked from public/anon, granted to authenticated. The private helper growth__vdperf_people is not callable by browsers.
--
-- Rollback: supabase/rollback/0137_growth_vedantu_performance_down.sql
-- Tests:    supabase/tests/growth_vedantu_performance.test.sql

-- every person of the live rows in view (once), with whether they registered inside a row's VSAT dates
create or replace function public.growth__vdperf_people(p_start date, p_end date, p_campaign text, p_channel text)
returns table (lead_id uuid, in_window boolean, created_d date, paid_d date, enrolled_d date)
language sql stable security definer set search_path to '' as $fn$
  with r as materialized (
    select a.utm_key k, c.name cname, c.campaign_start s, c.campaign_end e
      from public.growth_vd_rows a
      left join public.vsat_campaigns c on c.id = public.growth__vd_campaign(a.live_date)
     where a.deleted_at is null
       and (p_start is null or a.live_date >= p_start)
       and (p_end is null or a.live_date <= p_end)
       and (p_channel is null or a.channel = p_channel)
  ), rv as materialized (
    select * from r where p_campaign is null or r.cname = p_campaign
  ), l as materialized (
    select * from public.growth__leads(array(select distinct rv.k from rv where rv.k is not null))
  )
  select l.lead_id,
         bool_or(rv.s is not null and rv.e is not null and l.created_d between rv.s and rv.e),
         min(l.created_d), min(l.paid_d), min(l.enrolled_d)
    from rv join l on l.k = rv.k
   group by l.lead_id;
$fn$;

-- { type: leads|payments|enrollments, scope: in_window|all_time, start?, end?, campaign?, channel? }
--   → { columns: [...], students: [{...}] max 5000, total, truncated }
create or replace function public.growth_vd_perf_drill(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v_type text; v_scope text; v_s date; v_e date; v_c text; v_ch text; v_total int; v_rows jsonb; v_cols text[];
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['type', 'scope', 'start', 'end', 'campaign', 'channel']);
  v_type := p->>'type';
  v_scope := coalesce(p->>'scope', 'all_time');
  if v_type is null or v_type not in ('leads', 'payments', 'enrollments') then raise exception 'BAD_VALUE: type' using errcode = '22023'; end if;
  if v_scope not in ('in_window', 'all_time') or (v_type = 'enrollments' and v_scope <> 'all_time') then
    raise exception 'BAD_VALUE: scope' using errcode = '22023';
  end if;
  v_s := public.growth__date(p, 'start');
  v_e := public.growth__date(p, 'end');
  if v_s is not null and v_e is not null and v_s > v_e then raise exception 'BAD_VALUE: start' using errcode = '22023'; end if;
  v_c := nullif(btrim(public.growth__txt(p, 'campaign', 120)), '');
  v_ch := nullif(btrim(public.growth__txt(p, 'channel', 120)), '');

  if v_type = 'leads' then
    v_cols := array['user_id', 'lead_id', 'registered_name', 'registered_email', 'registered_mobile', 'user_registration_date',
      'lead_stage', 'primary_registration_campaign', 'campaign_source', 'campaign_name', 'campaign_medium', 'primary_traffic_channel',
      'publisher_name', 'email_verification_status', 'mobile_verification_status', 'lead_verification_date', 'latest_traffic_channel',
      'latest_registration_campaign', 'latest_registration_date', 'conversion_status', 'campus_preference', 'updated_at'];
  else
    v_cols := array['application_no', 'lead_id', 'registered_name', 'registered_email', 'registered_mobile', 'registration_channel',
      'user_registration_date', 'email_verification_status', 'lead_status', 'lead_stage', 'enrolment_status', 'conversion_status',
      'application_submitted', 'form_status', 'application_stage', 'form_stage', 'current_stage', 'campus_preference',
      'year_of_passing_class_12th', 'class_12th_stream', 'class_12th_year_of_passing_form', 'where_did_you_get_to_know_about_vedam',
      'exam_date', 'exam_slot', 'correspondence_country', 'correspondence_state', 'correspondence_city', 'traffic_channel',
      'publisher_name', 'campaign_source', 'campaign_medium', 'campaign_name', 'latest_registration_campaign', 'latest_registration_date',
      'sem_created_on', 'payment_amount', 'payment_status', 'payment_approved_date', 'seat_booking_amount', 'seat_booking_amount_date',
      'updated_at'];
  end if;

  with x as materialized (
    select * from public.growth__vdperf_people(v_s, v_e, v_c, v_ch) x
     where (v_scope = 'all_time' or x.in_window)
       and (v_type = 'leads' or (v_type = 'payments' and x.paid_d is not null) or (v_type = 'enrollments' and x.enrolled_d is not null))
  ), pick as (
    select x.lead_id, x.created_d from x order by x.created_d desc nulls last, x.lead_id limit 5000
  ), j as (
    select k.created_d, k.lead_id,
      case when v_type = 'leads' then jsonb_build_object(
        'user_id', lm.public_id, 'lead_id', lm.lead_id, 'registered_name', lm.registered_name, 'registered_email', lm.registered_email,
        'registered_mobile', lm.registered_mobile, 'user_registration_date', lm.user_registration_date, 'lead_stage', lm.lead_stage,
        'primary_registration_campaign', lm.primary_registration_campaign, 'campaign_source', lm.primary_utm_source,
        'campaign_name', lm.primary_utm_campaign, 'campaign_medium', lm.primary_utm_medium,
        'primary_traffic_channel', lm.primary_traffic_channel, 'publisher_name', lm.publisher_name,
        'email_verification_status', lm.email_verification_status, 'mobile_verification_status', lm.mobile_verification_status,
        'lead_verification_date', lm.lead_verification_date, 'latest_traffic_channel', lm.latest_traffic_channel,
        'latest_registration_campaign', lm.latest_registration_campaign, 'latest_registration_date', lm.latest_registration_date,
        'conversion_status', lm.conversion_status, 'campus_preference', lm.campus_preference, 'updated_at', lm.updated_at)
      else jsonb_build_object(
        'application_no', am.application_no, 'lead_id', lm.lead_id, 'registered_name', lm.registered_name,
        'registered_email', lm.registered_email, 'registered_mobile', lm.registered_mobile, 'registration_channel', lm.registration_channel,
        'user_registration_date', lm.user_registration_date, 'email_verification_status', lm.email_verification_status,
        'lead_status', lm.lead_status, 'lead_stage', lm.lead_stage, 'enrolment_status', lm.enrolment_status,
        'conversion_status', coalesce(am.conversion_status, lm.conversion_status), 'application_submitted', lm.application_submitted,
        'form_status', am.form_status, 'application_stage', am.application_stage_1, 'form_stage', am.form_stage_1,
        'current_stage', public.growth__cons_stage(lm.lead_id), 'campus_preference', lm.campus_preference,
        'year_of_passing_class_12th', am.class12_year, 'class_12th_stream', am.class_12_stream,
        'class_12th_year_of_passing_form', lm.passing_year, 'where_did_you_get_to_know_about_vedam', lm.source_hearabout,
        'exam_date', ((am.vsat_slot_datetime_1 at time zone 'Asia/Kolkata')::date),
        'exam_slot', to_char(am.vsat_slot_datetime_1 at time zone 'Asia/Kolkata', 'HH24:MI'),
        'correspondence_country', am.country, 'correspondence_state', am.state, 'correspondence_city', am.city,
        'traffic_channel', lm.primary_traffic_channel, 'publisher_name', lm.publisher_name,
        'campaign_source', lm.primary_utm_source, 'campaign_medium', lm.primary_utm_medium, 'campaign_name', lm.primary_utm_campaign,
        'latest_registration_campaign', lm.latest_registration_campaign, 'latest_registration_date', lm.latest_registration_date,
        'sem_created_on', am.created_at, 'payment_amount', am.payment_amount, 'payment_status', am.payment_status,
        'payment_approved_date', am.payment_approved_date, 'seat_booking_amount', am.seat_booking_amount,
        'seat_booking_amount_date', am.seat_booking_amount_date, 'updated_at', am.last_updated_date)
      end o
      from pick k
      join public.lead_manager lm on lm.lead_id = k.lead_id
      left join lateral (select a.* from public.application_manager a where a.lead_id = k.lead_id
                          order by a.last_updated_date desc nulls last, a.created_at desc limit 1) am on v_type <> 'leads'
  )
  select (select count(*) from x)::int,
         coalesce((select jsonb_agg(j.o order by j.created_d desc nulls last, j.lead_id) from j), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('columns', to_jsonb(v_cols), 'students', v_rows, 'total', v_total, 'truncated', v_total > 5000);
end $fn$;

revoke all on function public.growth__vdperf_people(date, date, text, text) from public, anon, authenticated;
revoke all on function public.growth_vd_perf_drill(jsonb)                   from public, anon;
grant execute on function public.growth_vd_perf_drill(jsonb)                to authenticated;
