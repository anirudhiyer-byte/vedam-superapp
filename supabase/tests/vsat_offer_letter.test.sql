-- VSAT offer (Acceptance) letter data + offer email — tests for migration 0156 (STAGING ONLY)
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


create or replace function pg_temp.letter(p_who uuid, p jsonb default '{}'::jsonb, p_role text default 'authenticated')
returns jsonb language sql as $$ select pg_temp.call_as(p_who, pg_temp.rpc('vsat_offer_letter', p), p_role) $$;

create or replace function pg_temp.run_vsat_letter_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_pune uuid; nobody uuid; d uuid; u1 uuid; u2 uuid; ug uuid;
  a1 text; a2 text; g1 text; r jsonb; s text;
  pune constant text := 'Ajeenkya DY Patil University — Pune';
  ggn constant text := 'Sushant University — Gurugram';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-ol-adm@example.invalid');
    adm_pune := pg_temp.mk_user('zztest-ol-admpune@example.invalid');
    nobody := pg_temp.mk_user('zztest-ol-nobody@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions');
    insert into public.vsat_team (user_id, role, campus) values (adm_pune, 'admissions', 'pune');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST letter batch', 'zz-ol', current_date, now(), now() + interval '2 hours') returning id into d;
    a1 := pg_temp.mk_app('ZZT-OL-1', pune, d, 20);
    a2 := pg_temp.mk_app('ZZT-OL-2', pune, d, 30);
    g1 := pg_temp.mk_app('ZZT-OL-G1', ggn, d, 40);
    select lead_id into u1 from public.application_manager where application_id = a1;
    select lead_id into u2 from public.application_manager where application_id = a2;
    select lead_id into ug from public.application_manager where application_id = g1;

    -- ════ A. student ════
    r := pg_temp.letter(u1);
    t_name := t_name || text 'A no offer yet → nothing to show'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'available' = 'false' and r->>'reason' = 'NO_OFFER');

    perform pg_temp.release(adm, array[a1, g1]);
    r := pg_temp.letter(u1);
    t_name := t_name || text 'A after release: own letter data'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'available' = 'true' and r->>'application_id' = a1 and r->>'name' = 'ZZTEST ' || a1 and r->>'campus' = 'pune'
                         and (r->>'scholarship_pct')::numeric = 20 and (r->>'programme_fee')::numeric = (select programme_fee from public.vsat_campus_settings where campus = 'pune')
                         and (r->>'offer_days')::int = (select offer_days from public.vsat_campus_settings where campus = 'pune')
                         and r->>'seat_block' = (select value from public.app_flags where key = 'enrollment_fee')
                         and r->>'stage' = 'offer_sent' and r->>'released_at' is not null and r->>'expires_at' is not null);
    r := pg_temp.letter(ug);
    t_name := t_name || text 'A Gurugram student gets the Gurugram fee'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'campus' = 'gurugram' and (r->>'programme_fee')::numeric = (select programme_fee from public.vsat_campus_settings where campus = 'gurugram'));
    r := pg_temp.letter(u2);
    t_name := t_name || text 'A a student without an offer never gets someone else''s'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'available' = 'false');
    r := pg_temp.letter(u2, jsonb_build_object('application_id', a1));
    t_name := t_name || text 'A a student asking for another application → FORBIDDEN'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.letter(u1, '{"campus":"pune"}');
    t_name := t_name || text 'A unknown request key refused'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');

    perform public.vsat__move(a1, 'enrolled', 'active', 'zz test', 'system', null, null);
    r := pg_temp.letter(u1);
    t_name := t_name || text 'A enrolled (fee paid): still downloadable'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'available' = 'true' and r->>'stage' = 'enrolled');

    perform public.vsat__move(g1, 'offer_cancelled', 'active', 'zz test', 'system', null, null);
    r := pg_temp.letter(ug);
    t_name := t_name || text 'A cancelled offer: student gets nothing'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'available' = 'false' and r->>'reason' = 'NOT_ACTIVE');

    -- ════ B. admin / admissions ════
    r := pg_temp.letter(adm, jsonb_build_object('application_id', g1));
    t_name := t_name || text 'B admissions: any released offer on their campus, even cancelled'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'available' = 'true' and r->>'application_id' = g1 and r->>'stage' = 'offer_cancelled');
    r := pg_temp.letter(adm_pune, jsonb_build_object('application_id', g1));
    t_name := t_name || text 'B Pune-only admissions cannot read a Gurugram letter'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.letter(adm_pune, jsonb_build_object('application_id', a1));
    t_name := t_name || text 'B Pune admissions can read a Pune letter'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'available' = 'true');
    r := pg_temp.letter(adm, jsonb_build_object('application_id', a2));
    t_name := t_name || text 'B no offer released → nothing to show (admin too)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'available' = 'false' and r->>'reason' = 'NO_OFFER');
    r := pg_temp.letter(adm, jsonb_build_object('application_id', 'ZZT-NOPE'));
    t_name := t_name || text 'B unknown application → NOT_FOUND'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' = 'NOT_FOUND');
    r := pg_temp.letter(nobody, jsonb_build_object('application_id', a1));
    t_name := t_name || text 'B signed-in non-team user → FORBIDDEN'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' = 'FORBIDDEN');

    -- ════ C. not signed in ════
    r := pg_temp.letter(null);
    t_name := t_name || text 'C no user id → NOT_SIGNED_IN'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' = 'NOT_SIGNED_IN');
    r := pg_temp.letter(null, '{}', 'anon');
    t_name := t_name || text 'C anon cannot call it'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');

    -- ════ D. security shape ════
    t_name := t_name || text 'D security definer, search_path empty, authenticated only';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'vsat_offer_letter'
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
            or has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'));
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);

    -- ════ E. offer email ════
    t_name := t_name || text 'E offer email has the admissions wording + {{offer_days}}, still OFF and in test mode';
    select enabled::text || ' ' || test_mode::text || ' ' || (email_body like '%{{offer_days}}%')::text || ' ' || (email_body like 'Dear {{student_name}}%' or email_body like '<p>Dear {{student_name}},</p>%')::text
      into s from public.vsat_comm_steps where step_key = 'offer_released';
    t_det := t_det || coalesce(s, '∅'); t_pass := t_pass || (s = 'false true true true');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_letter_tests();
