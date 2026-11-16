-- VSAT settings + team screens · tests for migration 0098 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP. The last statement returns one row per test: test | pass | detail.
-- Everything is created and changed inside a block that is rolled back at the end (ZDONE):
-- real settings are never changed. Fake data only (@example.invalid, ZZTEST names).

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

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then
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
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.run_vsat_settings_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; staff uuid; adm_team uuid; int1 uuid; newbie uuid; d uuid; r jsonb; n int; s text;
  tomorrow date := (now() at time zone 'Asia/Kolkata')::date + 1;
  good_bands jsonb := '[{"category":1,"min_score":90,"max_score":100,"steps":3,"min_award":80,"max_award":100},
                        {"category":2,"min_score":70,"max_score":90,"steps":2,"min_award":40,"max_award":60},
                        {"category":3,"min_score":0,"max_score":70,"steps":2,"min_award":5,"max_award":20}]';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-set-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    staff := pg_temp.mk_user('zztest-set-staff@vedam.org');       -- @vedam.org but not an admin
    adm_team := pg_temp.mk_user('zztest-set-adm@example.invalid');
    int1 := pg_temp.mk_user('zztest-set-int1@example.invalid');
    newbie := pg_temp.mk_user('zztest-set-NEW@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm_team, 'admissions'), (int1, 'interviewer');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST VSAT-S1', 'zz-set-1', current_date, now(), now() + interval '2 hours') returning id into d;

    -- ════ A. who may use it ════
    r := pg_temp.call_as(null, 'select public.vsat_settings_get()', true);
    t_name := t_name || text 'A anon cannot read settings'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(staff, 'select public.vsat_settings_get()');
    t_name := t_name || text 'A a @vedam.org login that is not an admin is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm_team, 'select public.vsat_settings_get()');
    t_name := t_name || text 'A admissions cannot read settings'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm_team, 'select public.vsat_team_admin_list()');
    t_name := t_name || text 'A admissions cannot open the team admin list'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_team_add', jsonb_build_object('email', 'zztest-set-new@example.invalid', 'role', 'counsellor')));
    t_name := t_name || text 'A an interviewer cannot add team members'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.vsat_settings_audit');
    t_name := t_name || text 'A the audit table is not readable by browsers'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');

    -- ════ B. read ════
    r := pg_temp.call_as(adm, 'select public.vsat_settings_get()');
    t_name := t_name || text 'B admin reads campuses, weights, bands, VSATs and the Exam Center defaults';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || (jsonb_array_length(r->'campuses') = 2 and jsonb_array_length(r->'weights') >= 2 and jsonb_array_length(r->'bands') >= 16
                         and exists (select 1 from jsonb_array_elements(r->'vsats') v where v->>'id' = d::text)
                         and r->'default_vps_anchors' is not null and (r->>'editable_from')::date = tomorrow
                         and not exists (select 1 from jsonb_array_elements(r->'weights') w where (w->>'effective_from')::date < tomorrow and (w->>'editable')::boolean));

    -- ════ C. campus ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_campus_set', '{"campus":"pune","programme_fee":1900000,"offer_days":7,"jee_floor_enabled":false}'));
    t_name := t_name || text 'C admin changes Pune fee, days to pay and JEE floor';
    select format('%s/%s/%s', programme_fee, offer_days, jee_floor_enabled) into s from public.vsat_campus_settings where campus = 'pune';
    t_det := t_det || s; t_pass := t_pass || (r->>'ok' = 'true' and s = '1900000/7/f');
    select count(*) into n from public.vsat_settings_audit a where a.user_id = adm and a.area = 'campus' and a.target = 'pune'
       and (a.before->>'programme_fee')::numeric = 1850000 and (a.after->>'offer_days')::int = 7;
    t_name := t_name || text 'C … logged with before and after'; t_det := t_det || n::text; t_pass := t_pass || (n = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_campus_set', '{"campus":"pune","programme_fee":500,"offer_days":7,"jee_floor_enabled":true}'));
    t_name := t_name || text 'C an unrealistic fee is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: programme_fee');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_campus_set', '{"campus":"pune","programme_fee":1900000,"offer_days":2.5,"jee_floor_enabled":true}'));
    t_name := t_name || text 'C part days refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: offer_days');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_campus_set', '{"campus":"mumbai","programme_fee":1900000,"offer_days":5,"jee_floor_enabled":true}'));
    t_name := t_name || text 'C unknown campus refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campus');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_campus_set', '{"campus":"pune","programme_fee":1900000,"offer_days":5,"jee_floor_enabled":"yes"}'));
    t_name := t_name || text 'C JEE floor must be true / false'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: jee_floor_enabled');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_campus_set', '{"campus":"pune","programme_fee":1900000,"offer_days":5,"jee_floor_enabled":true,"updated_by":"x"}'));
    t_name := t_name || text 'C unknown key refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');

    -- ════ D. interview weights ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_weights_set', jsonb_build_object('effective_from', tomorrow, 'w_communication', 0.2, 'w_logic', 0.2,
           'w_passion', 0.2, 'w_achievements', 0.2, 'w_why_program', 0.2, 'note', 'zz test')));
    t_name := t_name || text 'D admin adds a weight set from tomorrow';
    select count(*) into n from public.vsat_interview_weights w where w.effective_from = tomorrow and w.w_achievements = 0.2;
    t_det := t_det || r::text; t_pass := t_pass || (r->>'ok' = 'true' and n = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_weights_set', jsonb_build_object('effective_from', tomorrow - 1, 'w_communication', 0.2, 'w_logic', 0.2,
           'w_passion', 0.2, 'w_achievements', 0.2, 'w_why_program', 0.2)));
    t_name := t_name || text 'D today or earlier cannot be added or changed'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'PAST_DATE');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_weights_set', jsonb_build_object('effective_from', tomorrow, 'w_communication', 0.5, 'w_logic', 0.5,
           'w_passion', 0.2, 'w_achievements', 0.2, 'w_why_program', 0.2)));
    t_name := t_name || text 'D weights adding up to more than 1 are refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_WEIGHTS');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_weights_set', jsonb_build_object('effective_from', tomorrow, 'w_communication', -0.1, 'w_logic', 0.5,
           'w_passion', 0.2, 'w_achievements', 0.2, 'w_why_program', 0.2)));
    t_name := t_name || text 'D a negative weight is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: w_communication');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_weights_delete', jsonb_build_object('effective_from', '2026-04-01')));
    t_name := t_name || text 'D a weight set already in use cannot be removed'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'PAST_DATE');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_weights_delete', jsonb_build_object('effective_from', tomorrow)));
    select count(*) into n from public.vsat_interview_weights w where w.effective_from = tomorrow;
    t_name := t_name || text 'D a future weight set can be removed (and is logged)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'ok' = 'true' and n = 0 and exists (select 1 from public.vsat_settings_audit a where a.area = 'weights' and a.after is null and a.user_id = adm));

    -- ════ E. scholarship bands ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_bands_set', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands', good_bands)));
    t_name := t_name || text 'E admin sets a VSAT''s own Pune bands (3 categories, 100 → 0 without gaps)';
    select count(*) into n from public.vsat_scholarship_bands b where b.exam_date_id = d and b.campus = 'pune';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'ok' = 'true' and n = 3);
    -- a perfect score lands in category 1: 80–100 for this VSAT, the default 90–100 for any other
    r := public.vsat_calc_scholarship('{"vsat_pct":100,"class10_pct":100,"class12_pct":100,"interview_score":5,"cs_passion":5,"class10_maths_pct":100,"class12_maths_pct":100}'::jsonb, 'pune', d);
    t_name := t_name || text 'E … and the calculator uses them for that VSAT, the default for others';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || ((r->>'category')::int = 1 and (r->>'min_award')::numeric = 80
                         and (public.vsat_calc_scholarship('{"vsat_pct":100,"class10_pct":100,"class12_pct":100,"interview_score":5,"cs_passion":5,"class10_maths_pct":100,"class12_maths_pct":100}'::jsonb, 'pune', null)->>'min_award')::numeric = 90);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_bands_set', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands',
           '[{"category":1,"min_score":90,"max_score":100,"steps":3,"min_award":80,"max_award":100},{"category":2,"min_score":0,"max_score":85,"steps":2,"min_award":5,"max_award":20}]'::jsonb)));
    t_name := t_name || text 'E a gap between bands is refused (a score would fall outside every band)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_BANDS: category 2 must end%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_bands_set', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands',
           '[{"category":1,"min_score":90,"max_score":99,"steps":3,"min_award":80,"max_award":100},{"category":2,"min_score":0,"max_score":90,"steps":2,"min_award":5,"max_award":20}]'::jsonb)));
    t_name := t_name || text 'E category 1 must end at 100'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_BANDS: category 1 must end at 100%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_bands_set', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands',
           '[{"category":1,"min_score":10,"max_score":100,"steps":3,"min_award":80,"max_award":100}]'::jsonb)));
    t_name := t_name || text 'E the last band must start at 0'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_BANDS: the last category must start at 0%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_bands_set', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands',
           '[{"category":1,"min_score":0,"max_score":100,"steps":3,"min_award":90,"max_award":50}]'::jsonb)));
    t_name := t_name || text 'E min award above max award is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_BANDS: category 1 award range%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_bands_set', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands',
           '[{"category":1,"min_score":0,"max_score":100,"steps":2.5,"min_award":10,"max_award":50}]'::jsonb)));
    t_name := t_name || text 'E steps must be whole'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_BANDS: steps%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_bands_set', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands',
           '[{"category":2,"min_score":0,"max_score":100,"steps":2,"min_award":10,"max_award":50}]'::jsonb)));
    t_name := t_name || text 'E categories must start at 1'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_BANDS: categories must be%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_bands_set', '{"exam_date_id":null,"campus":"pune","bands":[]}'));
    t_name := t_name || text 'E the default set cannot be emptied'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_BANDS: the default set%');
    select count(*) into n from public.vsat_scholarship_bands b where b.exam_date_id = d and b.campus = 'pune';
    t_name := t_name || text 'E refused saves leave the VSAT''s bands as they were'; t_det := t_det || n::text; t_pass := t_pass || (n = 3);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_bands_set', jsonb_build_object('exam_date_id', d, 'campus', 'pune', 'bands', '[]'::jsonb)));
    select count(*) into n from public.vsat_scholarship_bands b where b.exam_date_id = d;
    t_name := t_name || text 'E an empty list removes the VSAT''s own bands (back to the default)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'ok' = 'true' and n = 0);
    select count(*) into n from public.vsat_scholarship_bands b where b.exam_date_id is null;
    t_name := t_name || text 'E the default bands were never touched'; t_det := t_det || n::text; t_pass := t_pass || (n = 16);

    -- ════ F. per VSAT: VPS curve + cut-off ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_vsat_set', jsonb_build_object('exam_date_id', d,
           'vps_anchors', '[{"percentile":0,"vps":0},{"percentile":65,"vps":7.4},{"percentile":100,"vps":9.8}]'::jsonb, 'cleared_vps_cutoff', 7)));
    t_name := t_name || text 'F admin sets a VSAT''s VPS curve and cut-off';
    select format('%s|%s', jsonb_array_length(vps_anchors), cleared_vps_cutoff) into s from public.vsat_exam_dates where id = d;
    t_det := t_det || s; t_pass := t_pass || (r->>'ok' = 'true' and s = '3|7');
    r := pg_temp.call_as(adm, 'select public.vsat_batches()');
    t_name := t_name || text 'F … and the panels read it'; t_det := t_det || left(r::text, 120);
    t_pass := t_pass || exists (select 1 from jsonb_array_elements(r) e where e->>'id' = d::text and (e->>'cleared_vps_cutoff')::numeric = 7 and jsonb_array_length(e->'vps_anchors') = 3);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_vsat_set', jsonb_build_object('exam_date_id', d,
           'vps_anchors', '[{"percentile":50,"vps":7.5},{"percentile":40,"vps":8}]'::jsonb, 'cleared_vps_cutoff', null)));
    t_name := t_name || text 'F percentiles that do not rise are refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_ANCHORS%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_vsat_set', jsonb_build_object('exam_date_id', d,
           'vps_anchors', '[{"percentile":0,"vps":0},{"percentile":100,"vps":12}]'::jsonb, 'cleared_vps_cutoff', null)));
    t_name := t_name || text 'F VPS above 10 is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: vps');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_settings_vsat_set', jsonb_build_object('exam_date_id', d, 'vps_anchors', null, 'cleared_vps_cutoff', null)));
    select format('%s|%s', coalesce(vps_anchors::text, 'null'), coalesce(cleared_vps_cutoff::text, 'null')) into s from public.vsat_exam_dates where id = d;
    t_name := t_name || text 'F empty = back to the Exam Center default'; t_det := t_det || s; t_pass := t_pass || (r->>'ok' = 'true' and s = 'null|null');

    -- ════ G. team ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_team_add', '{"email":"  ZZTEST-SET-new@example.invalid ","role":"counsellor","campus":"gurugram"}'));
    t_name := t_name || text 'G admin adds an existing account as counsellor (email matched case-insensitively)';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'ok' = 'true' and (r->>'user_id')::uuid = newbie
                         and exists (select 1 from public.vsat_team t where t.user_id = newbie and t.role = 'counsellor' and t.active and t.campus = 'gurugram'));
    r := pg_temp.call_as(newbie, 'select public.vsat_my_roles()');
    t_name := t_name || text 'G … who now has the counsellor role'; t_det := t_det || r::text; t_pass := t_pass || (r->'roles' ? 'counsellor');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_team_add', '{"email":"nobody-zz@example.invalid","role":"interviewer"}'));
    t_name := t_name || text 'G an email with no Vedam One account is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NO_ACCOUNT');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_team_add', '{"email":"zztest-set-new@example.invalid","role":"admin"}'));
    t_name := t_name || text 'G the admin role cannot be given here'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: role');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_team_add', '{"email":"not-an-email","role":"interviewer"}'));
    t_name := t_name || text 'G a bad email is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: email');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_team_set', jsonb_build_object('user_id', int1, 'role', 'interviewer', 'active', false)));
    t_name := t_name || text 'G admin switches an interviewer off';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'ok' = 'true' and not exists (select 1 from public.vsat_team t where t.user_id = int1 and t.active));
    r := pg_temp.call_as(int1, 'select public.vsat_grid_columns()');
    t_name := t_name || text 'G … who loses access to the panels at once'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_team_add', jsonb_build_object('email', 'zztest-set-int1@example.invalid', 'role', 'interviewer')));
    t_name := t_name || text 'G adding them again switches the same role back on'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'reactivated')::boolean and exists (select 1 from public.vsat_team t where t.user_id = int1 and t.role = 'interviewer' and t.active));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_team_set', jsonb_build_object('user_id', adm_team, 'role', 'admissions', 'campus', 'pune')));
    t_name := t_name || text 'G admin limits admissions to one campus'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'ok' = 'true' and exists (select 1 from public.vsat_team t where t.user_id = adm_team and t.campus = 'pune'));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_team_set', jsonb_build_object('user_id', adm_team, 'role', 'counsellor', 'active', false)));
    t_name := t_name || text 'G a role the person does not have is NOT_FOUND'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NOT_FOUND');
    r := pg_temp.call_as(adm, 'select public.vsat_team_admin_list()');
    t_name := t_name || text 'G admin list has every role row with name, email, campus and open assignments';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || exists (select 1 from jsonb_array_elements(r) e where e->>'user_id' = newbie::text and e->>'role' = 'counsellor'
                                and lower(e->>'email') = 'zztest-set-new@example.invalid' and e->>'campus' = 'gurugram' and (e->>'open')::int = 0);
    select count(*) into n from public.vsat_settings_audit a where a.user_id = adm and a.area = 'team';
    t_name := t_name || text 'G every team change is logged'; t_det := t_det || n::text; t_pass := t_pass || (n = 4);

    -- ════ H. grants ════
    t_name := t_name || text 'H RPCs: authenticated only, security definer, empty search_path; helpers private';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_settings_get', 'vsat_settings_campus_set', 'vsat_settings_weights_set', 'vsat_settings_weights_delete',
                                                   'vsat_settings_bands_set', 'vsat_settings_vsat_set', 'vsat_team_admin_list', 'vsat_team_add', 'vsat_team_set')
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']);
    t_det := t_det || coalesce(s, 'all ok');
    t_pass := t_pass || (s is null and not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                          where ns.nspname = 'public' and p.proname in ('vsat__settings_admin', 'vsat__settings_log', 'vsat__settings_num')
                            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')))
                         and (select relrowsecurity from pg_class where oid = 'public.vsat_settings_audit'::regclass));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_settings_tests();
