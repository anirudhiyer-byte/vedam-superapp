-- VSAT Leads grid · tests for migration 0159 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data lives in a block rolled back with a private error code
-- (ZDONE) at the end. Fake data only (@example.invalid, ZZTEST LGR names).

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

-- one lead in lead_manager; returns its lead_id
create or replace function pg_temp.mk_lead(p_name text, p_campus text, p_stage public.vm_lead_stage, p_source text, p_applied boolean, p_mobile text, p_year int, p_reg timestamptz)
returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, registered_mobile, campus_preference,
                                    lead_stage, lead_source, application_submitted, passing_year, user_registration_date)
  values (u, 'ZZTEST LGR ' || p_name, lower(replace(p_name, ' ', '')) || '@example.invalid', p_mobile, p_campus,
          p_stage, p_source, p_applied, p_year, p_reg);
  return u;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated;
  end if;
  execute p_sql into r; reset role; perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  reset role; perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

-- scope every request to the test leads by name, so real staging rows never count
create or replace function pg_temp.q(p jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('search', jsonb_build_object('column', '_any', 'values', '["zztest lgr"]'::jsonb)) || coalesce(p, '{}'::jsonb)
$$;

create or replace function pg_temp.run_vsat_leads_grid_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_pune uuid; usr uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; r jsonb; n int;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-lgr-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    adm_pune := pg_temp.mk_user('zztest-lgr-adm-pune@example.invalid');
    usr  := pg_temp.mk_user('zztest-lgr-user@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values (adm_pune, 'admissions', 'pune');

    -- L1 Pune / applicant_paid / applied / src "Telegram"      L2 Gurugram / lead / not applied / src "Meta"
    -- L3 Pune / vsat_cleared / applied / src "Telegram"         L4 no campus / lead / not applied / src "Meta"
    l1 := pg_temp.mk_lead('One',   'Ajeenkya DY Patil University — Pune', 'applicant_paid', 'Telegram', true,  '9876511101', 2026, now());
    l2 := pg_temp.mk_lead('Two',   'Sushant University — Gurugram',       'lead',           'Meta',     false, '9876511102', 2025, now() - interval '1 day');
    l3 := pg_temp.mk_lead('Three', 'Ajeenkya DY Patil University — Pune', 'vsat_cleared',   'Telegram', true,  '9876511103', 2026, now() - interval '2 day');
    l4 := pg_temp.mk_lead('Four',  null,                                  'lead',           'Meta',     false, '9876511104', 2025, now() - interval '3 day');

    -- ════ A. access ════
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q(null)), true);
    t_name := t_name || text 'A anon cannot call the leads grid'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(usr, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q(null)));
    t_name := t_name || text 'A signed-in user with no VSAT role is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, 'select public.vsat__leads_grid(''{}''::jsonb, 10, true)');
    t_name := t_name || text 'A the private engine is not callable by browsers'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, 'select public.vsat__leads_grid_catalog()');
    t_name := t_name || text 'A the catalogue is not callable by browsers'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');

    -- ════ B. admin totals + facets ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q(null)));
    t_name := t_name || text 'B admin sees all 4 test leads; campus + applied + source counts';
    t_det := t_det || left(r::text, 320);
    t_pass := t_pass || ((r->>'total')::int = 4 and (r->'facets'->'campus'->>'pune')::int = 2 and (r->'facets'->'campus'->>'gurugram')::int = 1
                         and (r->'facets'->'campus'->>'none')::int = 1 and (r->'facets'->'applied'->>'yes')::int = 2
                         and (r->'facets'->'applied'->>'no')::int = 2 and (r->'facets'->'source'->>'Telegram')::int = 2
                         and (r->>'can_manage')::boolean);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q('{"campuses":["pune"]}')));
    t_name := t_name || text 'B campus filter → 2 pune leads; campus dropdown still counts all campuses';
    t_det := t_det || left((r->'facets'->'campus')::text, 200);
    t_pass := t_pass || ((r->>'total')::int = 2 and (r->'facets'->'campus'->>'gurugram')::int = 1 and (r->'facets'->'campus'->>'none')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q('{"applied":"yes"}')));
    t_name := t_name || text 'B applied=yes → 2 leads'; t_det := t_det || left(r::text, 160); t_pass := t_pass || ((r->>'total')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q('{"lead_stages":["vsat_cleared"]}')));
    t_name := t_name || text 'B lead_stage filter → the one vsat_cleared lead';
    t_det := t_det || left(r::text, 200); t_pass := t_pass || ((r->>'total')::int = 1 and (r->'rows'->0->>'lead_id') = l3::text);

    -- ════ C. advanced filter builder ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q('{"filters":[{"column":"passing_year","op":"eq","v":"2026"}]}')));
    t_name := t_name || text 'C numeric filter passing_year = 2026 → 2 leads';
    t_det := t_det || left(r::text, 200); t_pass := t_pass || ((r->>'total')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q('{"filters":[{"column":"lead_source","op":"contains","v":"tele"}]}')));
    t_name := t_name || text 'C text contains lead_source "tele" → 2 leads';
    t_det := t_det || left(r::text, 200); t_pass := t_pass || ((r->>'total')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q('{"filters":[{"column":"passing_year","op":"frobnicate","v":"x"}]}')));
    t_name := t_name || text 'C an invalid operator is rejected (BAD_VALUE)';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q('{"filters":[{"column":"not_a_column","op":"eq","v":"x"}]}')));
    t_name := t_name || text 'C a filter on an unknown column is rejected (BAD_VALUE)';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');

    -- ════ D. search ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', jsonb_build_object('search', jsonb_build_object('column', '_any', 'values', '["zztest lgr three"]'::jsonb))));
    t_name := t_name || text 'D _any search by name → the one matching lead';
    t_det := t_det || left(r::text, 200); t_pass := t_pass || ((r->>'total')::int = 1 and (r->'rows'->0->>'lead_id') = l3::text);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', jsonb_build_object('search', jsonb_build_object('column', 'registered_mobile', 'values', '["+91 98765 11102"]'::jsonb))));
    t_name := t_name || text 'D mobile search matches on digits only';
    t_det := t_det || left(r::text, 200); t_pass := t_pass || ((r->>'total')::int = 1 and (r->'rows'->0->>'lead_id') = l2::text);

    -- ════ E. columns ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q('{"lead_stages":["vsat_cleared"],"columns":["passing_year","campus"]}')));
    t_name := t_name || text 'E requested columns appear in the row (incl. virtual campus)';
    t_det := t_det || left(r::text, 260);
    t_pass := t_pass || ((r->'rows'->0->>'passing_year')::int = 2026 and (r->'rows'->0->>'campus') = 'pune' and (r->'rows'->0 ? 'name'));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q('{"columns":["consultant_id"]}')));
    t_name := t_name || text 'E a hidden (uuid) column is refused';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'FORBIDDEN_COLUMN%' or r->>'message' = 'BAD_VALUE: columns');
    r := pg_temp.call_as(adm, 'select public.vsat_leads_grid_columns()');
    t_name := t_name || text 'E the columns catalogue lists real + virtual lead columns, no hidden';
    n := (select count(*) from jsonb_array_elements(r->'columns'));
    t_det := t_det || ('cols=' || n || ' has_campus=' || (r->'columns' @> '[{"key":"campus"}]')::text);
    t_pass := t_pass || (n > 50 and (r->'columns' @> '[{"key":"campus"}]') and not (r->'columns' @> '[{"key":"consultant_id"}]'));

    -- ════ F. campus scope (admissions-pune) ════
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_leads_grid_list', pg_temp.q(null)));
    t_name := t_name || text 'F admissions(pune) sees pune + no-campus leads, never gurugram';
    t_det := t_det || left(r::text, 260);
    t_pass := t_pass || ((r->>'total')::int = 3 and not (r->'rows' @> jsonb_build_array(jsonb_build_object('lead_id', l2::text))));

    -- ════ G. export + audit ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_export', pg_temp.q('{"purpose":"csv","columns":["campus","lead_stage"]}')));
    t_name := t_name || text 'G csv export returns the whole filtered set (4)';
    t_det := t_det || left(r::text, 200); t_pass := t_pass || ((r->>'total')::int = 4 and r->>'purpose' = 'csv');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_export', pg_temp.q('{"purpose":"comms"}')));
    t_name := t_name || text 'G comms export carries name/email/mobile for recipients';
    t_det := t_det || left(r::text, 220);
    t_pass := t_pass || ((r->>'total')::int = 4 and (r->'rows'->0 ? 'email') and (r->'rows'->0 ? 'mobile'));
    r := pg_temp.call_as(usr, pg_temp.rpc('vsat_leads_grid_export', pg_temp.q('{"purpose":"csv"}')));
    t_name := t_name || text 'G export is refused for a non-manager';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_leads_grid_export', pg_temp.q('{"purpose":"nope"}')));
    t_name := t_name || text 'G export rejects an unknown purpose';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: purpose');

    raise exception 'ZDONE';
  exception when others then
    if sqlerrm <> 'ZDONE' then
      return query select 'FIXTURE/RUN ERROR'::text, false, sqlerrm; return;
    end if;
  end;

  for i in 1 .. array_length(t_name, 1) loop
    test := t_name[i]; pass := t_pass[i]; detail := t_det[i]; return next;
  end loop;
end $$;

select * from pg_temp.run_vsat_leads_grid_tests();
