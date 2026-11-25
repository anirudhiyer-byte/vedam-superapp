-- Partner eager materialization · database tests for migration 0172.
-- STAGING ONLY. Returns one row per test. All data rolled back via a private error code.
-- Fake data only (ZZ names, @example.invalid, unique +9197333… test numbers).
-- NOTE: partner_find_user scans all auth.users (reads aren't isolated by the savepoint), so the
-- find-by-email / find-none cases use an EMPTY phone to avoid matching a real user's last-10 digits.

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

create or replace function pg_temp.run_pm()
returns table(test text, pass boolean, detail text) language plpgsql as $$
declare
  u uuid; u2 uuid; fid uuid; r jsonb; a record; n int; pstage text; v_ls text; v_ps text;
  t text[]:='{}'; pz boolean[]:='{}'; d text[]:='{}'; i int;
begin
  begin
    -- A) non-prepaid materialize → lead_manager + profile, NO application
    u := pg_temp.mk_user('zz-pm-uniq@example.invalid', '+919733312345');
    insert into public.partner_leads (partner, name, email, phone, campus, utm_campaign, prepaid, status, extra)
    values ('elevate','ZZ Partner','zz-pm-uniq@example.invalid','+919733312345','pune','BDM Raj', false, 'pending',
            '{"stream":"PCM","graduation_year":"2027"}'::jsonb);
    r := public.partner_materialize(u, '+919733312345', 'zz-pm-uniq@example.invalid');
    select utm_source, lead_source, utm_campaign into a from public.lead_manager where lead_id=u;
    t:=array_append(t,'lead_manager created w/ schoolconnect attribution'); d:=array_append(d, r::text);
    pz:=array_append(pz, (r->>'materialized')='true' and a.utm_source='schoolconnect' and a.lead_source='schoolconnect' and a.utm_campaign='BDM Raj');

    select full_name, stream, grad_year into a from public.profiles where id=u;
    t:=array_append(t,'profile gaps filled'); d:=array_append(d, coalesce(a.full_name,'')||'/'||coalesce(a.stream,'')||'/'||coalesce(a.grad_year::text,''));
    pz:=array_append(pz, a.full_name='ZZ Partner' and a.stream='PCM' and a.grad_year=2027);

    select count(*) into n from public.application_manager where lead_id=u;
    t:=array_append(t,'NO application_manager (non-prepaid)'); d:=array_append(d,'apps='||n); pz:=array_append(pz, n=0);

    -- find_user: by unique phone, by email (empty phone), none (empty phone + absent email)
    fid := public.partner_find_user('+919733312345', null);
    t:=array_append(t,'find_user by phone'); d:=array_append(d, coalesce(fid::text,'(null)')); pz:=array_append(pz, fid=u);
    fid := public.partner_find_user('', 'ZZ-PM-UNIQ@example.invalid');
    t:=array_append(t,'find_user by email (ci)'); d:=array_append(d, coalesce(fid::text,'(null)')); pz:=array_append(pz, fid=u);
    fid := public.partner_find_user('', 'zz-pm-none-9x7@example.invalid');
    t:=array_append(t,'find_user none → null'); d:=array_append(d, coalesce(fid::text,'(null)')); pz:=array_append(pz, fid is null);

    -- B) prepaid materialize → vsat_payments, no application, lead_stage applicant_paid
    u2 := pg_temp.mk_user('zz-pm2-uniq@example.invalid', '+919733399001');
    insert into public.partner_leads (partner, name, email, phone, prepaid, prepaid_amount, status)
    values ('elevate','ZZ Two','zz-pm2-uniq@example.invalid','+919733399001', true, 800, 'pending');
    r := public.partner_materialize(u2, '+919733399001', null);
    select provider, amount into a from public.vsat_payments where lead_id=u2;
    t:=array_append(t,'prepaid writes vsat_payments (partner)'); d:=array_append(d, r::text);
    pz:=array_append(pz, (r->>'prepaid')='true' and a.provider='partner' and a.amount=800);

    select count(*) into n from public.application_manager where lead_id=u2;
    t:=array_append(t,'NO application_manager (prepaid)'); d:=array_append(d,'apps='||n); pz:=array_append(pz, n=0);

    select lead_stage::text into v_ls from public.lead_manager where lead_id=u2;
    t:=array_append(t,'lead_stage applicant_paid'); d:=array_append(d, v_ls); pz:=array_append(pz, v_ls='applicant_paid');

    -- C) prepaid student starts an application → pipeline application_fee_paid + payment_stage approved
    insert into public.application_manager (application_id, lead_id) values ('ZZ-PM-APP', u2);
    select stage::text into pstage from public.vsat_pipeline where application_id='ZZ-PM-APP';
    select payment_stage_1::text into v_ps from public.application_manager where application_id='ZZ-PM-APP';
    t:=array_append(t,'prepaid app → pipeline application_fee_paid'); d:=array_append(d, coalesce(pstage,'(none)')); pz:=array_append(pz, pstage='application_fee_paid');
    t:=array_append(t,'prepaid app → payment_stage_1 approved'); d:=array_append(d, coalesce(v_ps,'(none)')); pz:=array_append(pz, v_ps='payment_approved');

    -- D) a normal application (lead with no payment) is NOT force-approved by the trigger
    insert into public.application_manager (application_id, lead_id) values ('ZZ-PM-APP2', u);
    select payment_stage_1::text into v_ps from public.application_manager where application_id='ZZ-PM-APP2';
    t:=array_append(t,'normal app (no payment) not force-approved'); d:=array_append(d, coalesce(v_ps,'(none)')); pz:=array_append(pz, v_ps <> 'payment_approved');

    -- E) no pending match → materialized:false
    r := public.partner_materialize(u, '+910000000009', null);
    t:=array_append(t,'no pending match → false'); d:=array_append(d, r::text); pz:=array_append(pz, (r->>'materialized')='false');

    raise exception 'ZZ_ROLLBACK' using errcode='P0001';
  exception when others then
    if sqlerrm <> 'ZZ_ROLLBACK' then
      t:=array_append(t,'SETUP/RUN ERROR'); pz:=array_append(pz,false); d:=array_append(d,sqlstate||': '||sqlerrm);
    end if;
  end;
  for i in 1..coalesce(array_length(t,1),0) loop test:=t[i]; pass:=pz[i]; detail:=d[i]; return next; end loop;
end $$;
select * from pg_temp.run_pm();
