-- VSAT Leads facets · tests for migration 0120 (STAGING ONLY)
--
-- Paste into the staging SQL editor or run through the Supabase MCP. Returns one row per test.
-- All data is created inside a block rolled back at the end (ZDONE). Fake data only.

create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email;
  return v;
end $$;

create or replace function pg_temp.mk_lead(p_name text, p_campus_pref text, p_stage text, p_source text, p_applied boolean)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_name) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, registered_mobile, campus_preference,
     lead_stage, lead_source, application_submitted, user_registration_date)
  values (u, 'ZZTEST ' || p_name, lower(p_name) || '@example.invalid', '90000' || (floor(random()*100000))::text,
     p_campus_pref, p_stage::public.vm_lead_stage, p_source, p_applied, now())
  on conflict (lead_id) do nothing;
  return u;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p jsonb)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute format('select public.vsat_leads_list(%L::jsonb)', p::text) into r;
  return coalesce(r, 'null'::jsonb);
exception when others then return jsonb_build_object('message', sqlerrm, 'sqlstate', sqlstate); end $$;

-- scope every request to the test leads by searching their shared name fragment
create or replace function pg_temp.q(p jsonb) returns jsonb language sql as $$
  select jsonb_build_object('q', 'zzlf') || coalesce(p, '{}'::jsonb) $$;

create or replace function pg_temp.run_leads_facets()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; r jsonb;
begin
  begin
    adm := pg_temp.mk_user('zzlf-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    -- 5 leads: 3 Pune / 2 Gurugram · stages · sources · applied flags
    perform pg_temp.mk_lead('zzlf1', 'Ajeenkya DY Patil University — Pune', 'lead', 'website', false);
    perform pg_temp.mk_lead('zzlf2', 'Ajeenkya DY Patil University — Pune', 'applicant_unpaid', 'website', true);
    perform pg_temp.mk_lead('zzlf3', 'Ajeenkya DY Patil University — Pune', 'applicant_paid', 'referral', true);
    perform pg_temp.mk_lead('zzlf4', 'Sushant University — Gurugram', 'lead', 'website', false);
    perform pg_temp.mk_lead('zzlf5', 'Sushant University — Gurugram', 'vsat_cleared', 'referral', false);

    r := pg_temp.call_as(adm, pg_temp.q(null));
    t_name := t_name || text 'facets present with the four dimensions';
    t_det := t_det || left((r->'facets')::text, 300);
    t_pass := t_pass || ((r->>'total')::int = 5
                         and (r->'facets'->'campus'->>'pune')::int = 3 and (r->'facets'->'campus'->>'gurugram')::int = 2
                         and (r->'facets'->'applied'->>'yes')::int = 2 and (r->'facets'->'applied'->>'no')::int = 3
                         and (r->'facets'->'source'->>'website')::int = 3 and (r->'facets'->'source'->>'referral')::int = 2
                         and (r->'facets'->'lead_stage'->>'lead')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.q('{"campuses":["pune"]}'));
    t_name := t_name || text 'campus filter narrows rows; other facets recompute within it';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || ((r->>'total')::int = 3 and (r->'facets'->'applied'->>'yes')::int = 2 and (r->'facets'->'applied'->>'no')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.q('{"campus":"pune"}'));
    t_name := t_name || text 'the old scalar `campus` still works (back-compat) → 3';
    t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 3);
    r := pg_temp.call_as(adm, pg_temp.q('{"applied":"yes"}'));
    t_name := t_name || text 'applied=yes → the 2 who submitted';
    t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.q('{"lead_stages":["lead","vsat_cleared"]}'));
    t_name := t_name || text 'lead_stages multi-select → 3 (2 lead + 1 vsat_cleared)';
    t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 3);
    r := pg_temp.call_as(adm, pg_temp.q('{"sources":["referral"]}'));
    t_name := t_name || text 'source filter → the 2 referral leads';
    t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 2);
    r := pg_temp.call_as(adm, pg_temp.q('{"campuses":["pune"],"applied":"no"}'));
    t_name := t_name || text 'two dimensions AND together → 1';
    t_det := t_det || left(r::text, 120); t_pass := t_pass || ((r->>'total')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.q('{"lead_stages":["not_a_stage"]}'));
    t_name := t_name || text 'a lead stage outside the enum is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: lead_stages');
    r := pg_temp.call_as(adm, pg_temp.q('{"applied":"perhaps"}'));
    t_name := t_name || text 'a bad applied value is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: applied');
    r := pg_temp.call_as(adm, pg_temp.q('{"campuses":["mars"]}'));
    t_name := t_name || text 'a bad campus is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campuses');
    r := pg_temp.call_as(adm, pg_temp.q('{"foo":1}'));
    t_name := t_name || text 'an unknown key is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_leads_facets();
