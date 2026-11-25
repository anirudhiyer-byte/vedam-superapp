-- Partner School Connect source fields on profiles · database tests for migration 0175.
-- STAGING ONLY. Returns one row per test. All data rolled back via a private error code.
-- Fake data only (ZZ names, @example.invalid, unique +9197335… test numbers).

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

create or replace function pg_temp.run_pf()
returns table(test text, pass boolean, detail text) language plpgsql as $$
declare u uuid; u2 uuid; a record; t text[]:='{}'; pz boolean[]:='{}'; d text[]:='{}'; i int;
begin
  begin
    select count(*) into i from information_schema.columns
      where table_schema='public' and table_name='profiles'
        and ((column_name='source_school' and udt_name='text') or (column_name='source_bdm' and udt_name='text') or (column_name='session_date' and udt_name='date'));
    t:=array_append(t,'3 profiles columns exist'); pz:=array_append(pz, i=3); d:=array_append(d,'matched='||i);

    u := pg_temp.mk_user('zz-pf1@example.invalid', '+919733512345');
    insert into public.partner_leads (partner, name, email, phone, utm_medium, utm_campaign, prepaid, status, extra)
    values ('elevate','ZZ PF One','zz-pf1@example.invalid','+919733512345','offline','SomeCampaign', false, 'pending',
            '{"school_name":"St Xaviers","bdm":"Meena Roy","session_date":"2026-11-18","stream":"PCB","graduation_year":"2026"}'::jsonb);
    perform public.partner_materialize(u, '+919733512345', 'zz-pf1@example.invalid');
    select source_school, source_bdm, session_date, stream, grad_year into a from public.profiles where id=u;
    t:=array_append(t,'profiles.source_school'); pz:=array_append(pz, a.source_school='St Xaviers'); d:=array_append(d, coalesce(a.source_school,'(null)'));
    t:=array_append(t,'profiles.source_bdm'); pz:=array_append(pz, a.source_bdm='Meena Roy'); d:=array_append(d, coalesce(a.source_bdm,'(null)'));
    t:=array_append(t,'profiles.session_date'); pz:=array_append(pz, a.session_date='2026-11-18'::date); d:=array_append(d, coalesce(a.session_date::text,'(null)'));
    t:=array_append(t,'profiles.stream+grad_year still filled'); pz:=array_append(pz, a.stream='PCB' and a.grad_year=2026); d:=array_append(d, coalesce(a.stream,'')||'/'||coalesce(a.grad_year::text,''));
    select source_school into a from public.lead_manager where lead_id=u;
    t:=array_append(t,'lead_manager still filled too'); pz:=array_append(pz, a.source_school='St Xaviers'); d:=array_append(d, coalesce(a.source_school,'(null)'));

    u2 := pg_temp.mk_user('zz-pf2@example.invalid', '+919733599002');
    update public.profiles set source_school='Pre Existing' where id=u2;
    insert into public.partner_leads (partner, name, phone, prepaid, status, extra)
    values ('elevate','ZZ PF Two','+919733599002', false, 'pending', '{"school_name":"New Push School"}'::jsonb);
    perform public.partner_materialize(u2, '+919733599002', null);
    select source_school into a from public.profiles where id=u2;
    t:=array_append(t,'profiles re-push keeps existing'); pz:=array_append(pz, a.source_school='Pre Existing'); d:=array_append(d, coalesce(a.source_school,'(null)'));

    raise exception 'ZZ_ROLLBACK' using errcode='P0001';
  exception when others then
    if sqlerrm <> 'ZZ_ROLLBACK' then t:=array_append(t,'ERROR'); pz:=array_append(pz,false); d:=array_append(d,sqlstate||': '||sqlerrm); end if;
  end;
  for i in 1..coalesce(array_length(t,1),0) loop test:=t[i]; pass:=pz[i]; detail:=d[i]; return next; end loop;
end $$;
select * from pg_temp.run_pf();
