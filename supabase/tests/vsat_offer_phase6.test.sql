-- VSAT Phase 6 · the offer letter as sir asked — tests for migration 0189 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private error code at the
-- end. Fake data only (@example.invalid, ZZTEST names). The reminder job gets a fixed "now" (its test-only parameter).
--
-- A release once counselling is Done · R sir's two reminders · X OL Date Increase (extend) · C the table's offer columns
-- · S security and setup

create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

-- applicant moved up to p_stage (default Counselled) with a scholarship %
create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid, p_pct numeric, p_stage text default 'counselled')
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', p_campus, p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, 80, 40, 50, 8.43);
  update public.application_manager set exam_given = true where application_id = p_id;
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared', 'counselling_scheduled', 'counselled'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
    exit when s = p_stage;
  end loop;
  if p_pct is not null then
    update public.application_manager set scholarship_percentage = p_pct, scholarship_pct_1 = p_pct where application_id = p_id;
  end if;
  return p_id;
end $$;

-- the student's counselling row: Status (attendance) and whether the counselling form was saved
create or replace function pg_temp.mk_couns(p_app text, p_cid uuid, p_att text, p_saved boolean, p_min int)
returns void language sql as $$
  insert into public.counselling_assignments (application_id, attempt_no, counsellor_id, slot_datetime, attendance, submitted_at, meet_mode)
  values (p_app, 1, p_cid, date_trunc('minute', now()) - make_interval(mins => p_min), p_att::public.vm_attendance,
          case when p_saved then now() end, 'zoom')
  on conflict (application_id, attempt_no) do update
     set counsellor_id = excluded.counsellor_id, slot_datetime = excluded.slot_datetime, attendance = excluded.attendance,
         submitted_at = excluded.submitted_at, meet_mode = excluded.meet_mode
$$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  elsif p_role = 'service_role' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.release(p_who uuid, p_apps text[], p_days int default null, p_dry boolean default false)
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_offers_release', jsonb_strip_nulls(jsonb_build_object(
    'application_ids', to_jsonb(p_apps), 'offer_days', p_days, 'dry_run', case when p_dry then true end))))
$$;

create or replace function pg_temp.extend(p_who uuid, p jsonb)
returns jsonb language sql as $$ select pg_temp.call_as(p_who, pg_temp.rpc('vsat_offer_extend', p)) $$;

create or replace function pg_temp.move(p_who uuid, p_app text, p_to text, p_reason text default null)
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_move_stage',
    jsonb_strip_nulls(jsonb_build_object('application_id', p_app, 'to_stage', p_to, 'to_status', 'active', 'reason', p_reason))))
$$;

create or replace function pg_temp.stage(p_app text)
returns text language sql as $$ select vp.stage || ':' || vp.status from public.vsat_pipeline vp where vp.application_id = p_app $$;

create or replace function pg_temp.skip_code(r jsonb, p_app text)
returns text language sql as $$ select x->>'code' from jsonb_array_elements(r->'skipped') x where x->>'application_id' = p_app $$;

create or replace function pg_temp.exp(p_app text)
returns timestamptz language sql as $$ select a.offer_expires_at from public.application_manager a where a.application_id = p_app $$;

-- when reminder n is due for the student's current offer (+ p_min minutes)
create or replace function pg_temp.due(p_app text, p_n int, p_min int default 0)
returns timestamptz language sql as $$ select public.vsat__offer_reminder_due(pg_temp.exp(p_app), p_n) + make_interval(mins => p_min) $$;

create or replace function pg_temp.rem(p_app text)
returns text language sql as $$
  select coalesce(string_agg(e.kind || '=' || e.notify_status, ',' order by e.kind), '∅') from public.vsat_offer_events e
   where e.application_id = p_app and e.kind like 'reminder%'
     and e.released_at = (select a.offer_released_at from public.application_manager a where a.application_id = p_app)
$$;

create or replace function pg_temp.col(p_app text, p_key text)
returns text language sql as $$ select public.vsat__offer_cols(p_app) ->> p_key $$;

-- 11:59:59 pm IST of the day p_days after p_from's IST date
create or replace function pg_temp.eod(p_from timestamptz, p_days int)
returns timestamptz language sql as $$
  select (((p_from at time zone 'Asia/Kolkata')::date + p_days)::timestamp + interval '23 hours 59 minutes 59 seconds') at time zone 'Asia/Kolkata'
$$;

create or replace function pg_temp.run_vsat_offer_phase6_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_ggn uuid; cou uuid; ivr uuid; d uuid;
  a1 text; a2 text; a3 text; a4 text; r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text;
  x1 text; x2 text; x3 text; x4 text; x5 text; x6 text; c1 text; c2 text; c3 text; g1 text;
  r jsonb; s text; n int; t0 timestamptz; t1 timestamptz; ok boolean;
  pune constant text := 'Ajeenkya DY Patil University — Pune';
  ggn constant text := 'Sushant University — Gurugram';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-p6-adm@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions');
    adm_ggn := pg_temp.mk_user('zztest-p6-ggn@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values (adm_ggn, 'admissions', 'gurugram');
    cou := pg_temp.mk_user('zztest-p6-cou@example.invalid');
    insert into public.vsat_team (user_id, role) values (cou, 'counsellor');
    ivr := pg_temp.mk_user('zztest-p6-ivr@example.invalid');
    insert into public.vsat_team (user_id, role) values (ivr, 'interviewer');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST phase 6 batch', 'zz-p6', current_date, now(), now() + interval '2 hours') returning id into d;

    -- ════ A. release once counselling is Done ════
    a1 := pg_temp.mk_app('ZZT-P6-A1', pune, d, 40, 'counselling_scheduled');   -- Done + form saved
    perform pg_temp.mk_couns(a1, cou, 'done', true, 60);
    a2 := pg_temp.mk_app('ZZT-P6-A2', pune, d, 40, 'counselling_scheduled');   -- not marked Done yet
    perform pg_temp.mk_couns(a2, cou, 'scheduled', true, 120);
    a3 := pg_temp.mk_app('ZZT-P6-A3', pune, d, 40, 'counselling_scheduled');   -- Done, form not saved
    perform pg_temp.mk_couns(a3, cou, 'done', false, 180);
    a4 := pg_temp.mk_app('ZZT-P6-A4', pune, d, 40);                              -- Counselled (as before)

    r := pg_temp.release(adm, array[a1, a2, a3, a4], 7, true);
    t_name := t_name || text 'A preview: Done + form saved (at Counselling scheduled) and Counselled can be released; nothing moves';
    t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'dry_run' = 'true' and jsonb_array_length(r->'released') = 2
                         and pg_temp.skip_code(r, a2) = 'WRONG_STAGE' and pg_temp.skip_code(r, a3) = 'WRONG_STAGE'
                         and pg_temp.stage(a1) = 'counselling_scheduled:active' and pg_temp.stage(a4) = 'counselled:active');

    r := pg_temp.release(adm, array[a1, a2, a3, a4], 7);
    t_name := t_name || text 'A release: the Done student goes Counselling scheduled → Counselled → Offer sent; the others stay';
    select string_agg(h.from_stage || '>' || h.to_stage, ' ' order by h.id) into s from public.vsat_stage_history h
     where h.application_id = a1 and h.to_stage in ('counselled', 'offer_sent');
    t_det := t_det || (format('%s | %s | a1=%s a2=%s a3=%s a4=%s', r, s, pg_temp.stage(a1), pg_temp.stage(a2), pg_temp.stage(a3), pg_temp.stage(a4)));
    t_pass := t_pass || (jsonb_array_length(r->'released') = 2 and pg_temp.stage(a1) = 'offer_sent:active' and pg_temp.stage(a4) = 'offer_sent:active'
                         and pg_temp.stage(a2) = 'counselling_scheduled:active' and pg_temp.stage(a3) = 'counselling_scheduled:active'
                         and s = 'counselling_scheduled>counselled counselled>offer_sent');
    t_name := t_name || text 'A the released offer has the counselling %, 7 days (until 11:59:59 pm IST) and one offer email queued';
    select format('pct=%s exp=%s want=%s ev=%s', a.scholarship_percentage, a.offer_expires_at, pg_temp.eod(a.offer_released_at, 7),
                  (select string_agg(e.kind || ':' || e.notify_status, ',') from public.vsat_offer_events e where e.application_id = a1))
      into s from public.application_manager a where a.application_id = a1;
    t_det := t_det || (s);
    t_pass := t_pass || ((select a.scholarship_percentage = 40 and a.offer_expires_at = pg_temp.eod(a.offer_released_at, 7)
                            and a.offer_pay_timeline_days = 7 from public.application_manager a where a.application_id = a1)
                         and (select string_agg(e.kind || ':' || e.notify_status, ',') from public.vsat_offer_events e where e.application_id = a1) = 'released:pending');

    -- ════ R. sir's two reminders ════
    -- each student gets its own validity, so one student's reminder times never fall inside another's checks
    -- (the job looks at every live offer): days from today, 10 am IST — r1 7 days (R1 +4, R2 +6), r2 2 days (R2 +1),
    -- r3 10 days (R1 +7, R2 +9), r7 15 days (R1 +12, R2 +14)
    r1 := pg_temp.mk_app('ZZT-P6-R1', pune, d, 30);   -- 7 days: both reminders
    r2 := pg_temp.mk_app('ZZT-P6-R2', pune, d, 30);   -- 2 days: no Reminder 1
    r3 := pg_temp.mk_app('ZZT-P6-R3', pune, d, 30);   -- 10 days, the job first runs after Reminder 2 is due
    r4 := pg_temp.mk_app('ZZT-P6-R4', pune, d, 30);   -- fee paid
    r5 := pg_temp.mk_app('ZZT-P6-R5', pune, d, 30);   -- cancelled
    r6 := pg_temp.mk_app('ZZT-P6-R6', pune, d, 30);   -- on hold
    r7 := pg_temp.mk_app('ZZT-P6-R7', ggn, d, 30);    -- Gurugram, 15 days
    r := pg_temp.release(adm, array[r1, r4, r5, r6], 7);
    r := pg_temp.release(adm, array[r2], 2);
    r := pg_temp.release(adm, array[r3], 10);
    r := pg_temp.release(adm, array[r7], 15);
    update public.application_manager set enrollment_stage = 'approved' where application_id = r4;   -- → Enrolled
    r := pg_temp.move(adm, r5, 'offer_cancelled', 'zz cancelled');
    update public.vsat_pipeline set status = 'on_hold' where application_id = r6;

    t_name := t_name || text 'R the reminder times: 10:00 am IST, 3 days and 1 day before the last date';
    t_det := t_det || (format('last=%s r1=%s r2=%s', pg_temp.exp(r1) at time zone 'Asia/Kolkata', pg_temp.due(r1, 1) at time zone 'Asia/Kolkata',
                              pg_temp.due(r1, 2) at time zone 'Asia/Kolkata'));
    t_pass := t_pass || (pg_temp.due(r1, 1) at time zone 'Asia/Kolkata' = ((pg_temp.exp(r1) at time zone 'Asia/Kolkata')::date - 3) + time '10:00'
                         and pg_temp.due(r1, 2) at time zone 'Asia/Kolkata' = ((pg_temp.exp(r1) at time zone 'Asia/Kolkata')::date - 1) + time '10:00');

    n := public.vsat__offers_remind(pg_temp.due(r1, 1, -1));
    t_name := t_name || text 'R a minute before Reminder 1: nothing queued';
    t_det := t_det || (pg_temp.rem(r1)); t_pass := t_pass || (pg_temp.rem(r1) = '∅');

    n := public.vsat__offers_remind(pg_temp.due(r1, 1));
    n := public.vsat__offers_remind(pg_temp.due(r1, 1, 15));
    t_name := t_name || text 'R at Reminder 1: one Reminder 1 for this offer (the job running again adds nothing)';
    t_det := t_det || (pg_temp.rem(r1)); t_pass := t_pass || (pg_temp.rem(r1) = 'reminder_1=pending');
    t_name := t_name || text 'R the column shows Reminder 1 Queued, Reminder 2 Due';
    t_det := t_det || (format('%s / %s', pg_temp.col(r1, 'ol_reminder_1'), pg_temp.col(r1, 'ol_reminder_2')));
    t_pass := t_pass || (pg_temp.col(r1, 'ol_reminder_1') = 'Queued'
                         and pg_temp.col(r1, 'ol_reminder_2') = 'Due ' || to_char(pg_temp.due(r1, 2) at time zone 'Asia/Kolkata', 'Dy, FMDD Mon'));

    update public.vsat_offer_events set notify_status = 'sent', notified_at = now() where application_id = r1 and kind = 'reminder_1';
    n := public.vsat__offers_remind(pg_temp.due(r1, 2));
    t_name := t_name || text 'R at Reminder 2: Reminder 2 queued; Reminder 1 (sent) is not repeated';
    t_det := t_det || (format('%s | %s / %s', pg_temp.rem(r1), pg_temp.col(r1, 'ol_reminder_1'), pg_temp.col(r1, 'ol_reminder_2')));
    t_pass := t_pass || (pg_temp.rem(r1) = 'reminder_1=sent,reminder_2=pending' and pg_temp.col(r1, 'ol_reminder_1') = 'Sent');

    t_name := t_name || text 'R a 2-day offer: Reminder 1 "Not needed", Reminder 2 on its day';
    s := pg_temp.col(r2, 'ol_reminder_1');
    n := public.vsat__offers_remind(pg_temp.due(r2, 2));
    t_det := t_det || (format('%s | %s', s, pg_temp.rem(r2)));
    t_pass := t_pass || (s = 'Not needed' and pg_temp.rem(r2) = 'reminder_2=pending');

    n := public.vsat__offers_remind(pg_temp.due(r3, 2, 5));
    t_name := t_name || text 'R the job first runs after Reminder 2 is due: only Reminder 2 (no late Reminder 1)';
    t_det := t_det || (pg_temp.rem(r3)); t_pass := t_pass || (pg_temp.rem(r3) = 'reminder_2=pending');

    n := public.vsat__offers_remind(pg_temp.due(r7, 1, -60));
    s := pg_temp.rem(r7);
    n := public.vsat__offers_remind(pg_temp.due(r7, 1));
    t_name := t_name || text 'R Gurugram follows its own last date';
    t_det := t_det || (format('%s → %s', s, pg_temp.rem(r7))); t_pass := t_pass || (s = '∅' and pg_temp.rem(r7) = 'reminder_1=pending');

    n := public.vsat__offers_remind(pg_temp.due(r4, 2, 1));
    n := n + public.vsat__offers_remind(pg_temp.due(r6, 2, 1));
    t_name := t_name || text 'R no reminder: fee paid, offer cancelled, on hold';
    t_det := t_det || (format('%s %s | %s %s | %s %s | cols %s/%s/%s', pg_temp.stage(r4), pg_temp.rem(r4), pg_temp.stage(r5), pg_temp.rem(r5),
                              pg_temp.stage(r6), pg_temp.rem(r6), pg_temp.col(r4, 'ol_reminder_2'), pg_temp.col(r5, 'ol_reminder_2'), pg_temp.col(r6, 'ol_reminder_2')));
    t_pass := t_pass || (pg_temp.stage(r4) = 'enrolled:active' and pg_temp.stage(r5) = 'offer_cancelled:active' and pg_temp.stage(r6) = 'offer_sent:on_hold'
                         and pg_temp.rem(r4) = '∅' and pg_temp.rem(r5) = '∅' and pg_temp.rem(r6) = '∅'
                         and pg_temp.col(r4, 'ol_reminder_2') = 'Not needed' and pg_temp.col(r5, 'ol_reminder_2') = 'Not needed'
                         and pg_temp.col(r6, 'ol_reminder_2') = 'On hold');

    n := public.vsat__offers_remind(pg_temp.exp(r7) + interval '1 minute');
    t_name := t_name || text 'R no reminder once the deadline has passed';
    t_det := t_det || (pg_temp.rem(r7)); t_pass := t_pass || (pg_temp.rem(r7) = 'reminder_1=pending');

    begin
      insert into public.vsat_offer_events (application_id, attempt_no, kind, released_at, expires_at)
      select application_id, 1, 'reminder_1', released_at, expires_at from public.vsat_offer_events where application_id = r1 and kind = 'reminder_1';
      s := 'inserted';
    exception when unique_violation then s := 'unique_violation';
    end;
    t_name := t_name || text 'R a second Reminder 1 for the same offer is refused by the database';
    t_det := t_det || (s); t_pass := t_pass || (s = 'unique_violation');

    t_name := t_name || text 'R the old last-day reminder (0157) is never queued any more';
    select count(*) into n from public.vsat_offer_events e where e.application_id in (r1, r2, r3, r7) and e.kind = 'reminder';
    t_det := t_det || (n::text); t_pass := t_pass || (n = 0);

    r := pg_temp.call_as(null, pg_temp.rpc('vsat_offer_notices_claim', jsonb_build_object('application_ids', jsonb_build_array(r1, r2), 'limit', 100)), 'service_role');
    select string_agg(x->'student'->>'application_no' || ':' || (x->>'kind'), ',' order by x->'student'->>'application_no', x->>'kind') into s
      from jsonb_array_elements(r) x;
    t_name := t_name || text 'R the email job hands out the offer emails and the queued reminders';
    t_det := t_det || (s);
    t_pass := t_pass || (s = 'ZZT-P6-R1:released,ZZT-P6-R1:reminder_2,ZZT-P6-R2:released,ZZT-P6-R2:reminder_2');

    -- ════ X. OL Date Increase ════
    x1 := pg_temp.mk_app('ZZT-P6-X1', pune, d, 35);
    perform pg_temp.mk_couns(x1, cou, 'done', true, 240);
    x2 := pg_temp.mk_app('ZZT-P6-X2', pune, d, 35);   -- lapsed
    x3 := pg_temp.mk_app('ZZT-P6-X3', pune, d, 35);   -- paid
    x4 := pg_temp.mk_app('ZZT-P6-X4', ggn, d, 35);    -- Gurugram (for the campus rule)
    x5 := pg_temp.mk_app('ZZT-P6-X5', pune, d, 35);   -- cancelled
    x6 := pg_temp.mk_app('ZZT-P6-X6', pune, d, 35);   -- deadline passed, not lapsed yet
    r := pg_temp.release(adm, array[x1, x2, x3, x4, x5, x6], 7);
    t0 := pg_temp.exp(x1);
    n := public.vsat__offers_remind(pg_temp.due(x1, 1));   -- Reminder 1 queued (not sent yet)

    r := pg_temp.extend(adm, jsonb_build_object('application_id', x1, 'days', 3, 'reason', 'zz parents travelling'));
    t_name := t_name || text 'X extend by 3 days: the last date moves 3 days on, still 11:59:59 pm IST';
    t_det := t_det || (format('%s | before=%s after=%s', r, t0, pg_temp.exp(x1)));
    t_pass := t_pass || (r->>'days' = '3' and r->>'total_days' = '3' and pg_temp.exp(x1) = pg_temp.eod(t0, 3)
                         and (r->>'expires_at')::timestamptz = pg_temp.eod(t0, 3)
                         and (select a.offer_expiry_date = pg_temp.eod(t0, 3) from public.application_manager a where a.application_id = x1)
                         and (select c.offer_expiry_date = pg_temp.eod(t0, 3) from public.counselling_assignments c where c.application_id = x1 and c.attempt_no = 1));
    t_name := t_name || text 'X history: one "extended" event (3 days, old / new date, reason, who); no email';
    select format('%s days=%s from=%s to=%s reason=%s actor=%s', string_agg(e.notify_status, ','), max(e.detail->>'days'),
                  max(e.detail->>'from'), max(e.detail->>'to'), max(e.detail->>'reason'), bool_and(e.actor_id = adm))
      into s from public.vsat_offer_events e where e.application_id = x1 and e.kind = 'extended';
    t_det := t_det || (s);
    t_pass := t_pass || ((select count(*) = 1 and bool_and(e.notify_status = 'none') and max(e.detail->>'days') = '3'
                                and max(e.detail->>'reason') = 'zz parents travelling' and bool_and(e.actor_id = adm)
                                and max((e.detail->>'from')::timestamptz) = t0 and max((e.detail->>'to')::timestamptz) = pg_temp.eod(t0, 3)
                           from public.vsat_offer_events e where e.application_id = x1 and e.kind = 'extended'));
    t_name := t_name || text 'X the waiting Reminder 1 is dropped and comes again at the new time';
    s := pg_temp.rem(x1);
    n := public.vsat__offers_remind(pg_temp.due(x1, 1, -1));
    t1 := pg_temp.due(x1, 1);
    n := public.vsat__offers_remind(t1);
    t_det := t_det || (format('after extend=%s, at the new time=%s (due %s)', s, pg_temp.rem(x1), t1 at time zone 'Asia/Kolkata'));
    t_pass := t_pass || (s = '∅' and pg_temp.rem(x1) = 'reminder_1=pending'
                         and t1 at time zone 'Asia/Kolkata' = ((pg_temp.eod(t0, 3) at time zone 'Asia/Kolkata')::date - 3) + time '10:00');

    r := pg_temp.extend(adm, jsonb_build_object('application_id', x1, 'days', 2, 'reason', 'zz once more'));
    t_name := t_name || text 'X extend again by 2: OL Date Increase shows 5';
    t_det := t_det || (format('%s col=%s', r->>'total_days', pg_temp.col(x1, 'ol_date_increase')));
    t_pass := t_pass || (r->>'total_days' = '5' and pg_temp.col(x1, 'ol_date_increase') = '5' and pg_temp.exp(x1) = pg_temp.eod(t0, 5));

    n := public.vsat__offers_lapse();
    t_name := t_name || text 'X the lapse job leaves the extended offer alone; the email job sends the new last date';
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_offer_notices_claim', jsonb_build_object('application_ids', jsonb_build_array(x1), 'limit', 10)), 'service_role');
    select x->>'expires_at' into s from jsonb_array_elements(r) x where x->>'kind' = 'released';
    t_det := t_det || (format('%s %s', pg_temp.stage(x1), s));
    t_pass := t_pass || (pg_temp.stage(x1) = 'offer_sent:active' and s::timestamptz = pg_temp.eod(t0, 5));

    update public.application_manager set offer_expires_at = now() - interval '1 minute' where application_id = x2;
    n := public.vsat__offers_lapse();
    update public.application_manager set offer_expires_at = now() - interval '1 minute' where application_id = x6;   -- passed, not lapsed yet
    update public.application_manager set enrollment_stage = 'approved' where application_id = x3;
    r := pg_temp.move(adm, x5, 'offer_cancelled', 'zz cancelled');
    t_name := t_name || text 'X refused: lapsed, paid, cancelled, deadline passed (OFFER_NOT_ACTIVE)';
    s := concat_ws(' ', pg_temp.extend(adm, jsonb_build_object('application_id', x2, 'days', 1, 'reason', 'zz test'))->>'message',
                        pg_temp.extend(adm, jsonb_build_object('application_id', x3, 'days', 1, 'reason', 'zz test'))->>'message',
                        pg_temp.extend(adm, jsonb_build_object('application_id', x5, 'days', 1, 'reason', 'zz test'))->>'message',
                        pg_temp.extend(adm, jsonb_build_object('application_id', x6, 'days', 1, 'reason', 'zz test'))->>'message');
    t_det := t_det || (format('%s | %s %s %s', s, pg_temp.stage(x2), pg_temp.stage(x3), pg_temp.stage(x5)));
    t_pass := t_pass || (s = 'OFFER_NOT_ACTIVE OFFER_NOT_ACTIVE OFFER_NOT_ACTIVE OFFER_NOT_ACTIVE' and pg_temp.stage(x2) = 'offer_lapsed:active');

    t_name := t_name || text 'X bad requests: days 0 / 91 / 1.5 / "3", no reason, unknown key, unknown student';
    s := concat_ws(' | ',
      pg_temp.extend(adm, jsonb_build_object('application_id', x4, 'days', 0, 'reason', 'zz test'))->>'message',
      pg_temp.extend(adm, jsonb_build_object('application_id', x4, 'days', 91, 'reason', 'zz test'))->>'message',
      pg_temp.extend(adm, jsonb_build_object('application_id', x4, 'days', 1.5, 'reason', 'zz test'))->>'message',
      pg_temp.extend(adm, jsonb_build_object('application_id', x4, 'days', '3', 'reason', 'zz test'))->>'message',
      pg_temp.extend(adm, jsonb_build_object('application_id', x4, 'days', 2, 'reason', ' x '))->>'message',
      pg_temp.extend(adm, jsonb_build_object('application_id', x4, 'days', 2, 'reason', 'zz test', 'expires_at', now()))->>'sqlstate',
      pg_temp.extend(adm, jsonb_build_object('application_id', 'ZZT-NOPE', 'days', 2, 'reason', 'zz test'))->>'message');
    t_det := t_det || (s);
    t_pass := t_pass || (s = 'BAD_VALUE: days | BAD_VALUE: days | BAD_VALUE: days | BAD_VALUE: days | REASON_REQUIRED | 22023 | NOT_FOUND'
                         and pg_temp.col(x4, 'ol_date_increase') is null);

    t_name := t_name || text 'X who may extend: campus-limited admissions only on their own campus; counsellor, interviewer, signed out refused';
    s := concat_ws(' | ',
      pg_temp.extend(adm_ggn, jsonb_build_object('application_id', x1, 'days', 1, 'reason', 'zz test'))->>'sqlstate',
      pg_temp.extend(cou, jsonb_build_object('application_id', x4, 'days', 1, 'reason', 'zz test'))->>'sqlstate',
      pg_temp.extend(ivr, jsonb_build_object('application_id', x4, 'days', 1, 'reason', 'zz test'))->>'sqlstate',
      pg_temp.call_as(null, pg_temp.rpc('vsat_offer_extend', jsonb_build_object('application_id', x4, 'days', 1, 'reason', 'zz test')), 'anon')->>'sqlstate',
      pg_temp.extend(adm_ggn, jsonb_build_object('application_id', x4, 'days', 1, 'reason', 'zz gurugram team'))->>'total_days');
    t_det := t_det || (s);
    t_pass := t_pass || (s = '42501 | 42501 | 42501 | 42501 | 1');

    -- ════ C. the table's offer columns ════
    c1 := pg_temp.mk_app('ZZT-P6-C1', pune, d, 45);   -- paid
    c2 := pg_temp.mk_app('ZZT-P6-C2', pune, d, 45);   -- lapsed
    c3 := pg_temp.mk_app('ZZT-P6-C3', pune, d, 45);   -- lapsed, then paid (payment started before the deadline)
    r := pg_temp.release(adm, array[c1, c2, c3], 7);
    update public.application_manager set enrollment_stage = 'approved', enrollment_paid_at = timestamptz '2026-11-26 11:30+05:30' where application_id = c1;
    update public.application_manager set offer_expires_at = now() - interval '1 minute' where application_id in (c2, c3);
    n := public.vsat__offers_lapse();
    update public.application_manager set enrollment_stage = 'approved', enrollment_paid_at = now() where application_id = c3;
    t_name := t_name || text 'C Seat Block Status Done + Seat Block Date when the ₹50,000 is paid';
    t_det := t_det || (format('%s %s %s', pg_temp.stage(c1), pg_temp.col(c1, 'seat_block_status'), pg_temp.col(c1, 'seat_block_date')));
    t_pass := t_pass || (pg_temp.stage(c1) = 'enrolled:active' and pg_temp.col(c1, 'seat_block_status') = 'Done'
                         and pg_temp.col(c1, 'seat_block_date')::timestamptz = timestamptz '2026-11-26 11:30+05:30'
                         and pg_temp.col(c1, 'ol_cancelled') is null and pg_temp.col(x1, 'seat_block_status') is null);
    t_name := t_name || text 'C OL Cancelled when the offer lapsed or was cancelled; not when the fee was paid after all';
    t_det := t_det || (format('c2=%s/%s x5=%s c3=%s/%s/%s x1=%s', pg_temp.stage(c2), pg_temp.col(c2, 'ol_cancelled'), pg_temp.col(x5, 'ol_cancelled'),
                              pg_temp.stage(c3), pg_temp.col(c3, 'ol_cancelled'), pg_temp.col(c3, 'seat_block_status'), pg_temp.col(x1, 'ol_cancelled')));
    t_pass := t_pass || (pg_temp.stage(c2) = 'offer_lapsed:active' and pg_temp.col(c2, 'ol_cancelled') = 'OL Cancelled'
                         and pg_temp.col(x5, 'ol_cancelled') = 'OL Cancelled' and pg_temp.stage(c3) = 'enrolled:active'
                         and pg_temp.col(c3, 'ol_cancelled') is null and pg_temp.col(c3, 'seat_block_status') = 'Done' and pg_temp.col(x1, 'ol_cancelled') is null);

    -- r3: Reminder 2 still waiting (R section, never claimed) → pays; r1: Reminder 1 was sent → pays too
    update public.application_manager set enrollment_stage = 'approved' where application_id in (r1, r3);
    t_name := t_name || text 'C a reminder still waiting when the student pays shows "Not sent (no longer live)"; a sent one stays "Sent"';
    t_det := t_det || (format('r3 %s → %s | r1 %s → %s', pg_temp.rem(r3), pg_temp.col(r3, 'ol_reminder_2'), pg_temp.rem(r1), pg_temp.col(r1, 'ol_reminder_1')));
    t_pass := t_pass || (pg_temp.rem(r3) like '%reminder_2=pending%' and pg_temp.col(r3, 'ol_reminder_2') = 'Not sent (no longer live)'
                         and pg_temp.col(r1, 'ol_reminder_1') = 'Sent');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', jsonb_build_array(x1, c1, c2),
           'columns', jsonb_build_array('offer_released_at', 'offer_expires_at', 'ol_date_increase', 'seat_block_status', 'seat_block_date',
                                        'ol_reminder_1', 'ol_reminder_2', 'ol_cancelled'), 'limit', 10)));
    t_name := t_name || text 'C the Counselling table returns the six columns';
    select string_agg(x->>'application_id' || ':' || coalesce(x->>'ol_date_increase', '-') || '/' || coalesce(x->>'seat_block_status', '-') || '/'
                      || coalesce(x->>'ol_cancelled', '-') || '/' || (x ? 'ol_reminder_1')::text || '/' || (x ? 'seat_block_date')::text, ' ' order by x->>'application_id')
      into s from jsonb_array_elements(r->'rows') x;
    t_det := t_det || (coalesce(s, r::text));
    t_pass := t_pass || (s = 'ZZT-P6-C1:-/Done/-/true/true ZZT-P6-C2:-/-/OL Cancelled/true/true ZZT-P6-X1:5/-/-/true/true');

    t_name := t_name || text 'C the columns can be filtered (OL Cancelled, Seat Block Status, OL Date Increase)';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', jsonb_build_array(x1, c1, c2, c3), 'columns', '[]'::jsonb,
           'filters', jsonb_build_array(jsonb_build_object('column', 'ol_cancelled', 'op', 'eq', 'v', 'OL Cancelled')), 'limit', 10)));
    s := (select string_agg(x->>'application_id', ',' order by x->>'application_id') from jsonb_array_elements(r->'rows') x);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', jsonb_build_array(x1, c1, c2, c3), 'columns', '[]'::jsonb,
           'filters', jsonb_build_array(jsonb_build_object('column', 'seat_block_status', 'op', 'eq', 'v', 'Done')), 'limit', 10)));
    s := s || ' | ' || coalesce((select string_agg(x->>'application_id', ',' order by x->>'application_id') from jsonb_array_elements(r->'rows') x), r::text);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', jsonb_build_array(x1, c1, c2, c3), 'columns', '[]'::jsonb,
           'filters', jsonb_build_array(jsonb_build_object('column', 'ol_date_increase', 'op', 'gte', 'v', '1')), 'limit', 10)));
    s := s || ' | ' || coalesce((select string_agg(x->>'application_id', ',' order by x->>'application_id') from jsonb_array_elements(r->'rows') x), r::text);
    t_det := t_det || (s);
    t_pass := t_pass || (s = 'ZZT-P6-C2 | ZZT-P6-C1,ZZT-P6-C3 | ZZT-P6-X1');

    -- ════ S. security and setup ════
    t_name := t_name || text 'S functions: security definer, empty search_path; helpers closed to browsers; extend for signed-in only';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in ('vsat_offer_extend', 'vsat__offer_cols', 'vsat__offer_reminder_state', 'vsat__offer_reminder_due', 'vsat__offers_remind',
                         'vsat_offer_notices_claim', 'vsat_offers_release')
       and ((p.proname <> 'vsat__offer_reminder_due' and not p.prosecdef) or p.proconfig is distinct from array['search_path=""']
            or has_function_privilege('anon', p.oid, 'execute')
            or (p.proname in ('vsat__offer_cols', 'vsat__offer_reminder_state', 'vsat__offer_reminder_due', 'vsat__offers_remind', 'vsat_offer_notices_claim')
                and has_function_privilege('authenticated', p.oid, 'execute'))
            or (p.proname in ('vsat_offer_extend', 'vsat_offers_release') and not has_function_privilege('authenticated', p.oid, 'execute')));
    t_det := t_det || (coalesce(s, 'ok')); t_pass := t_pass || (s is null);
    r := pg_temp.call_as(adm, 'select public.vsat__offer_cols(''ZZT-P6-X1'')');
    t_name := t_name || text 'S staff browsers cannot call the private column helper'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'S VSAT comms: the two reminder steps exist, OFF, in test mode, email only; the last-day step is gone';
    select string_agg(step_key || '=' || enabled || '/' || test_mode || '/' || wa_enabled || '/' || (email_subject <> '' and email_body <> '') || '/' || sort,
                      ',' order by sort) into s
      from public.vsat_comm_steps where step_key in ('offer_released', 'offer_reminder', 'offer_reminder_1', 'offer_reminder_2', 'offer_lapsed');
    t_det := t_det || (coalesce(s, '∅'));
    t_pass := t_pass || (s = 'offer_released=false/true/false/true/20,offer_reminder_1=false/true/false/true/21,offer_reminder_2=false/true/false/true/22,offer_lapsed=false/true/false/true/23');
    t_name := t_name || text 'S the reminder job is still scheduled every 15 minutes';
    select schedule || ' ' || command into s from cron.job where jobname = 'vsat-offer-remind';
    t_det := t_det || (coalesce(s, '∅')); t_pass := t_pass || (s = '1,16,31,46 * * * * select public.vsat__offers_remind()');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_offer_phase6_tests();
