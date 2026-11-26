-- VSAT Counselling table · sir's "Confirmation", "Additional Comments", "Proposed Fee" — tests for migration 0193 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- A. who may read and change them · B. Additional comments and Proposed fee (save, keep, clear, checks, stage, log)
-- C. Confirmation (online booking only, tied to its slot, cleared on a move) · D. the Counselling table (columns, values,
-- filters, a counsellor's view) · E. the drawer's read.
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

-- a student moved through the stages up to p_upto; p_mode = the counselling mode
create or replace function pg_temp.mk_app(p_id text, p_date uuid, p_campus text, p_mode text, p_upto text)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, jee_registered, entrance_percentile, jee_main_maths_percentile,
    exam_percentile, exam_obtained_marks, exam_max_marks, vps_score, counselling_mode)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', p_campus, p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, false, null, null, 80, 40, 50, 8.43, p_mode);
  update public.application_manager set exam_given = true where application_id = p_id;
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
    exit when s = p_upto;
  end loop;
  return p_id;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
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

create or replace function pg_temp.slot(p_days int)
returns text language sql as $$ select to_char(now() + make_interval(days => p_days), 'YYYY-MM-DD"T"HH24:00:00"Z"') $$;

create or replace function pg_temp.run_vsat_counselling_notes_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; admp uuid; c1 uuid; usr uuid; d uuid; on1 text; of1 text; nb1 text; wr1 text; gg1 text;
  r jsonb; r2 jsonb; s text; n int; m int; fee numeric; ok boolean;
  pune text := 'Ajeenkya DY Patil University — Pune'; ggn text := 'Sushant University — Gurugram';
  zl text := 'https://us06web.zoom.us/j/44444444444?pwd=zznotes';
  ids jsonb;
begin
  begin -- rolled back at the end (ZDONE)
    adm  := pg_temp.mk_user('zztest-cn-adm@example.invalid');
    admp := pg_temp.mk_user('zztest-cn-admp@example.invalid');
    c1   := pg_temp.mk_user('zztest-cn-cou1@example.invalid');
    usr  := pg_temp.mk_user('zztest-cn-usr@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values (adm, 'admissions', null), (admp, 'admissions', 'pune'), (c1, 'counsellor', null);
    insert into public.vsat_counsellor_zoom (counsellor_id, zoom_link) values (c1, zl);
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST CN VSAT', 'zz-cn', current_date, now(), now() + interval '2 hours') returning id into d;
    on1 := pg_temp.mk_app('ZZT-CN-ON', d, pune, 'online', 'pi_cleared');
    of1 := pg_temp.mk_app('ZZT-CN-OF', d, pune, 'offline', 'pi_cleared');
    nb1 := pg_temp.mk_app('ZZT-CN-NB', d, pune, 'online', 'pi_cleared');
    wr1 := pg_temp.mk_app('ZZT-CN-WR', d, pune, 'online', 'vsat_cleared');
    gg1 := pg_temp.mk_app('ZZT-CN-GG', d, ggn, 'online', 'pi_cleared');
    ids := jsonb_build_array(on1, of1, nb1, wr1, gg1);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', on1, 'counsellor_id', c1, 'slot_datetime', pg_temp.slot(3))));
    if r ? 'sqlstate' then raise exception 'fixture on1: %', r; end if;
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', of1, 'counsellor_id', c1, 'slot_datetime', pg_temp.slot(4))));
    if r ? 'sqlstate' then raise exception 'fixture of1: %', r; end if;
    select s2.programme_fee into fee from public.vsat_campus_settings s2 where s2.campus = 'pune';

    -- ── A. access ──
    select format('get anon=%s auth=%s | set anon=%s auth=%s | helper anon=%s auth=%s | table auth=%s anon=%s',
                  has_function_privilege('anon', 'public.vsat_counselling_notes_get(jsonb)', 'execute'),
                  has_function_privilege('authenticated', 'public.vsat_counselling_notes_get(jsonb)', 'execute'),
                  has_function_privilege('anon', 'public.vsat_counselling_notes_set(jsonb)', 'execute'),
                  has_function_privilege('authenticated', 'public.vsat_counselling_notes_set(jsonb)', 'execute'),
                  has_function_privilege('anon', 'public.vsat__counselling_notes_cols(text)', 'execute'),
                  has_function_privilege('authenticated', 'public.vsat__counselling_notes_cols(text)', 'execute'),
                  has_table_privilege('authenticated', 'public.vsat_counselling_notes', 'select'),
                  has_table_privilege('anon', 'public.vsat_counselling_notes', 'select')),
           not has_function_privilege('anon', 'public.vsat_counselling_notes_get(jsonb)', 'execute')
       and has_function_privilege('authenticated', 'public.vsat_counselling_notes_get(jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.vsat_counselling_notes_set(jsonb)', 'execute')
       and has_function_privilege('authenticated', 'public.vsat_counselling_notes_set(jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.vsat__counselling_notes_cols(text)', 'execute')
       and not has_function_privilege('authenticated', 'public.vsat__counselling_notes_cols(text)', 'execute')
       and not has_table_privilege('authenticated', 'public.vsat_counselling_notes', 'select')
       and not has_table_privilege('anon', 'public.vsat_counselling_notes', 'select')
      into s, ok;
    t_name := t_name || text 'A browsers: get / set for signed-in users only; the helper and the table are closed';
    t_det := t_det || s;
    t_pass := t_pass || coalesce(ok, false);

    r  := pg_temp.call_as(usr, pg_temp.rpc('vsat_counselling_notes_get', jsonb_build_object('application_id', nb1)));
    r2 := pg_temp.call_as(usr, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'additional_comments', 'zz')));
    t_name := t_name || text 'A a signed-in user with no VSAT role can neither read nor change them';
    t_det := t_det || format('%s | %s', r->>'message', r2->>'message');
    t_pass := t_pass || coalesce(r->>'message' = 'FORBIDDEN' and r2->>'message' = 'FORBIDDEN', false);

    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', on1, 'additional_comments', 'zz')));
    t_name := t_name || text 'A the student''s own counsellor can''t change them (admins and admissions only)';
    t_det := t_det || coalesce(r->>'message', r::text); t_pass := t_pass || coalesce(r->>'message' = 'FORBIDDEN', false);

    r  := pg_temp.call_as(admp, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', gg1, 'additional_comments', 'zz')));
    r2 := pg_temp.call_as(admp, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'additional_comments', 'zz pune ok')));
    t_name := t_name || text 'A admissions limited to Pune: not a Gurugram student, yes a Pune student';
    t_det := t_det || format('%s | %s', r->>'message', coalesce(r2->>'message', r2->>'additional_comments'));
    t_pass := t_pass || coalesce(r->>'message' = 'FORBIDDEN' and r2->>'additional_comments' = 'zz pune ok', false);

    -- ── B. Additional comments and Proposed fee ──
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1,
           'additional_comments', '  zz father will call back on Monday  ', 'proposed_fee', 1500000)));
    t_name := t_name || text 'B save both (text trimmed): the answer is what the drawer reads';
    t_det := t_det || left(r::text, 220);
    t_pass := t_pass || coalesce(r->>'additional_comments' = 'zz father will call back on Monday' and (r->>'proposed_fee')::numeric = 1500000
                                 and (r->>'editable')::boolean and (r->>'programme_fee')::numeric = fee, false);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'proposed_fee', 1400000)));
    t_name := t_name || text 'B a key left out stays as it is (only the fee changed)';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || coalesce(r->>'additional_comments' = 'zz father will call back on Monday' and (r->>'proposed_fee')::numeric = 1400000, false);

    select count(*) into n from public.crm_activity_log l where l.application_id = nb1 and l.action = 'counselling_notes';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'proposed_fee', 1400000)));
    select count(*) into m from public.crm_activity_log l where l.application_id = nb1 and l.action = 'counselling_notes';
    select l.metadata::text into s from public.crm_activity_log l where l.application_id = nb1 and l.action = 'counselling_notes'
     order by l.id desc limit 1;
    t_name := t_name || text 'B every change is logged with before and after; saving the same value logs nothing';
    t_det := t_det || format('logs %s → %s | %s', n, m, left(coalesce(s, '-'), 160));
    t_pass := t_pass || coalesce(n = 3 and m = 3 and s like '%proposed_fee%', false);

    r  := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'additional_comments', '   ')));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'proposed_fee', null)));
    t_name := t_name || text 'B empty text or null clears a field';
    t_det := t_det || format('%s | %s', left(r::text, 120), left(r2::text, 120));
    t_pass := t_pass || coalesce(r->'additional_comments' = 'null'::jsonb and r2->'proposed_fee' = 'null'::jsonb and r2->'additional_comments' = 'null'::jsonb, false);

    s := '';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'additional_comments', repeat('z', 2001))));
    s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'proposed_fee', -1)));
    s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'proposed_fee', 1000.5)));
    s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'proposed_fee', fee + 1)));
    s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'proposed_fee', '1500000')));
    s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'evil', 1)));
    s := s || coalesce(r->>'message', 'ok') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1)));
    s := s || coalesce(r->>'message', 'ok');
    t_name := t_name || text 'B refused: text over 2,000 characters, a negative / part-rupee / above-programme-fee / text fee, an unknown key, nothing to change';
    t_det := t_det || s;
    t_pass := t_pass || (s = 'BAD_VALUE: additional_comments | BAD_VALUE: proposed_fee | BAD_VALUE: proposed_fee | BAD_VALUE: proposed_fee | BAD_VALUE: proposed_fee | UNKNOWN_KEY: evil | BAD_REQUEST');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', wr1, 'additional_comments', 'zz')));
    t_name := t_name || text 'B a student before PI cleared can''t get them (WRONG_STAGE)';
    t_det := t_det || coalesce(r->>'message', r::text); t_pass := t_pass || coalesce(r->>'message' = 'WRONG_STAGE', false);

    -- ── C. Confirmation ──
    r  := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', nb1, 'confirmation', true)));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', of1, 'confirmation', true)));
    t_name := t_name || text 'C Confirmation needs a live online booking: not without a booking, not for an offline session';
    t_det := t_det || format('%s | %s', r->>'message', r2->>'message');
    t_pass := t_pass || coalesce(r->>'message' = 'NO_ONLINE_BOOKING' and r2->>'message' = 'NO_ONLINE_BOOKING', false);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', on1, 'confirmation', 'yes')));
    t_name := t_name || text 'C Confirmation is Yes / No (true / false) or null';
    t_det := t_det || coalesce(r->>'message', r::text); t_pass := t_pass || coalesce(r->>'message' = 'BAD_VALUE: confirmation', false);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', on1, 'confirmation', true)));
    select format('confirmed=%s same_slot=%s', n2.confirmed, n2.confirmed_slot = ca.slot_datetime), n2.confirmed and n2.confirmed_slot = ca.slot_datetime
      into s, ok
      from public.vsat_counselling_notes n2 join public.counselling_assignments ca on ca.application_id = n2.application_id
     where n2.application_id = on1;
    t_name := t_name || text 'C online booking: Yes is saved for that slot, and the read shows it with the slot';
    t_det := t_det || format('%s | %s', s, left(r::text, 200));
    t_pass := t_pass || coalesce((r->>'confirmation')::boolean and r->>'online_slot' is not null and ok, false);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', on1, 'counsellor_id', c1, 'slot_datetime', pg_temp.slot(6))));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_get', jsonb_build_object('application_id', on1)));
    t_name := t_name || text 'C the session is moved: the old Yes no longer shows (it was for the old slot)';
    t_det := t_det || format('%s | %s', left(coalesce(r->>'message', 'moved'), 60), left(r2::text, 200));
    t_pass := t_pass || coalesce(not (r ? 'sqlstate') and r2->'confirmation' = 'null'::jsonb and r2->>'online_slot' is not null, false);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', on1, 'confirmation', true)));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_set', jsonb_build_object('application_id', of1, 'additional_comments', 'zz offline ok', 'proposed_fee', 1600000)));
    t_name := t_name || text 'C Yes again for the new slot; an offline student still gets comments and a fee';
    t_det := t_det || format('%s | %s', r->>'confirmation', left(r2::text, 120));
    t_pass := t_pass || coalesce((r->>'confirmation')::boolean and r2->>'additional_comments' = 'zz offline ok', false);

    -- ── D. the Counselling table ──
    select string_agg(c.key || ':' || c.grp || ':' || c.typ || ':' || c.virt || ':' || (public.vsat__grid_virt_expr(c.key) is not null), ',' order by c.key)
      into s from public.vsat__grid_catalog() c where c.key in ('cs_confirmation', 'cs_additional_comments', 'cs_proposed_fee');
    t_name := t_name || text 'D the three columns are in the column list: Counselling, filterable';
    t_det := t_det || coalesce(s, '∅');
    t_pass := t_pass || (s = 'cs_additional_comments:Counselling:text:true:true,cs_confirmation:Counselling:bool:true:true,cs_proposed_fee:Counselling:num:true:true');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', ids,
           'columns', '["cs_confirmation","cs_additional_comments","cs_proposed_fee"]'::jsonb, 'limit', 50)));
    select string_agg(x->>'application_id' || '=' || coalesce(x->>'cs_confirmation', '-') || '/' || coalesce(x->>'cs_additional_comments', '-') || '/' || coalesce(x->>'cs_proposed_fee', '-'), ' ' order by x->>'application_id')
      into s from jsonb_array_elements(coalesce(r->'rows', '[]'::jsonb)) x;
    t_name := t_name || text 'D the table shows them (empty for students without any, or with them cleared)';
    t_det := t_det || coalesce(s, left(r::text, 200));
    t_pass := t_pass || coalesce(s = 'ZZT-CN-GG=-/-/- ZZT-CN-NB=-/-/- ZZT-CN-OF=-/zz offline ok/1600000 ZZT-CN-ON=true/-/- ZZT-CN-WR=-/-/-', false);

    r  := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', ids, 'columns', '[]'::jsonb,
           'filters', '[{"column":"cs_confirmation","op":"true"}]'::jsonb)));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', ids, 'columns', '[]'::jsonb,
           'filters', '[{"column":"cs_proposed_fee","op":"gte","v":"1500000"}]'::jsonb)));
    select string_agg(x->>'application_id', ',' order by x->>'application_id') into s from jsonb_array_elements(coalesce(r->'rows', '[]'::jsonb)) x;
    select s || ' | ' || coalesce(string_agg(x->>'application_id', ',' order by x->>'application_id'), '-') into s from jsonb_array_elements(coalesce(r2->'rows', '[]'::jsonb)) x;
    r  := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', ids, 'columns', '[]'::jsonb,
           'filters', '[{"column":"cs_additional_comments","op":"contains","v":"OFFLINE"}]'::jsonb)));
    select s || ' | ' || coalesce(string_agg(x->>'application_id', ',' order by x->>'application_id'), '-') into s from jsonb_array_elements(coalesce(r->'rows', '[]'::jsonb)) x;
    t_name := t_name || text 'D filters: Confirmation is Yes · Proposed fee ≥ 15,00,000 · Additional comments contains "offline"';
    t_det := t_det || coalesce(s, '∅');
    t_pass := t_pass || coalesce(s = 'ZZT-CN-ON | ZZT-CN-OF | ZZT-CN-OF', false);

    r := pg_temp.call_as(c1, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', ids,
           'columns', '["cs_confirmation","cs_additional_comments","cs_proposed_fee"]'::jsonb)));
    select string_agg(x->>'application_id' || '=' || coalesce(x->>'cs_confirmation', '-') || '/' || coalesce(x->>'cs_proposed_fee', '-'), ' ' order by x->>'application_id')
      into s from jsonb_array_elements(coalesce(r->'rows', '[]'::jsonb)) x;
    t_name := t_name || text 'D a counsellor sees them in the table for their own students only';
    t_det := t_det || coalesce(s, left(r::text, 200));
    t_pass := t_pass || coalesce(s = 'ZZT-CN-OF=-/1600000 ZZT-CN-ON=true/-', false);

    -- ── E. the drawer's read ──
    r  := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_get', jsonb_build_object('application_id', wr1)));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_get', jsonb_build_object('application_id', of1)));
    t_name := t_name || text 'E read: not editable before PI cleared; an offline booking has no online slot to confirm';
    t_det := t_det || format('%s | %s', left(r::text, 120), left(r2::text, 160));
    t_pass := t_pass || coalesce(not (r->>'editable')::boolean and r->'additional_comments' = 'null'::jsonb
                                 and (r2->>'editable')::boolean and r2->'online_slot' = 'null'::jsonb and r2->'confirmation' = 'null'::jsonb, false);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_get', jsonb_build_object('application_id', 'ZZ-NO-SUCH-APP')));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_counselling_notes_get', jsonb_build_object('application_id', 1)));
    t_name := t_name || text 'E read: an unknown student / a wrong id type is refused';
    t_det := t_det || format('%s | %s', r->>'message', r2->>'message');
    t_pass := t_pass || coalesce(r->>'message' = 'NOT_IN_PIPELINE' and r2->>'message' = 'BAD_VALUE: application_id', false);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_counselling_notes_tests();
