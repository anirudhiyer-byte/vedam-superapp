-- VSAT UTM attribution · tests for migrations 0092 (trigger chain) + 0093 (admin lists)
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it
-- through the Supabase MCP / psql. The last statement returns one row per test: test | pass |
-- detail. All fixtures are created inside a sub-block that is rolled back via a ZDONE raise,
-- so nothing is left behind (plpgsql variables survive the rollback, the DB rows do not).
-- Test users use emails zztest-attr-*@example.invalid.

-- call an RPC as a given signed-in user (authenticated role + jwt sub)
create or replace function pg_temp.attr_call(p_uid uuid, p_sql text)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.run_attr_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; nob uuid; lu uuid;
  rec record; j jsonb; found_app boolean; i int;
begin
  begin
    adm := gen_random_uuid(); nob := gen_random_uuid(); lu := gen_random_uuid();
    insert into auth.users (id, email, aud, role, raw_user_meta_data) values
      (adm, 'zztest-attr-adm@example.invalid', 'authenticated', 'authenticated', '{}'),
      (nob, 'zztest-attr-nob@example.invalid', 'authenticated', 'authenticated', '{}'),
      (lu,  'zztest-attr-lead@example.invalid', 'authenticated', 'authenticated', '{}');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    -- a profiles row is auto-created for each auth.users insert (handle_new_user trigger).

    -- 1) vsat__norm_utm
    t_name := array_append(t_name, 'norm_utm_null');
    t_pass := array_append(t_pass, (public.vsat__norm_utm(null) is null and public.vsat__norm_utm('   ') is null));
    t_det  := array_append(t_det, 'null/blank -> null');
    t_name := array_append(t_name, 'norm_utm_lower_trim');
    t_pass := array_append(t_pass, (public.vsat__norm_utm('  Google /CPC/ Camp_A ') = 'google/cpc/camp_a'));
    t_det  := array_append(t_det, coalesce(public.vsat__norm_utm('  Google /CPC/ Camp_A '), '(null)'));

    -- 2) lead touch-chain
    insert into public.lead_manager (lead_id, registered_email, registered_name, utm_source, utm_medium, utm_campaign)
      values (lu, 'zztest-attr-lead@example.invalid', 'Attr Lead', 'google', 'cpc', 'camp_a');
    update public.lead_manager set utm_source='facebook', utm_medium='social', utm_campaign='camp_b' where lead_id=lu;
    update public.lead_manager set utm_source='GOOGLE', utm_medium='CPC', utm_campaign='CAMP_A' where lead_id=lu;
    update public.lead_manager set utm_source='instagram', utm_medium='influencer', utm_campaign='camp_c' where lead_id=lu;
    update public.lead_manager set utm_source='youtube', utm_medium='video', utm_campaign='camp_d' where lead_id=lu;
    update public.lead_manager set utm_source=null, utm_medium=null, utm_campaign=null where lead_id=lu; -- no-utm touch
    select * into rec from public.lead_manager where lead_id=lu;

    t_name := array_append(t_name, 'chain_primary');            t_pass := array_append(t_pass, rec.primary_utm='google/cpc/camp_a'); t_det := array_append(t_det, coalesce(rec.primary_utm,'(null)'));
    t_name := array_append(t_name, 'chain_primary_breakout');   t_pass := array_append(t_pass, rec.primary_utm_source='google' and rec.primary_utm_medium='cpc' and rec.primary_utm_campaign='camp_a'); t_det := array_append(t_det, format('%s|%s|%s',rec.primary_utm_source,rec.primary_utm_medium,rec.primary_utm_campaign));
    t_name := array_append(t_name, 'chain_secondary');          t_pass := array_append(t_pass, rec.secondary_utm='facebook/social/camp_b'); t_det := array_append(t_det, coalesce(rec.secondary_utm,'(null)'));
    t_name := array_append(t_name, 'chain_tertiary_after_dedup');t_pass := array_append(t_pass, rec.tertiary_utm='instagram/influencer/camp_c'); t_det := array_append(t_det, coalesce(rec.tertiary_utm,'(null)'));
    t_name := array_append(t_name, 'chain_latest_is_newest');   t_pass := array_append(t_pass, rec.latest_utm='youtube/video/camp_d'); t_det := array_append(t_det, coalesce(rec.latest_utm,'(null)'));
    t_name := array_append(t_name, 'chain_noutm_preserves_raw');t_pass := array_append(t_pass, rec.utm_source='youtube'); t_det := array_append(t_det, coalesce(rec.utm_source,'(null)'));

    -- 3) application inherits at creation
    insert into public.application_manager (application_id, lead_id) values ('VDM-ZZATTR', lu);
    select * into rec from public.application_manager where application_id='VDM-ZZATTR';
    t_name := array_append(t_name, 'app_inherits_chain');
    t_pass := array_append(t_pass, rec.primary_utm='google/cpc/camp_a' and rec.secondary_utm='facebook/social/camp_b' and rec.tertiary_utm='instagram/influencer/camp_c' and rec.latest_utm='youtube/video/camp_d' and rec.primary_utm_source='google');
    t_det  := array_append(t_det, format('p=%s s=%s t=%s l=%s',rec.primary_utm,rec.secondary_utm,rec.tertiary_utm,rec.latest_utm));

    -- 4) RPC gating + visibility
    j := pg_temp.attr_call(adm, 'select public.vsat_applications_list(''{"q":"VDM-ZZATTR"}''::jsonb)');
    found_app := exists (select 1 from jsonb_array_elements(coalesce(j->'rows','[]'::jsonb)) r where r->>'application_id'='VDM-ZZATTR');
    t_name := array_append(t_name, 'rpc_apps_admin_sees_row'); t_pass := array_append(t_pass, found_app and (j->'rows'->0->>'primary_utm')='google/cpc/camp_a'); t_det := array_append(t_det, coalesce(j->'rows'->0->>'primary_utm','(not found)'));

    j := pg_temp.attr_call(nob, 'select public.vsat_applications_list(''{}''::jsonb)');
    t_name := array_append(t_name, 'rpc_apps_nonadmin_forbidden'); t_pass := array_append(t_pass, j->>'sqlstate'='42501'); t_det := array_append(t_det, coalesce(j->>'sqlstate','(no error)'));
    j := pg_temp.attr_call(nob, 'select public.vsat_leads_list(''{}''::jsonb)');
    t_name := array_append(t_name, 'rpc_leads_nonadmin_forbidden'); t_pass := array_append(t_pass, j->>'sqlstate'='42501'); t_det := array_append(t_det, coalesce(j->>'sqlstate','(no error)'));
    j := pg_temp.attr_call(adm, 'select public.vsat_leads_list(''{"q":"zztest-attr-lead"}''::jsonb)');
    t_name := array_append(t_name, 'rpc_leads_admin_sees_lead'); t_pass := array_append(t_pass, exists (select 1 from jsonb_array_elements(coalesce(j->'rows','[]'::jsonb)) r where r->>'lead_id'=lu::text)); t_det := array_append(t_det, coalesce((j->>'total'),'(null)'));

    raise exception 'ZDONE';
  exception when others then
    if sqlerrm <> 'ZDONE' then
      t_name := array_append(t_name, 'UNEXPECTED_ERROR'); t_pass := array_append(t_pass, false); t_det := array_append(t_det, sqlstate||': '||sqlerrm);
    end if;
  end;

  for i in 1 .. coalesce(array_length(t_name,1),0) loop
    test := t_name[i]; pass := t_pass[i]; detail := t_det[i]; return next;
  end loop;
end $$;

select * from pg_temp.run_attr_tests();
