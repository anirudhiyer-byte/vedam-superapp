-- VSAT Phase 5 · Buckets per VSAT and campus (ARPU target, suggestion, 5-point rule, lock, live ARPU) — tests for
-- migration 0188 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- A. who can do what · B. ARPU = the engine's % · C. preview (nothing saved, one campus) · D. sir's 5-point rule
-- E. suggestion for a target · F. save (own buckets + target, students follow) · G. lock / unlock · H. grants.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private error code at
-- the end. Fake data only (@example.invalid, ZZTEST names).

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

-- a student of VSAT p_date at PI cleared; p_vsat = VSAT marks out of 50, p_c10 / p_c12 = class 10 / 12 %
create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid, p_vsat numeric, p_c10 numeric, p_c12 numeric)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    jee_registered, exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', p_campus, p_date,
    2024, p_c10, p_c10, 2026, p_c12, p_c12, false, 80, p_vsat, 50, 8.43);
  update public.application_manager set exam_given = true where application_id = p_id;
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
  end loop;
  return p_id;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
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
returns text language sql as $$ select format('select to_jsonb(public.%I(%L::jsonb))', p_fn, p::text) $$;

-- the engine's own %: score + category + step (vsat_calc_scholarship) → final (vsat_calc_final_scholarship)
create or replace function pg_temp.engine_pct(p_app text, p_campus text, p_date uuid)
returns numeric language sql as $$
  select (public.vsat_calc_final_scholarship((sc->>'auto_step')::numeric, (sc->>'jee_floor')::numeric, null, p_campus)->>'pct')::numeric
    from (select public.vsat_calc_scholarship(public.vsat__scholarship_inputs(p_app), p_campus, p_date) sc) x
$$;

create or replace function pg_temp.run_vsat_buckets_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  ad uuid; adm uuid; adm_pune uuid; cou uuid; d uuid; d2 uuid; p1 text; p2 text; p3 text; g1 text;
  r jsonb; r2 jsonb; s text; n int; x numeric; pune_bands jsonb; good jsonb; ruled jsonb;
begin
  begin -- rolled back at the end (ZDONE)
    ad := pg_temp.mk_user('zztest-bk-admin@example.invalid');
    adm := pg_temp.mk_user('zztest-bk-adm@example.invalid');
    adm_pune := pg_temp.mk_user('zztest-bk-admpune@example.invalid');
    cou := pg_temp.mk_user('zztest-bk-cou@example.invalid');
    insert into public.user_roles (user_id, role) values (ad, 'admin');
    insert into public.vsat_team (user_id, role, campus) values (adm, 'admissions', null), (adm_pune, 'admissions', 'pune'), (cou, 'counsellor', null);
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST BK VSAT', 'zz-bk', current_date, now(), now() + interval '2 hours') returning id into d;
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST BK VSAT 2', 'zz-bk2', current_date, now(), now() + interval '2 hours') returning id into d2;
    p1 := pg_temp.mk_app('ZZT-BK-P1', 'Ajeenkya DY Patil University — Pune', d, 48, 95, 92);
    p2 := pg_temp.mk_app('ZZT-BK-P2', 'Ajeenkya DY Patil University — Pune', d, 35, 80, 75);
    p3 := pg_temp.mk_app('ZZT-BK-P3', 'Ajeenkya DY Patil University — Pune', d, 20, 60, 55);
    g1 := pg_temp.mk_app('ZZT-BK-G1', 'Sushant University — Gurugram', d, 40, 85, 80);

    -- ── A. who can do what ──
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_get', jsonb_build_object('exam_date_id', d)));
    t_name := t_name || text 'A an admin sees both campuses and may edit';
    t_det := t_det || format('can_edit=%s campuses=%s', r->'can_edit', (select string_agg(c->>'campus', ',') from jsonb_array_elements(r->'campuses') c));
    t_pass := t_pass || coalesce((r->>'can_edit')::boolean and jsonb_array_length(r->'campuses') = 2, false);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_buckets_get', jsonb_build_object('exam_date_id', d)));
    t_name := t_name || text 'A admissions (all campuses) see both campuses, read only';
    t_det := t_det || format('can_edit=%s n=%s', r->'can_edit', jsonb_array_length(r->'campuses'));
    t_pass := t_pass || coalesce(not (r->>'can_edit')::boolean and jsonb_array_length(r->'campuses') = 2, false);
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_buckets_get', jsonb_build_object('exam_date_id', d)));
    t_name := t_name || text 'A Pune-only admissions see Pune only (overall = Pune)';
    t_det := t_det || format('%s overall=%s', (select string_agg(c->>'campus', ',') from jsonb_array_elements(r->'campuses') c), r->'overall');
    t_pass := t_pass || coalesce(jsonb_array_length(r->'campuses') = 1 and r->'campuses'->0->>'campus' = 'pune'
                                 and (r->'overall'->>'students')::int = 3, false);
    s := '';
    r := pg_temp.call_as(cou, pg_temp.rpc('vsat_buckets_get', jsonb_build_object('exam_date_id', d))); s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_buckets_get', jsonb_build_object('exam_date_id', d)), 'anon'); s := s || coalesce(r->>'sqlstate', 'ok') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_buckets_preview', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands', '[]'::jsonb))); s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_buckets_suggest', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'arpu_target', 1))); s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_buckets_save', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands', '[]'::jsonb))); s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_buckets_lock', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'locked', true))); s := s || coalesce(r->>'message', 'ok');
    t_name := t_name || text 'A refused: a counsellor, signed out, and admissions for preview / suggest / save / lock';
    t_det := t_det || s; t_pass := t_pass || (s = 'FORBIDDEN | 42501 | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN');

    -- ── B. ARPU = fee − the engine's %, averaged ──
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_get', jsonb_build_object('exam_date_id', d)));
    select c into r2 from jsonb_array_elements(r->'campuses') c where c->>'campus' = 'pune';
    x := (select round(avg(1850000 * (1 - pg_temp.engine_pct(a, 'pune', d) / 100))) from unnest(array[p1, p2, p3]) a);
    t_name := t_name || text 'B Pune ARPU = average of (fee − fee × the engine''s %) over the VSAT''s Pune students';
    t_det := t_det || format('arpu=%s expected=%s students=%s own=%s', r2->'current'->>'arpu', x, r2->'current'->>'students', r2->>'own');
    t_pass := t_pass || coalesce((r2->'current'->>'arpu')::numeric = x and (r2->'current'->>'students')::int = 3 and not (r2->>'own')::boolean, false);
    t_name := t_name || text 'B overall ARPU = students-weighted average of both campuses';
    x := ((r2->'current'->>'arpu')::numeric * 3
          + (select (c->'current'->>'arpu')::numeric from jsonb_array_elements(r->'campuses') c where c->>'campus' = 'gurugram')) / 4;
    t_det := t_det || format('%s vs %s', r->'overall'->>'arpu', round(x));
    t_pass := t_pass || coalesce((r->'overall'->>'arpu')::numeric = round(x) and (r->'overall'->>'students')::int = 4, false);
    pune_bands := r2->'bands';

    -- ── C. preview ──
    -- every Pune award up by 5 points: more scholarship, lower ARPU; nothing saved; Gurugram not part of it
    select jsonb_agg(jsonb_set(jsonb_set(b, '{min_award}', to_jsonb(least((b->>'min_award')::numeric + 5, 100 - ((b->>'max_award')::numeric - (b->>'min_award')::numeric)))),
                                '{max_award}', to_jsonb(least((b->>'min_award')::numeric + 5, 100 - ((b->>'max_award')::numeric - (b->>'min_award')::numeric))
                                                        + ((b->>'max_award')::numeric - (b->>'min_award')::numeric))) order by (b->>'category')::int)
      into good from jsonb_array_elements(pune_bands) b;
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_preview', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands', good)));
    t_name := t_name || text 'C preview: higher awards → lower Pune ARPU; nothing is saved';
    t_det := t_det || format('preview=%s now=%s saved_rows=%s', r->>'arpu', r2->'current'->>'arpu',
                             (select count(*) from public.vsat_scholarship_bands b where b.exam_date_id = d));
    t_pass := t_pass || coalesce((r->>'arpu')::numeric < (r2->'current'->>'arpu')::numeric and r->>'campus' = 'pune'
                                 and (select count(*) from public.vsat_scholarship_bands b where b.exam_date_id = d) = 0, false);
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_preview', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands',
           '[{"category":1,"min_score":10,"max_score":100,"steps":2,"min_award":5,"max_award":10}]'::jsonb)));
    t_name := t_name || text 'C preview refuses a broken set (same rules as Scholarship & Scoring)';
    t_det := t_det || coalesce(r->>'message', 'not refused'); t_pass := t_pass || coalesce(r->>'message' like 'BAD_BANDS: the last category must start at 0%', false);

    -- ── D. sir's 5-point rule (Buckets page) ──
    ruled := '[{"category":1,"min_score":50,"max_score":100,"steps":3,"min_award":40,"max_award":60},{"category":2,"min_score":0,"max_score":50,"steps":2,"min_award":5,"max_award":10}]';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_save', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands', ruled)));
    t_name := t_name || text 'D Buckets save refuses 3 buckets over a 20-point range (must be 10: 5 each)';
    t_det := t_det || coalesce(r->>'message', 'not refused');
    t_pass := t_pass || coalesce(r->>'message' = 'BAD_BANDS: category 1 has 3 buckets, so its award range must be 10 points (5 each)'
                                 and not exists (select 1 from public.vsat_scholarship_bands b where b.exam_date_id = d), false);
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_settings_bands_set', jsonb_build_object('exam_date_id', d2, 'campus', 'pune', 'bands', ruled)));
    t_name := t_name || text 'D Scholarship & Scoring keeps the 0098 rules (the same set saves there)';
    t_det := t_det || r::text; t_pass := t_pass || coalesce(r->>'ok' = 'true', false);

    -- ── E. suggestion ──
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_suggest', jsonb_build_object('exam_date_id', d, 'campus', 'pune',
           'arpu_target', (r2->'current'->>'arpu')::numeric + 50000)));
    t_name := t_name || text 'E a target above today''s ARPU: awards move down in 5-point steps, bucket counts and spans kept, target met';
    t_det := t_det || format('reached=%s shift=%s arpu=%s target=%s', r->'reached', r->'shift', r->'suggested'->>'arpu', r->'arpu_target');
    t_pass := t_pass || coalesce((r->>'reached')::boolean and (r->>'shift')::int < 0 and (r->>'shift')::int % 5 = 0
                                 and (r->'suggested'->>'arpu')::numeric >= (r->>'arpu_target')::numeric
                                 and not exists (select 1 from jsonb_array_elements(r->'bands') b join jsonb_array_elements(pune_bands) o on (o->>'category') = (b->>'category')
                                                  where (b->>'steps') <> (o->>'steps') or (b->>'min_score')::numeric <> (o->>'min_score')::numeric
                                                     or (b->>'max_award')::numeric - (b->>'min_award')::numeric <> (o->>'max_award')::numeric - (o->>'min_award')::numeric
                                                     or (b->>'min_award')::numeric < 0 or (b->>'max_award')::numeric > 100), false);
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_suggest', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'arpu_target', 99999999)));
    t_name := t_name || text 'E an impossible target: not reached, the highest ARPU possible is offered';
    t_det := t_det || format('reached=%s arpu=%s', r->'reached', r->'suggested'->>'arpu');
    t_pass := t_pass || coalesce(not (r->>'reached')::boolean and (r->'suggested'->>'arpu')::numeric >= (r2->'current'->>'arpu')::numeric, false);

    -- ── F. save ──
    select jsonb_agg(b order by (b->>'category')::int) into good from jsonb_array_elements(r->'bands') b;  -- the suggested set (keeps sir's rule only if the default did)
    good := (select jsonb_agg(jsonb_set(b, '{max_award}', to_jsonb((b->>'min_award')::numeric + 5 * ((b->>'steps')::int - 1))) order by (b->>'category')::int)
               from jsonb_array_elements(good) b);  -- make every category follow the 5-point rule
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_save', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands', good, 'arpu_target', 1300000)));
    t_name := t_name || text 'F save: the VSAT gets its own Pune buckets and the ARPU target; both are in the settings audit';
    select count(*) into n from public.vsat_settings_audit a where a.user_id = ad and a.area = 'bands' and (a.target = 'pune:' || d::text or a.target = 'arpu_target:pune:' || d::text);
    t_det := t_det || format('%s rows=%s target=%s audit=%s', left(coalesce(r->>'message', 'ok'), 80),
                             (select count(*) from public.vsat_scholarship_bands b where b.exam_date_id = d and b.campus = 'pune'),
                             (select s.arpu_target from public.vsat_bucket_sets s where s.exam_date_id = d and s.campus = 'pune'), n);
    t_pass := t_pass || coalesce(r->>'ok' = 'true' and (select count(*) from public.vsat_scholarship_bands b where b.exam_date_id = d and b.campus = 'pune') = jsonb_array_length(good)
                                 and (select s.arpu_target from public.vsat_bucket_sets s where s.exam_date_id = d and s.campus = 'pune') = 1300000 and n = 2, false);
    t_name := t_name || text 'F the students'' % now come from the VSAT''s buckets (the engine reads them); Gurugram and other VSATs unchanged';
    x := (select round(avg(1850000 * (1 - pg_temp.engine_pct(a, 'pune', d) / 100))) from unnest(array[p1, p2, p3]) a);
    t_det := t_det || format('saved arpu=%s engine=%s', r->'current'->>'arpu', x);
    t_pass := t_pass || coalesce((r->'current'->>'arpu')::numeric = x
                                 and not exists (select 1 from public.vsat_scholarship_bands b where b.exam_date_id = d and b.campus = 'gurugram'), false);

    -- ── G. lock ──
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_lock', jsonb_build_object('exam_date_id', d, 'campus', 'gurugram', 'locked', true)));
    t_name := t_name || text 'G locking Gurugram (no own buckets yet) freezes a copy of the default';
    t_det := t_det || format('%s copied=%s', r, (select count(*) from public.vsat_scholarship_bands b where b.exam_date_id = d and b.campus = 'gurugram'));
    t_pass := t_pass || coalesce(r->>'ok' = 'true' and (select count(*) from public.vsat_scholarship_bands b where b.exam_date_id = d and b.campus = 'gurugram')
                                 = (select count(*) from public.vsat_scholarship_bands b where b.exam_date_id is null and b.campus = 'gurugram')
                                 and (select s.locked_at is not null and s.locked_by = ad from public.vsat_bucket_sets s where s.exam_date_id = d and s.campus = 'gurugram'), false);
    r2 := public.vsat__bands_in_use('gurugram', d);
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_settings_bands_set', jsonb_build_object('exam_date_id', null, 'campus', 'gurugram', 'bands',
           (select jsonb_agg(jsonb_set(jsonb_set(b, '{min_award}', to_jsonb((b->>'min_award')::numeric / 2)), '{max_award}', to_jsonb((b->>'max_award')::numeric / 2)) order by (b->>'category')::int)
              from jsonb_array_elements(public.vsat__bands_in_use('gurugram', null)) b))));
    t_name := t_name || text 'G a later change to the Gurugram default does not touch the locked VSAT';
    t_det := t_det || format('default saved=%s locked unchanged=%s', r->>'ok', public.vsat__bands_in_use('gurugram', d) = r2);
    t_pass := t_pass || coalesce(r->>'ok' = 'true' and public.vsat__bands_in_use('gurugram', d) = r2, false);
    s := '';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_save', jsonb_build_object('exam_date_id', d, 'campus', 'gurugram', 'bands', r2))); s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_settings_bands_set', jsonb_build_object('exam_date_id', d, 'campus', 'gurugram', 'bands', '[]'::jsonb))); s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_lock', jsonb_build_object('exam_date_id', d, 'campus', 'gurugram', 'locked', true))); s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_lock', jsonb_build_object('exam_date_id', d, 'campus', 'gurugram', 'locked', false))); s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_lock', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'locked', false, 'reason', 'zz test'))); s := s || coalesce(r->>'message', 'ok');
    t_name := t_name || text 'G refused while locked: Buckets save, Scholarship & Scoring edit, lock again; unlock without a reason; unlock what is not locked';
    t_det := t_det || s; t_pass := t_pass || (s = 'LOCKED | LOCKED | ALREADY_LOCKED | BAD_VALUE: reason | NOT_LOCKED');
    r := pg_temp.call_as(ad, pg_temp.rpc('vsat_buckets_lock', jsonb_build_object('exam_date_id', d, 'campus', 'gurugram', 'locked', false, 'reason', 'zz wrong VSAT')));
    t_name := t_name || text 'G an admin unlocks with a reason (kept in the audit); the VSAT keeps its own copy';
    select count(*) into n from public.vsat_settings_audit a where a.user_id = ad and a.target = 'lock:gurugram:' || d::text and a.after->>'reason' = 'zz wrong VSAT';
    t_det := t_det || format('%s audit=%s own=%s', r, n, (select count(*) from public.vsat_scholarship_bands b where b.exam_date_id = d and b.campus = 'gurugram'));
    t_pass := t_pass || coalesce(r->>'ok' = 'true' and n = 1
                                 and (select s.locked_at is null from public.vsat_bucket_sets s where s.exam_date_id = d and s.campus = 'gurugram')
                                 and exists (select 1 from public.vsat_scholarship_bands b where b.exam_date_id = d and b.campus = 'gurugram'), false);

    -- ── H. grants ──
    t_name := t_name || text 'H page functions: definer, empty search_path, signed-in only; helpers and the table closed to browsers';
    select string_agg(p.proname, ',') into s from pg_proc p where p.pronamespace = 'public'::regnamespace
       and (   (p.proname in ('vsat_buckets_get', 'vsat_buckets_preview', 'vsat_buckets_suggest', 'vsat_buckets_save', 'vsat_buckets_lock')
                and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'] or has_function_privilege('anon', p.oid, 'execute')
                     or not has_function_privilege('authenticated', p.oid, 'execute')))
            or (p.proname in ('vsat__bands_check', 'vsat__bands_in_use', 'vsat__calc_safe', 'vsat__bucket_pop', 'vsat__bucket_cat', 'vsat__bucket_pct',
                              'vsat__bucket_arpu', 'vsat__bucket_viewer', 'vsat__bucket_args')
                and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))));
    s := coalesce(s, '') || case when (select c.relrowsecurity and not exists (select 1 from pg_policies pp where pp.schemaname = 'public' and pp.tablename = 'vsat_bucket_sets')
                                              and not has_table_privilege('authenticated', c.oid, 'select') and not has_table_privilege('anon', c.oid, 'select')
                                         from pg_class c where c.oid = 'public.vsat_bucket_sets'::regclass) then '' else ' table' end;
    t_det := t_det || coalesce(nullif(s, ''), 'ok'); t_pass := t_pass || (s = '');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_buckets_tests();
