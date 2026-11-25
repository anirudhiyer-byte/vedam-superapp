-- VSAT offers · reminders + lapsed email — tests for migration 0157, updated for 0189 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- 0189 (owner's decision, 25 Nov 2026, sir's review): the 0157 reminder on the offer's last day was REPLACED by sir's two
-- reminders — Reminder 1 at 10:00 am IST 3 days before the last date, Reminder 2 at 10:00 am IST 1 day before. The R / C / E
-- tests below were changed to those rules (same checks: timing, once per offer, Gurugram's own dates, who gets none, the
-- deadline, the unique key, the email job, the steps). The lapsed-email (L) and security (S) tests are unchanged.
-- Sir's reminders in more detail: vsat_offer_phase6.test.sql.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
-- error code at the end. Fake data only (@example.invalid, ZZTEST names). The reminder job gets a fixed
-- "now" (its test-only parameter), so the result never depends on the time of day the file is run.

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

-- applicant at "counselled" with a scholarship %
create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid, p_pct numeric)
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
  end loop;
  update public.application_manager set scholarship_percentage = p_pct, scholarship_pct_1 = p_pct where application_id = p_id;
  return p_id;
end $$;

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

create or replace function pg_temp.release(p_who uuid, p_apps text[])
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_offers_release', jsonb_build_object('application_ids', to_jsonb(p_apps))))
$$;

create or replace function pg_temp.move(p_who uuid, p_app text, p_to text, p_reason text default null)
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_move_stage',
    jsonb_strip_nulls(jsonb_build_object('application_id', p_app, 'to_stage', p_to, 'to_status', 'active', 'reason', p_reason))))
$$;

create or replace function pg_temp.stage(p_app text)
returns text language sql as $$ select vp.stage || ':' || vp.status from public.vsat_pipeline vp where vp.application_id = p_app $$;

-- 0189: 10:00 am IST, p_before days before the offer's last day (1 = Reminder 2, 3 = Reminder 1) (+ p_min minutes)
create or replace function pg_temp.ten_am(p_app text, p_min int default 0, p_before int default 1)
returns timestamptz language sql as $$
  select ((((a.offer_expires_at at time zone 'Asia/Kolkata')::date - p_before) + time '10:00') at time zone 'Asia/Kolkata') + make_interval(mins => p_min)
    from public.application_manager a where a.application_id = p_app
$$;

-- 0189: sir's reminders (Reminder 1 and 2) queued for the student
create or replace function pg_temp.reminders(p_app text)
returns int language sql as $$
  select count(*)::int from public.vsat_offer_events where application_id = p_app and kind in ('reminder_1', 'reminder_2')
$$;

create or replace function pg_temp.ev_status(p_app text, p_kind text)
returns text language sql as $$
  select string_agg(notify_status, ',' order by created_at) from public.vsat_offer_events where application_id = p_app and kind = p_kind
$$;

create or replace function pg_temp.run_vsat_offer_reminder_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; d uuid;
  r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; l1 text; l2 text; l3 text; l4 text;
  r jsonb; s text; n int; ev public.vsat_offer_events; t timestamptz;
  pune constant text := 'Ajeenkya DY Patil University — Pune';
  ggn constant text := 'Sushant University — Gurugram';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-rem-adm@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST reminder batch', 'zz-rem', current_date, now(), now() + interval '2 hours') returning id into d;
    r1 := pg_temp.mk_app('ZZT-REM-1', pune, d, 40);
    r2 := pg_temp.mk_app('ZZT-REM-2', ggn, d, 30);
    r3 := pg_temp.mk_app('ZZT-REM-3', pune, d, 30);
    r4 := pg_temp.mk_app('ZZT-REM-4', pune, d, 30);
    r5 := pg_temp.mk_app('ZZT-REM-5', pune, d, 30);
    r6 := pg_temp.mk_app('ZZT-REM-6', pune, d, 30);
    l1 := pg_temp.mk_app('ZZT-LAP-1', pune, d, 25);
    l2 := pg_temp.mk_app('ZZT-LAP-2', pune, d, 25);
    l3 := pg_temp.mk_app('ZZT-LAP-3', pune, d, 25);
    l4 := pg_temp.mk_app('ZZT-LAP-4', pune, d, 25);
    r := pg_temp.release(adm, array[r1, r2, r3, r4, r5, r6, l1, l2, l3, l4]);
    -- before any reminder run: fee paid (r3), cancelled (r4), on hold (r5), released after 10 am the day before its last day (r6)
    -- (released with the campus "Days to pay": Pune 2 days → only Reminder 2; Gurugram 5 days → Reminder 1 and 2)
    update public.application_manager set enrollment_stage = 'approved' where application_id = r3;   -- → Enrolled
    r := pg_temp.move(adm, r4, 'offer_cancelled', 'zz cancelled');
    update public.vsat_pipeline set status = 'on_hold' where application_id = r5;
    update public.application_manager set offer_released_at = pg_temp.ten_am(r6, 30) where application_id = r6;

    -- ════ R. the reminder job ════
    n := public.vsat__offers_remind(pg_temp.ten_am(r1, -1));
    t_name := t_name || text 'R before 10:00 am IST the day before the last day: no reminder';
    t_det := t_det || (format('queued=%s r1=%s', n, pg_temp.reminders(r1)));
    t_pass := t_pass || (pg_temp.reminders(r1) = 0);

    n := public.vsat__offers_remind(pg_temp.ten_am(r1));
    select * into ev from public.vsat_offer_events where application_id = r1 and kind = 'reminder_2';
    t_name := t_name || text 'R at 10:00 am IST the day before the last day: one Reminder 2 queued for this offer';
    t_det := t_det || (format('queued=%s status=%s released=%s/%s expires=%s/%s', n, ev.notify_status,
                              ev.released_at, (select offer_released_at from public.application_manager where application_id = r1),
                              ev.expires_at, (select offer_expires_at from public.application_manager where application_id = r1)));
    t_pass := t_pass || (pg_temp.reminders(r1) = 1 and ev.notify_status = 'pending' and ev.scholarship_pct = 40
                         and ev.released_at = (select offer_released_at from public.application_manager where application_id = r1)
                         and ev.expires_at = (select offer_expires_at from public.application_manager where application_id = r1));

    n := public.vsat__offers_remind(pg_temp.ten_am(r1, 15));
    n := public.vsat__offers_remind(pg_temp.ten_am(r1, 600));
    t_name := t_name || text 'R the job runs again: still one reminder per offer';
    t_det := t_det || (pg_temp.reminders(r1)::text); t_pass := t_pass || (pg_temp.reminders(r1) = 1);

    t_name := t_name || text 'R Gurugram (5 days): nothing on the Pune reminder day, Reminder 1 three days before its own last day';
    n := public.vsat__offers_remind(pg_temp.ten_am(r1));   -- the Pune reminder day is earlier than Gurugram's Reminder 1
    s := pg_temp.reminders(r2)::text;
    n := public.vsat__offers_remind(pg_temp.ten_am(r2, 0, 3));
    t_det := t_det || (format('on the Pune day=%s at its own Reminder 1=%s (%s)', s, pg_temp.reminders(r2), pg_temp.ev_status(r2, 'reminder_1')));
    t_pass := t_pass || (s = '0' and pg_temp.reminders(r2) = 1 and pg_temp.ev_status(r2, 'reminder_1') = 'pending');

    begin
      insert into public.vsat_offer_events (application_id, attempt_no, kind, released_at, expires_at)
      select application_id, 1, 'reminder_2', released_at, expires_at from public.vsat_offer_events where application_id = r1 and kind = 'reminder_2';
      s := 'inserted';
    exception when unique_violation then s := 'unique_violation';
    end;
    t_name := t_name || text 'R a second reminder for the same offer is refused by the database';
    t_det := t_det || (s); t_pass := t_pass || (s = 'unique_violation');

    n := public.vsat__offers_remind(pg_temp.ten_am(r3, 60));
    n := n + public.vsat__offers_remind(pg_temp.ten_am(r6, 60));
    t_name := t_name || text 'R no reminder: fee paid, offer cancelled, on hold, released after 10 am the day before the last day';
    t_det := t_det || (format('%s/%s %s/%s %s/%s %s/%s', pg_temp.stage(r3), pg_temp.reminders(r3), pg_temp.stage(r4), pg_temp.reminders(r4),
                              pg_temp.stage(r5), pg_temp.reminders(r5), pg_temp.stage(r6), pg_temp.reminders(r6)));
    t_pass := t_pass || (pg_temp.stage(r3) = 'enrolled:active' and pg_temp.stage(r4) = 'offer_cancelled:active' and pg_temp.stage(r5) = 'offer_sent:on_hold'
                         and pg_temp.reminders(r3) + pg_temp.reminders(r4) + pg_temp.reminders(r5) + pg_temp.reminders(r6) = 0);
    t := (select offer_expires_at from public.application_manager where application_id = r2) + interval '1 minute';
    delete from public.vsat_offer_events where application_id = r2 and kind in ('reminder_1', 'reminder_2');
    n := public.vsat__offers_remind(t);
    t_name := t_name || text 'R no reminder once the deadline has passed';
    t_det := t_det || (pg_temp.reminders(r2)::text); t_pass := t_pass || (pg_temp.reminders(r2) = 0);
    n := public.vsat__offers_remind(pg_temp.ten_am(r2));   -- queue Reminder 2 again for the claim tests below (Reminder 1 is past by then)

    -- ════ L. the lapse email ════
    update public.application_manager set offer_expires_at = now() - interval '1 minute' where application_id in (l1, l2, l3);
    n := public.vsat__offers_lapse();
    t_name := t_name || text 'L the lapse job queues one lapsed email per student';
    t_det := t_det || (format('%s %s %s', pg_temp.ev_status(l1, 'lapsed'), pg_temp.ev_status(l2, 'lapsed'), pg_temp.ev_status(l3, 'lapsed')));
    t_pass := t_pass || (pg_temp.stage(l1) = 'offer_lapsed:active' and pg_temp.ev_status(l1, 'lapsed') = 'pending'
                         and pg_temp.ev_status(l2, 'lapsed') = 'pending' and pg_temp.ev_status(l3, 'lapsed') = 'pending');
    r := pg_temp.move(adm, l4, 'offer_lapsed', 'zz lapsed by hand');
    t_name := t_name || text 'L moving a student to Offer lapsed by hand queues it too';
    t_det := t_det || (format('%s %s', r, pg_temp.ev_status(l4, 'lapsed')));
    t_pass := t_pass || (pg_temp.stage(l4) = 'offer_lapsed:active' and pg_temp.ev_status(l4, 'lapsed') = 'pending');
    t_name := t_name || text 'L a cancel still sends nothing';
    t_det := t_det || (coalesce(pg_temp.ev_status(r4, 'cancelled'), '∅')); t_pass := t_pass || (pg_temp.ev_status(r4, 'cancelled') = 'none');

    update public.application_manager set enrollment_stage = 'approved' where application_id = l2;   -- paid after the lapse → Enrolled
    r := pg_temp.move(adm, l3, 'offer_sent', 'zz re-opened');                                         -- re-opened → a new offer

    -- ════ C. the outbox hands out only what still fits ════
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_offer_notices_claim',
           jsonb_build_object('application_ids', jsonb_build_array(r1, r2, r3, l1, l2, l3, l4), 'limit', 100)), 'service_role');
    select string_agg(x->'student'->>'application_no' || ':' || (x->>'kind'), ',' order by x->'student'->>'application_no', x->>'kind') into s
      from jsonb_array_elements(r) x;
    t_name := t_name || text 'C claim hands out the current jobs: release + Reminder 2 (r1, r2), lapsed (l1, l4), the re-opened release (l3)';
    t_det := t_det || (s);
    t_pass := t_pass || (s = 'ZZT-LAP-1:lapsed,ZZT-LAP-3:released,ZZT-LAP-4:lapsed,ZZT-REM-1:released,ZZT-REM-1:reminder_2,ZZT-REM-2:released,ZZT-REM-2:reminder_2');
    t_name := t_name || text 'C paid after the lapse → the lapsed email is skipped';
    t_det := t_det || (format('%s %s', pg_temp.stage(l2), pg_temp.ev_status(l2, 'lapsed')));
    t_pass := t_pass || (pg_temp.stage(l2) = 'enrolled:active' and pg_temp.ev_status(l2, 'lapsed') = 'skipped');
    t_name := t_name || text 'C re-opened after the lapse → the old lapsed email is skipped';
    t_det := t_det || (pg_temp.ev_status(l3, 'lapsed')); t_pass := t_pass || (pg_temp.ev_status(l3, 'lapsed') = 'skipped');
    select x into r from jsonb_array_elements(r) x where x->'student'->>'application_no' = r1 and x->>'kind' = 'reminder_2';
    t_name := t_name || text 'C the reminder job carries what the email needs';
    t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'scholarship_pct' = '40' and r->'student'->>'campus' = 'pune' and r->>'expires_at' is not null
                         and r->>'amount' = (select value from public.app_flags where key = 'enrollment_fee'));

    -- a queued reminder whose fee gets paid before it is sent
    update public.vsat_offer_events set notify_status = 'pending' where application_id = r1 and kind = 'reminder_2';
    update public.application_manager set enrollment_stage = 'approved' where application_id = r1;
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_offer_notices_claim', jsonb_build_object('application_ids', jsonb_build_array(r1))), 'service_role');
    t_name := t_name || text 'C fee paid before the reminder went out → reminder skipped';
    t_det := t_det || (format('%s %s claimed=%s', pg_temp.stage(r1), pg_temp.ev_status(r1, 'reminder_2'), r));
    t_pass := t_pass || (pg_temp.ev_status(r1, 'reminder_2') = 'skipped' and r = '[]'::jsonb);

    -- ════ S. security ════
    r := pg_temp.call_as(adm, 'select to_jsonb(public.vsat__offers_remind())');
    t_name := t_name || text 'S staff cannot run the reminder job'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(null, 'select to_jsonb(public.vsat__offers_remind())', 'service_role');
    t_name := t_name || text 'S not even the server API can run the reminder job'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offer_notices_claim', '{}'::jsonb));
    t_name := t_name || text 'S staff browsers cannot claim email jobs'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_offer_notices_claim', '{}'::jsonb), 'anon');
    t_name := t_name || text 'S signed-out visitors cannot claim email jobs'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'S functions: security definer, empty search_path, no browser role';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__offers_remind', 'vsat__on_offer_stage', 'vsat_offer_notices_claim')
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
            or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
            or (p.proname = 'vsat__offers_remind' and has_function_privilege('service_role', p.oid, 'execute'))
            or (p.proname = 'vsat_offer_notices_claim' and not has_function_privilege('service_role', p.oid, 'execute')));
    t_det := t_det || (coalesce(s, 'ok')); t_pass := t_pass || (s is null);
    t_name := t_name || text 'S browsers still cannot read the outbox';
    t_det := t_det || (format('auth=%s anon=%s', has_table_privilege('authenticated', 'public.vsat_offer_events', 'select'),
                              has_table_privilege('anon', 'public.vsat_offer_events', 'select')));
    t_pass := t_pass || (not has_table_privilege('authenticated', 'public.vsat_offer_events', 'select')
                         and not has_table_privilege('anon', 'public.vsat_offer_events', 'select'));

    -- ════ E. setup ════
    t_name := t_name || text 'E the reminder job is scheduled every 15 minutes';
    select schedule || ' ' || command into s from cron.job where jobname = 'vsat-offer-remind';
    t_det := t_det || (coalesce(s, '∅')); t_pass := t_pass || (s = '1,16,31,46 * * * * select public.vsat__offers_remind()');
    t_name := t_name || text 'E the email steps exist (sir''s two reminders + lapsed), OFF, in test mode, email only, with a subject and body';
    select string_agg(step_key || '=' || enabled || '/' || test_mode || '/' || wa_enabled || '/' || (email_subject <> '' and email_body <> ''), ',' order by step_key)
      into s from public.vsat_comm_steps where step_key in ('offer_reminder', 'offer_reminder_1', 'offer_reminder_2', 'offer_lapsed');
    t_det := t_det || (coalesce(s, '∅'));
    t_pass := t_pass || (s = 'offer_lapsed=false/true/false/true,offer_reminder_1=false/true/false/true,offer_reminder_2=false/true/false/true');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_offer_reminder_tests();
