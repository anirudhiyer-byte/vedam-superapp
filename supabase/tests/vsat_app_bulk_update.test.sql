-- VSAT bulk importer · database tests for migration 0170 (vsat_app_bulk_update).
-- STAGING ONLY. Returns one row per test. All data rolled back via a private error code.
-- Fake data only (A-1/A-2/A-3, @example.invalid).

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'not the staging database - refusing to run tests';
  end if;
end $$;

create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id) values (v) on conflict (id) do nothing;
  return v;
end $$;
create or replace function pg_temp.mk_admin(p_uid uuid) returns void language sql as $$
  insert into public.user_roles (user_id, role) values (p_uid, 'admin'); $$;
create or replace function pg_temp.bulk_as(p_uid uuid, p jsonb)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role','authenticated')::text, true);
  set local role authenticated;
  r := public.vsat_app_bulk_update(p);
  reset role; perform set_config('request.jwt.claims','',true);
  return r;
exception when others then
  reset role; perform set_config('request.jwt.claims','',true);
  return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm);
end $$;

create or replace function pg_temp.run2()
returns table(test text, pass boolean, detail text) language plpgsql as $$
declare
  adm uuid; usr uuid; l1 uuid; l2 uuid; l3 uuid; r jsonb; a record;
  t text[]:='{}'; pz boolean[]:='{}'; d text[]:='{}'; i int;
begin
  begin
    adm:=pg_temp.mk_user('zz-adm@example.invalid'); perform pg_temp.mk_admin(adm);
    usr:=pg_temp.mk_user('zz-usr@example.invalid');
    l1:=pg_temp.mk_user('zz1@example.invalid'); l2:=pg_temp.mk_user('zz2@example.invalid'); l3:=pg_temp.mk_user('zz3@example.invalid');
    insert into public.lead_manager(lead_id) values (l1),(l2),(l3);
    insert into public.application_manager(application_id,lead_id,registered_name,registered_email,vps_score_1) values
      ('A-1',l1,'Keep Me','dup@example.invalid',10),
      ('A-2',l2,'Two','dup@example.invalid',10),
      ('A-3',l3,'Three','uniq@example.invalid',10);

    r:=pg_temp.bulk_as(adm, jsonb_build_object('matchKey','application_id','mode','dry_run',
         'rows', jsonb_build_array(jsonb_build_object('key','A-1','values', jsonb_build_object('vps_score_1','99','registered_name','')))));
    select vps_score_1 into a from public.application_manager where application_id='A-1';
    t:=array_append(t,'dry_run matches, writes nothing'); d:=array_append(d,r::text);
    pz:=array_append(pz, (r->>'matched')='1' and (r->>'updated')='0' and (r->>'mode')='dry_run' and a.vps_score_1=10);

    r:=pg_temp.bulk_as(adm, jsonb_build_object('matchKey','application_id','mode','commit',
         'rows', jsonb_build_array(jsonb_build_object('key','A-1','values', jsonb_build_object('vps_score_1','99','registered_name','')))));
    select vps_score_1, registered_name into a from public.application_manager where application_id='A-1';
    t:=array_append(t,'commit writes value, skips blank'); d:=array_append(d,r::text);
    pz:=array_append(pz, (r->>'updated')='1' and a.vps_score_1=99 and a.registered_name='Keep Me');

    r:=pg_temp.bulk_as(adm, jsonb_build_object('matchKey','application_id','mode','commit',
         'rows', jsonb_build_array(jsonb_build_object('key','','values', jsonb_build_object('vps_score_1','5')))));
    t:=array_append(t,'blank key unmatched'); d:=array_append(d,r::text);
    pz:=array_append(pz, (r->>'unmatched')='1');

    r:=pg_temp.bulk_as(adm, jsonb_build_object('matchKey','registered_email','mode','commit',
         'rows', jsonb_build_array(jsonb_build_object('key','dup@example.invalid','values', jsonb_build_object('vps_score_1','7')))));
    select vps_score_1 into a from public.application_manager where application_id='A-1';
    t:=array_append(t,'ambiguous multi-row, no write'); d:=array_append(d,r::text);
    pz:=array_append(pz, (r->>'ambiguous')='1' and (r->>'matched')='0' and a.vps_score_1=99);

    r:=pg_temp.bulk_as(adm, jsonb_build_object('matchKey','application_id','mode','commit',
         'rows', jsonb_build_array(jsonb_build_object('key','A-NOPE','values', jsonb_build_object('vps_score_1','7')))));
    t:=array_append(t,'no match unmatched'); d:=array_append(d,r::text);
    pz:=array_append(pz, (r->>'unmatched')='1');

    r:=pg_temp.bulk_as(adm, jsonb_build_object('matchKey','application_id','mode','commit',
         'rows', jsonb_build_array(jsonb_build_object('key','A-3','values', jsonb_build_object('not_a_col','x')))));
    t:=array_append(t,'bad column errored'); d:=array_append(d,r::text);
    pz:=array_append(pz, (r->>'errored')='1' and (r->'samples'->0->>'outcome') like 'error:bad_column%');

    r:=pg_temp.bulk_as(adm, jsonb_build_object('matchKey','registered_email','mode','commit',
         'rows', jsonb_build_array(jsonb_build_object('key','UNIQ@EXAMPLE.INVALID','values', jsonb_build_object('vps_score_1','42')))));
    select vps_score_1 into a from public.application_manager where application_id='A-3';
    t:=array_append(t,'email match case-insensitive'); d:=array_append(d,r::text);
    pz:=array_append(pz, (r->>'updated')='1' and a.vps_score_1=42);

    r:=pg_temp.bulk_as(adm, jsonb_build_object('matchKey','application_id','mode','commit',
         'rows', jsonb_build_array(jsonb_build_object('key','A-3','values', jsonb_build_object('vps_score_1','abc')))));
    select vps_score_1 into a from public.application_manager where application_id='A-3';
    t:=array_append(t,'bad value isolated, no write'); d:=array_append(d,left(r::text,160));
    pz:=array_append(pz, (r->>'errored')='1' and (r->>'updated')='0' and a.vps_score_1=42);

    r:=pg_temp.bulk_as(usr, jsonb_build_object('matchKey','application_id','mode','dry_run','rows',jsonb_build_array()));
    t:=array_append(t,'non-admin forbidden'); d:=array_append(d,r::text);
    pz:=array_append(pz, (r->>'message') like '%FORBIDDEN%');

    r:=pg_temp.bulk_as(adm, jsonb_build_object('matchKey','application_id','mode','commit',
         'rows', jsonb_build_array(
            jsonb_build_object('key','A-1','values', jsonb_build_object('vps_score_1','1')),
            jsonb_build_object('key','A-1','values', jsonb_build_object('vps_score_1','2')))));
    t:=array_append(t,'duplicate key in sheet flagged'); d:=array_append(d,r::text);
    pz:=array_append(pz, (r->>'ambiguous')='2' and (r->>'updated')='0');

    raise exception 'ZZ_ROLLBACK' using errcode='P0001';
  exception when others then
    if sqlerrm <> 'ZZ_ROLLBACK' then
      t:=array_append(t,'SETUP/RUN ERROR'); pz:=array_append(pz,false); d:=array_append(d,sqlstate||': '||sqlerrm);
    end if;
  end;
  for i in 1..coalesce(array_length(t,1),0) loop test:=t[i]; pass:=pz[i]; detail:=d[i]; return next; end loop;
end $$;
select * from pg_temp.run2();
