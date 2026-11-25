-- Partner School Connect source fields · database tests for migration 0174.
-- STAGING ONLY. Returns one row per test. All data rolled back via a private error code.
-- Fake data only (ZZ names, @example.invalid, unique +9197334… test numbers).

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'not the staging database - refusing to run tests';
  end if;
end $$;

create or replace function pg_temp.mk_user(p_email text, p_phone text default null)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, phone, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, p_phone, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id) values (v) on conflict (id) do nothing;
  return v;
end $$;

create or replace function pg_temp.run_src()
returns table(test text, pass boolean, detail text) language plpgsql as $$
declare
  u uuid; u2 uuid; u3 uuid; a record; t text[]:='{}'; pz boolean[]:='{}'; d text[]:='{}'; i int;
begin
  begin
    -- 1) columns exist, correct types
    select count(*) into i from information_schema.columns
      where table_schema='public' and table_name='lead_manager'
        and ((column_name='source_school' and udt_name='text')
          or (column_name='source_bdm'    and udt_name='text')
          or (column_name='session_date'  and udt_name='date'));
    t:=array_append(t,'3 new lead_manager columns exist w/ right types'); d:=array_append(d,'matched='||i); pz:=array_append(pz, i=3);

    -- 2) full extra → all three written, school NOT taken from utm_medium sentinel
    u := pg_temp.mk_user('zz-src1@example.invalid', '+919733412345');
    insert into public.partner_leads (partner, name, email, phone, campus, utm_source, utm_medium, utm_campaign, prepaid, status, extra)
    values ('elevate','ZZ Src One','zz-src1@example.invalid','+919733412345','pune','schoolconnect','offline','SomeCampaign', false, 'pending',
            '{"school_name":"Delhi Public School","bdm":"Ravi Kumar","session_date":"2026-11-20","stream":"PCM","graduation_year":"2027"}'::jsonb);
    perform public.partner_materialize(u, '+919733412345', 'zz-src1@example.invalid');
    select source_school, source_bdm, session_date into a from public.lead_manager where lead_id=u;
    t:=array_append(t,'source_school from extra (not "offline")'); d:=array_append(d, coalesce(a.source_school,'(null)'));
    pz:=array_append(pz, a.source_school='Delhi Public School');
    t:=array_append(t,'source_bdm from extra.bdm (wins over utm_campaign)'); d:=array_append(d, coalesce(a.source_bdm,'(null)'));
    pz:=array_append(pz, a.source_bdm='Ravi Kumar');
    t:=array_append(t,'session_date parsed to date'); d:=array_append(d, coalesce(a.session_date::text,'(null)'));
    pz:=array_append(pz, a.session_date='2026-11-20'::date);

    -- 3) older push: no extra.bdm → BDM falls back to utm_campaign; bad session_date → null; no school → null
    u2 := pg_temp.mk_user('zz-src2@example.invalid', '+919733499002');
    insert into public.partner_leads (partner, name, email, phone, utm_campaign, prepaid, status, extra)
    values ('elevate','ZZ Src Two','zz-src2@example.invalid','+919733499002','BDM Legacy', false, 'pending',
            '{"session_date":"20-11-2026"}'::jsonb);
    perform public.partner_materialize(u2, '+919733499002', null);
    select source_school, source_bdm, session_date into a from public.lead_manager where lead_id=u2;
    t:=array_append(t,'source_bdm fallback to utm_campaign'); d:=array_append(d, coalesce(a.source_bdm,'(null)'));
    pz:=array_append(pz, a.source_bdm='BDM Legacy');
    t:=array_append(t,'bad session_date → null'); d:=array_append(d, coalesce(a.session_date::text,'(null)'));
    pz:=array_append(pz, a.session_date is null);
    t:=array_append(t,'no school in extra → source_school null'); d:=array_append(d, coalesce(a.source_school,'(null)'));
    pz:=array_append(pz, a.source_school is null);

    -- 4) re-push fills a gap without wiping an existing value (coalesce on conflict)
    u3 := pg_temp.mk_user('zz-src3@example.invalid', '+919733499003');
    insert into public.lead_manager (lead_id, source_school) values (u3, 'Existing School');
    insert into public.partner_leads (partner, name, phone, prepaid, status, extra)
    values ('elevate','ZZ Src Three','+919733499003', false, 'pending',
            '{"bdm":"New BDM"}'::jsonb);
    perform public.partner_materialize(u3, '+919733499003', null);
    select source_school, source_bdm into a from public.lead_manager where lead_id=u3;
    t:=array_append(t,'re-push keeps existing source_school, adds source_bdm');
    d:=array_append(d, coalesce(a.source_school,'(null)')||'/'||coalesce(a.source_bdm,'(null)'));
    pz:=array_append(pz, a.source_school='Existing School' and a.source_bdm='New BDM');

    raise exception 'ZZ_ROLLBACK' using errcode='P0001';
  exception when others then
    if sqlerrm <> 'ZZ_ROLLBACK' then
      t:=array_append(t,'SETUP/RUN ERROR'); pz:=array_append(pz,false); d:=array_append(d,sqlstate||': '||sqlerrm);
    end if;
  end;
  for i in 1..coalesce(array_length(t,1),0) loop test:=t[i]; pass:=pz[i]; detail:=d[i]; return next; end loop;
end $$;
select * from pg_temp.run_src();
