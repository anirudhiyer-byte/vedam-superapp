-- Partner claim-on-login · tests for migration 0160 (STAGING ONLY)
--
-- Paste into the staging SQL editor or run through the Supabase MCP. The last statement returns
-- one row per test: test | pass | detail. All data lives in a block rolled back with ZDONE.
-- Fake data only (@example.invalid, ZZTEST PCL names, 90000000xx phones).

create or replace function pg_temp.mk_user(p_email text, p_phone text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, phone, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, p_phone, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, phone, full_name) values (v, p_email, p_phone, 'ZZTEST ' || split_part(p_email,'@',1))
  on conflict (id) do update set email=excluded.email;
  -- mimic /api/vsat/lead: the lead_manager row exists before partner_claim runs
  insert into public.lead_manager (lead_id, registered_name, registered_email, registered_mobile, lead_stage, user_registration_date)
  values (v, 'ZZTEST PCL ' || split_part(p_email,'@',1), p_email, p_phone, 'lead', now()) on conflict (lead_id) do nothing;
  return v;
end $$;
create or replace function pg_temp.mk_pl(p_name text, p_phone text, p_email text, p_campus text, p_bdm text, p_prepaid boolean, p_amount numeric)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.partner_leads (partner, name, phone, email, campus, utm_campaign, prepaid, prepaid_amount)
  values ('elevate', p_name, p_phone, p_email, p_campus, p_bdm, p_prepaid, p_amount) returning id into v;
  return v;
end $$;
create or replace function pg_temp.call_as(p_uid uuid, p_sql text)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true); set local role authenticated;
  execute p_sql into r; reset role; perform set_config('request.jwt.claims','',true); return coalesce(r,'null'::jsonb);
exception when others then reset role; perform set_config('request.jwt.claims','',true); return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm);
end $$;
create or replace function pg_temp.run_partner_claim_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare tn text[]:='{}'; tp boolean[]:='{}'; td text[]:='{}';
  a uuid; b uuid; c uuid; d uuid; e uuid; plA uuid; plB uuid; plD uuid; plE uuid; r jsonb; v text; n int; amt numeric;
begin
  begin
    a := pg_temp.mk_user('zztest-pcl-a@example.invalid','9000000001');
    plA := pg_temp.mk_pl('ZZ A','9000000001','zztest-pcl-a@example.invalid','Pune','BDM Raj', false, null);
    b := pg_temp.mk_user('zztest-pcl-b@example.invalid','9000000002');
    plB := pg_temp.mk_pl('ZZ B','9000000888','zztest-pcl-b@example.invalid','Gurugram','BDM Sim', true, 499);
    c := pg_temp.mk_user('zztest-pcl-c@example.invalid','9000000003');
    d := pg_temp.mk_user('zztest-pcl-d@example.invalid','9000000004');
    plD := pg_temp.mk_pl('ZZ D','9000000004','zztest-pcl-d@example.invalid','Pune','BDM X', true, 777);
    perform set_config('vedam.allow_simulated_payments','on',true);
    insert into public.vsat_payments(lead_id,paid_at,payment_ref,provider,amount,currency)
      values (d, now(), 'sim:'||d::text, 'simulated', 1000, 'INR');
    perform set_config('vedam.allow_simulated_payments','',true);

    -- access: a browser (authenticated) may not call the claim
    r := pg_temp.call_as(a, format('select public.partner_claim(%L::uuid, %L, %L)', a, '9000000001','x@x.in'));
    tn:=tn||text 'A authenticated cannot call partner_claim'; td:=td||r::text; tp:=tp||(r->>'sqlstate'='42501');

    -- phone match, not prepaid → attribution-only
    r := public.partner_claim(a, '9000000001', 'zztest-pcl-a@example.invalid');
    tn:=tn||text 'B phone match, not prepaid'; td:=td||r::text; tp:=tp||((r->>'claimed')::boolean and (r->>'prepaid')::boolean = false);
    select status into v from public.partner_leads where id=plA;
    tn:=tn||text 'B partner_lead marked claimed'; td:=td||v; tp:=tp||(v='claimed');
    select utm_source||'/'||utm_medium||'/'||coalesce(utm_campaign,'') into v from public.lead_manager where lead_id=a;
    tn:=tn||text 'B lead UTM schoolconnect/offline/BDM Raj'; td:=td||v; tp:=tp||(v='schoolconnect/offline/BDM Raj');
    tn:=tn||text 'B no payment/application for non-prepaid'; td:=td||'ok'::text;
    tp:=tp||(not exists(select 1 from public.vsat_payments where lead_id=a) and not exists(select 1 from public.application_manager where lead_id=a));

    -- email fallback, prepaid → full paid mirror (triggers seed + advance the pipeline)
    r := public.partner_claim(b, '9999999999', 'zztest-pcl-b@example.invalid');
    tn:=tn||text 'C email fallback prepaid amount 499'; td:=td||r::text; tp:=tp||((r->>'claimed')::boolean and (r->>'prepaid')::boolean and (r->>'amount')::numeric=499);
    select provider into v from public.vsat_payments where lead_id=b; select amount into amt from public.vsat_payments where lead_id=b;
    tn:=tn||text 'C vsat_payments provider=partner amount=499'; td:=td||(v||':'||amt::text); tp:=tp||(v='partner' and amt=499);
    select payment_stage_1||'/'||application_fee_amount::text into v from public.application_manager where lead_id=b;
    tn:=tn||text 'C application payment_approved + fee=499'; td:=td||v; tp:=tp||(v='payment_approved/499');
    select vp.stage into v from public.vsat_pipeline vp join public.application_manager am on am.application_id=vp.application_id where am.lead_id=b;
    tn:=tn||text 'C pipeline advanced to application_fee_paid'; td:=td||coalesce(v,'(none)'); tp:=tp||(v='application_fee_paid');
    select lead_stage into v from public.lead_manager where lead_id=b;
    tn:=tn||text 'C lead_stage applicant_paid'; td:=td||v; tp:=tp||(v='applicant_paid');

    -- no pending match
    r := public.partner_claim(c, '9000000003', 'zztest-pcl-c@example.invalid');
    tn:=tn||text 'D no match → claimed false'; td:=td||r::text; tp:=tp||((r->>'claimed')::boolean = false);

    -- idempotency: a second login does nothing (row already claimed)
    r := public.partner_claim(b, '9999999999', 'zztest-pcl-b@example.invalid');
    select count(*) into n from public.vsat_payments where lead_id=b;
    tn:=tn||text 'E re-claim is a no-op (one payment)'; td:=td||(r::text||' n='||n); tp:=tp||((r->>'claimed')::boolean=false and n=1);

    -- already-paid guard: a real payment is never overwritten
    r := public.partner_claim(d, '9000000004', 'zztest-pcl-d@example.invalid');
    select amount into amt from public.vsat_payments where lead_id=d;
    tn:=tn||text 'F already-paid: reports already_paid, keeps real payment (1000)'; td:=td||(r::text||' amt='||amt); tp:=tp||((r->>'already_paid')::boolean and amt=1000);

    -- SIF enrichment (0162): extra fields pre-filled, verified flags set, source normalised
    e := pg_temp.mk_user('zztest-pcl-e@example.invalid','9000000005');
    insert into public.partner_leads (partner, name, email, phone, campus, utm_source, utm_medium, utm_campaign, prepaid, prepaid_amount, extra)
      values ('elevate','ZZ E','zztest-pcl-e@example.invalid','9000000005','Pune','school connect','DPS Pune','BDM Neha', true, 499,
        '{"stream":"PCM","graduation_year":"2026","state":"Maharashtra","city":"Pune","school_name":"DPS Pune"}'::jsonb) returning id into plE;
    r := public.partner_claim(e, '9000000005', 'zztest-pcl-e@example.invalid');
    select class_12_stream||'/'||passing_year||'/'||state||'/'||city||'/'||school_name||'/'||utm_source||'/'||mobile_verification_status||'/'||email_verification_status
      into v from public.lead_manager where lead_id=e;
    tn:=tn||text 'G SIF: lead enriched + source=schoolconnect + verified'; td:=td||v;
    tp:=tp||(v='PCM/2026/Maharashtra/Pune/DPS Pune/schoolconnect/verified/verified');
    select (mobile_verified and email_verified) into v from public.profiles where id=e;
    tn:=tn||text 'G SIF: profile mobile+email verified'; td:=td||v; tp:=tp||(v='true');
    select class_12_stream||'/'||class12_year||'/'||class12_school into v from public.application_manager where lead_id=e;
    tn:=tn||text 'G SIF: application pre-filled (stream/year/school)'; td:=td||v; tp:=tp||(v='PCM/2026/DPS Pune');

    raise exception 'ZDONE';
  exception when others then if sqlerrm<>'ZDONE' then return query select 'FIXTURE/RUN ERROR'::text,false,sqlerrm; return; end if;
  end;
  for i in 1..array_length(tn,1) loop test:=tn[i]; pass:=tp[i]; detail:=td[i]; return next; end loop;
end $$;
select * from pg_temp.run_partner_claim_tests();
