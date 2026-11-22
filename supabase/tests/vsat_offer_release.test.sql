-- VSAT offers · release, email outbox, lapse — tests for migration 0144 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
-- error code at the end. Fake data only (@example.invalid, ZZTEST names).

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

-- applicant at "counselled" (scholarship given = p_pct; null = counselling not saved)
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

create or replace function pg_temp.release(p_who uuid, p_apps text[], p_dry boolean default false)
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_offers_release', jsonb_build_object('application_ids', to_jsonb(p_apps), 'dry_run', p_dry)))
$$;

create or replace function pg_temp.move(p_who uuid, p_app text, p_to text, p_reason text default null, p_status text default 'active')
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_move_stage',
    jsonb_strip_nulls(jsonb_build_object('application_id', p_app, 'to_stage', p_to, 'to_status', p_status, 'reason', p_reason))))
$$;

create or replace function pg_temp.stage(p_app text)
returns text language sql as $$ select vp.stage || ':' || vp.status from public.vsat_pipeline vp where vp.application_id = p_app $$;

create or replace function pg_temp.skip_code(r jsonb, p_app text)
returns text language sql as $$ select x->>'code' from jsonb_array_elements(r->'skipped') x where x->>'application_id' = p_app $$;

create or replace function pg_temp.run_vsat_offer_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_pune uuid; nobody uuid; d uuid;
  a1 text; a2 text; a3 text; a4 text; a5 text; a6 text; a7 text; a8 text; g1 text; s1 text;
  r jsonb; r2 jsonb; s text; n int; am public.application_manager; ev public.vsat_offer_events; t timestamptz; v_id uuid;
  today_ist date := (now() at time zone 'Asia/Kolkata')::date;
  pune constant text := 'Ajeenkya DY Patil University — Pune';
  ggn constant text := 'Sushant University — Gurugram';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-off-adm@example.invalid');
    adm_pune := pg_temp.mk_user('zztest-off-admpune@example.invalid');
    nobody := pg_temp.mk_user('zztest-off-nobody@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions');
    insert into public.vsat_team (user_id, role, campus) values (adm_pune, 'admissions', 'pune');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST offer batch', 'zz-off', current_date, now(), now() + interval '2 hours') returning id into d;
    a1 := pg_temp.mk_app('ZZT-OFF-1', pune, d, 40);
    a2 := pg_temp.mk_app('ZZT-OFF-2', pune, d, 25);
    a3 := pg_temp.mk_app('ZZT-OFF-3', pune, d, null);   -- counselling not saved
    a4 := pg_temp.mk_app('ZZT-OFF-4', pune, d, 30);
    a5 := pg_temp.mk_app('ZZT-OFF-5', pune, d, 30);
    a6 := pg_temp.mk_app('ZZT-OFF-6', pune, d, 30);
    a7 := pg_temp.mk_app('ZZT-OFF-7', pune, d, 30);
    a8 := pg_temp.mk_app('ZZT-OFF-8', pune, d, 30);
    g1 := pg_temp.mk_app('ZZT-OFF-G1', ggn, d, 50);
    s1 := pg_temp.mk_app('ZZT-OFF-S1', pune, d, 20);
    perform public.vsat__move(s1, 'counselling_scheduled', 'active', 'zz test', 'system', null, null);   -- one step back

    -- ════ A. the release button (vsat_offers_release) ════
    r := pg_temp.release(adm, array[a1, a2], true);
    t_name := t_name || text 'A preview lists both, changes nothing'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r->'released') = 2 and r->>'dry_run' = 'true' and pg_temp.stage(a1) = 'counselled:active'
                         and (select offer_released_at from public.application_manager where application_id = a1) is null
                         and not exists (select 1 from public.vsat_offer_events where application_id in (a1, a2)));
    t := (r->'released'->0->>'expires_at')::timestamptz;
    t_name := t_name || text 'A deadline = campus "Days to pay" (5), until 11:59:59 pm IST';
    t_det := t_det || (to_char(t at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'));
    t_pass := t_pass || ((t at time zone 'Asia/Kolkata')::date = today_ist + (select offer_days from public.vsat_campus_settings where campus = 'pune')
                         and to_char(t at time zone 'Asia/Kolkata', 'HH24:MI:SS') = '23:59:59');

    r := pg_temp.release(adm, array[a1, a2]);
    select * into am from public.application_manager where application_id = a1;
    t_name := t_name || text 'A release: both move to Offer sent'; t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r->'released') = 2 and pg_temp.stage(a1) = 'offer_sent:active' and pg_temp.stage(a2) = 'offer_sent:active');
    t_name := t_name || text 'A release fills what the payment gate reads';
    t_det := t_det || (format('released=%s expires=%s cancelled=%s status=%s legacy=%s/%s days=%s', am.offer_released_at, am.offer_expires_at,
                              am.offer_cancelled, am.offer_status, am.offer_released_date, am.offer_expiry_date, am.offer_pay_timeline_days));
    t_pass := t_pass || (am.offer_released_at is not null and am.offer_expires_at = t and am.offer_cancelled = false and am.offer_status = 'released'
                         and am.offer_released_date = am.offer_released_at and am.offer_expiry_date = am.offer_expires_at and am.offer_pay_timeline_days = 5
                         and am.application_stage_1::text = 'offer_released');
    select * into ev from public.vsat_offer_events where application_id = a1;
    t_name := t_name || text 'A one release event, email queued, scholarship + deadline kept';
    t_det := t_det || (format('%s %s %s %s actor=%s', ev.kind, ev.notify_status, ev.scholarship_pct, ev.expires_at, ev.actor_id = adm));
    t_pass := t_pass || ((select count(*) from public.vsat_offer_events where application_id = a1) = 1 and ev.kind = 'released'
                         and ev.notify_status = 'pending' and ev.scholarship_pct = 40 and ev.expires_at = am.offer_expires_at and ev.actor_id = adm);
    t_name := t_name || text 'A history: two students at once = source bulk';
    select string_agg(h.source, ',') into s from public.vsat_stage_history h where h.application_id = a1 and h.to_stage = 'offer_sent';
    t_det := t_det || (coalesce(s, '∅')); t_pass := t_pass || (s = 'bulk');

    r := pg_temp.release(adm, array[a1, a3, s1]);
    t_name := t_name || text 'A skips: already released / no scholarship / wrong stage';
    t_det := t_det || (r::text);
    t_pass := t_pass || (pg_temp.skip_code(r, a1) = 'ALREADY_RELEASED' and pg_temp.skip_code(r, a3) = 'NO_SCHOLARSHIP'
                         and pg_temp.skip_code(r, s1) = 'WRONG_STAGE' and jsonb_array_length(r->'released') = 0
                         and pg_temp.stage(a3) = 'counselled:active' and pg_temp.stage(s1) = 'counselling_scheduled:active');
    r := pg_temp.release(adm, array[g1]);
    t_name := t_name || text 'A one student = source manual';
    select string_agg(h.source, ',') into s from public.vsat_stage_history h where h.application_id = g1 and h.to_stage = 'offer_sent';
    t_det := t_det || (coalesce(s, '∅')); t_pass := t_pass || (s = 'manual' and pg_temp.stage(g1) = 'offer_sent:active');

    r := pg_temp.release(adm_pune, array[a4, g1]);
    t_name := t_name || text 'A campus rule: Pune admissions never sees a Gurugram student';
    t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_array_length(r->'released') = 1 and r->'released'->0->>'application_id' = a4
                         and not (r->'skipped')::text like '%ZZT-OFF-G1%');

    r := pg_temp.release(nobody, array[a5]);
    t_name := t_name || text 'A no VSAT role → refused'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'FORBIDDEN' and pg_temp.stage(a5) = 'counselled:active');
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_offers_release', jsonb_build_object('application_ids', jsonb_build_array(a5))), 'anon');
    t_name := t_name || text 'A signed out → refused'; t_det := t_det || (r::text);
    t_pass := t_pass || (r ? 'sqlstate' and pg_temp.stage(a5) = 'counselled:active');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offers_release', jsonb_build_object('application_ids', jsonb_build_array(a5), 'deadline', '2030-01-01')));
    t_name := t_name || text 'A unknown request keys are refused (no custom deadline)'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%' and pg_temp.stage(a5) = 'counselled:active');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offers_release', jsonb_build_object('application_ids', '[]'::jsonb)));
    t_name := t_name || text 'A empty selection refused'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: application_ids');

    -- ════ B. every other path into / out of Offer sent ════
    r := pg_temp.move(adm, a5, 'offer_sent');
    select * into am from public.application_manager where application_id = a5;
    t_name := t_name || text 'B Move stage to Offer sent releases the offer too'; t_det := t_det || (r::text);
    t_pass := t_pass || (pg_temp.stage(a5) = 'offer_sent:active' and am.offer_released_at is not null and am.offer_expires_at > now()
                         and exists (select 1 from public.vsat_offer_events where application_id = a5 and kind = 'released' and notify_status = 'pending'));
    r := pg_temp.move(adm, a3, 'offer_sent');
    t_name := t_name || text 'B no scholarship → the move is refused'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'NO_SCHOLARSHIP' and pg_temp.stage(a3) = 'counselled:active');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_move_bulk', jsonb_build_object('application_ids', jsonb_build_array(a3, a6), 'to_stage', 'offer_sent')));
    t_name := t_name || text 'B bulk move: released where possible, NO_SCHOLARSHIP skipped'; t_det := t_det || (r::text);
    t_pass := t_pass || ((r->>'moved')::int = 1 and r->'skipped'->0->>'code' = 'NO_SCHOLARSHIP' and pg_temp.stage(a6) = 'offer_sent:active');

    -- back and forth while the offer is still valid: nothing new
    select * into am from public.application_manager where application_id = a5;
    r := pg_temp.move(adm, a5, 'enrolled');
    perform public.vsat__move(a5, 'offer_sent', 'active', 'zz back', 'system', null, null);
    t_name := t_name || text 'B back into Offer sent before the deadline: same dates, no new email';
    t_det := t_det || (format('n=%s same=%s', (select count(*) from public.vsat_offer_events where application_id = a5 and kind = 'released'),
                              (select offer_released_at from public.application_manager where application_id = a5) = am.offer_released_at));
    t_pass := t_pass || ((select count(*) from public.vsat_offer_events where application_id = a5 and kind = 'released') = 1
                         and (select offer_released_at from public.application_manager where application_id = a5) = am.offer_released_at);

    r := pg_temp.move(adm, a2, 'offer_cancelled');
    select * into am from public.application_manager where application_id = a2;
    t_name := t_name || text 'B Offer cancelled stops the fee (offer_cancelled = true)'; t_det := t_det || (format('%s %s %s', r, am.offer_cancelled, am.offer_status));
    t_pass := t_pass || (am.offer_cancelled and am.offer_status = 'cancelled' and am.application_stage_1::text = 'offer_cancelled'
                         and exists (select 1 from public.vsat_offer_events where application_id = a2 and kind = 'cancelled'));
    r := pg_temp.move(adm, a6, 'counselled', 'zz test moved back');
    select * into am from public.application_manager where application_id = a6;
    t_name := t_name || text 'B moving back from Offer sent cancels the offer'; t_det := t_det || (format('%s %s %s', r, am.offer_cancelled, pg_temp.stage(a6)));
    t_pass := t_pass || (am.offer_cancelled and pg_temp.stage(a6) = 'counselled:active');
    r := pg_temp.release(adm, array[a6]);
    select * into am from public.application_manager where application_id = a6;
    t_name := t_name || text 'B releasing again after a cancel: a fresh, payable offer';
    t_det := t_det || (format('%s cancelled=%s', r, am.offer_cancelled));
    t_pass := t_pass || (not am.offer_cancelled and am.offer_status = 'released' and am.offer_expires_at > now()
                         and (select count(*) from public.vsat_offer_events where application_id = a6 and kind = 'released') = 2);

    -- ════ C. the lapse job ════
    r := pg_temp.release(adm, array[a7, a8]);
    update public.application_manager set offer_expires_at = now() - interval '1 minute' where application_id in (a7, a8, a4);
    update public.vsat_pipeline set status = 'on_hold' where application_id = a4;
    n := public.vsat__offers_lapse();
    t_name := t_name || text 'C past the deadline → Offer lapsed (on-hold students left alone)';
    t_det := t_det || (format('n=%s %s %s %s', n, pg_temp.stage(a7), pg_temp.stage(a8), pg_temp.stage(a4)));
    t_pass := t_pass || (n >= 2 and pg_temp.stage(a7) = 'offer_lapsed:active' and pg_temp.stage(a8) = 'offer_lapsed:active' and pg_temp.stage(a4) = 'offer_sent:on_hold');
    t_name := t_name || text 'C lapse: history by the system, offer status lapsed, lapse event (no email)';
    select h.source || '|' || coalesce(h.reason, '') into s from public.vsat_stage_history h where h.application_id = a7 and h.to_stage = 'offer_lapsed';
    t_det := t_det || (s);
    t_pass := t_pass || (s = 'system|The offer deadline passed' and (select offer_status from public.application_manager where application_id = a7) = 'lapsed'
                         and exists (select 1 from public.vsat_offer_events where application_id = a7 and kind = 'lapsed' and notify_status = 'none'));
    t_name := t_name || text 'C the job runs again safely (nothing left to lapse among these)';
    n := public.vsat__offers_lapse();
    t_det := t_det || (pg_temp.stage(a7)); t_pass := t_pass || (pg_temp.stage(a7) = 'offer_lapsed:active');

    update public.application_manager set enrollment_stage = 'approved' where application_id = a8;
    t_name := t_name || text 'C fee paid right after the lapse → Enrolled';
    select coalesce(h.reason, '') into s from public.vsat_stage_history h where h.application_id = a8 and h.to_stage = 'enrolled';
    t_det := t_det || (pg_temp.stage(a8) || ' ' || coalesce(s, '∅'));
    t_pass := t_pass || (pg_temp.stage(a8) = 'enrolled:active' and s like 'Enrollment fee paid%');

    r := pg_temp.move(adm, a7, 'offer_sent');
    t_name := t_name || text 'C re-opening a lapsed offer needs a reason'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED' and pg_temp.stage(a7) = 'offer_lapsed:active');
    r := pg_temp.move(adm, a7, 'offer_sent', 'zz student asked for more time');
    select * into am from public.application_manager where application_id = a7;
    t_name := t_name || text 'C re-opened: new deadline, new email';
    t_det := t_det || (format('%s expires=%s', pg_temp.stage(a7), am.offer_expires_at));
    t_pass := t_pass || (pg_temp.stage(a7) = 'offer_sent:active' and am.offer_expires_at > now() and am.offer_status = 'released'
                         and (select count(*) from public.vsat_offer_events where application_id = a7 and kind = 'released' and notify_status = 'pending') = 2);

    -- ════ D. the email outbox (server only) ════
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_offer_notices_claim', jsonb_build_object('application_ids', jsonb_build_array(a1, a2, a7))), 'service_role');
    t_name := t_name || text 'D claim: only current offers; a cancelled one is skipped';
    t_det := t_det || (r::text);
    t_pass := t_pass || (jsonb_typeof(r) = 'array' and jsonb_array_length(r) = 2
                         and (select notify_status from public.vsat_offer_events where application_id = a2 and kind = 'released') = 'skipped');
    t_name := t_name || text 'D claim: one job per student, the newest release (older one skipped)';
    t_det := t_det || ((select string_agg(notify_status, ',' order by released_at) from public.vsat_offer_events where application_id = a7 and kind = 'released'));
    t_pass := t_pass || ((select string_agg(notify_status, ',' order by released_at) from public.vsat_offer_events where application_id = a7 and kind = 'released') = 'skipped,sending');
    select x into r2 from jsonb_array_elements(r) x where x->'student'->>'application_no' = a1;
    t_name := t_name || text 'D job carries what the email needs';
    t_det := t_det || (r2::text);
    t_pass := t_pass || (r2->>'scholarship_pct' = '40' and r2->'student'->>'campus' = 'pune' and r2->'student'->>'email' = lower(a1) || '@example.invalid'
                         and r2->>'amount' = (select value from public.app_flags where key = 'enrollment_fee') and r2->>'expires_at' is not null);
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_offer_notice_done', jsonb_build_object('id', r2->>'id', 'status', 'sent', 'detail', jsonb_build_object('sent_to', jsonb_build_array('student')))), 'service_role');
    t_name := t_name || text 'D done: sent'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'updated' = 'true' and (select notify_status from public.vsat_offer_events where id = (r2->>'id')::uuid) = 'sent');
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_offer_notice_done', jsonb_build_object('id', r2->>'id', 'status', 'failed')), 'service_role');
    t_name := t_name || text 'D done twice: ignored'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'updated' = 'false');
    select e.id into v_id from public.vsat_offer_events e where e.application_id = a7 and e.notify_status = 'sending';
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_offer_notice_done', jsonb_build_object('id', v_id, 'status', 'failed')), 'service_role');
    t_name := t_name || text 'D failed → queued again for a retry';
    t_det := t_det || ((select notify_status || ' ' || notify_attempts from public.vsat_offer_events where id = v_id));
    t_pass := t_pass || ((select notify_status from public.vsat_offer_events where id = v_id) = 'pending');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offer_notices_claim', '{}'::jsonb));
    t_name := t_name || text 'D staff browsers cannot claim email jobs'; t_det := t_det || (r::text);
    t_pass := t_pass || (r->>'sqlstate' = '42501');

    -- ════ E. access rules in the database ════
    t_name := t_name || text 'E events table: RLS on, no browser access';
    t_det := t_det || ((select relrowsecurity::text from pg_class where oid = 'public.vsat_offer_events'::regclass));
    t_pass := t_pass || ((select relrowsecurity from pg_class where oid = 'public.vsat_offer_events'::regclass)
                         and not has_table_privilege('authenticated', 'public.vsat_offer_events', 'select')
                         and not has_table_privilege('anon', 'public.vsat_offer_events', 'select')
                         and not has_table_privilege('authenticated', 'public.vsat_offer_events', 'insert'));
    t_name := t_name || text 'E release RPC: signed-in only, security definer, empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'vsat_offers_release'
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']);
    t_det := t_det || (coalesce(s, 'ok')); t_pass := t_pass || (s is null);
    t_name := t_name || text 'E email functions: server only';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_offer_notices_claim', 'vsat_offer_notice_done')
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
            or not has_function_privilege('service_role', p.oid, 'execute') or not p.prosecdef or p.proconfig is distinct from array['search_path=""']);
    t_det := t_det || (coalesce(s, 'ok')); t_pass := t_pass || (s is null);
    t_name := t_name || text 'E helpers + lapse job: no browser role can run them; lapse not even the API';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__offer_deadline', 'vsat__offer_release', 'vsat__on_offer_stage', 'vsat__offers_lapse')
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
            or (p.proname = 'vsat__offers_lapse' and has_function_privilege('service_role', p.oid, 'execute'))
            or p.proconfig is distinct from array['search_path=""']);
    t_det := t_det || (coalesce(s, 'ok')); t_pass := t_pass || (s is null);
    t_name := t_name || text 'E the lapse job is scheduled every 15 minutes';
    select schedule || ' ' || command into s from cron.job where jobname = 'vsat-offer-lapse';
    t_det := t_det || (coalesce(s, '∅')); t_pass := t_pass || (s = '7,22,37,52 * * * * select public.vsat__offers_lapse()');
    t_name := t_name || text 'E the offer email step exists, OFF and in test mode';
    select enabled::text || ' ' || test_mode::text || ' ' || wa_enabled::text into s from public.vsat_comm_steps where step_key = 'offer_released';
    t_det := t_det || (coalesce(s, '∅')); t_pass := t_pass || (s = 'false true false');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_offer_tests();
