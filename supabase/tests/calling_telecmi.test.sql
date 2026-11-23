-- Calling CRM · TeleCMI telephony — tests for migration 0147 (STAGING ONLY)
--
-- Paste into the staging SQL editor (or run via the Supabase MCP) in ONE call. The last statement
-- returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (ZZTEL names / zztel emails). Refuses to run unless app_flags.environment = 'staging'.
--
-- Covers: the admin/caller/anon gates, the off-by-default flag, click-to-call authorisation
-- (prepare), attempt logging, the service-only CDR ingest (lead + caller matching, attempt adoption,
-- recording), per-caller agent mapping, recording-access ownership, and the dial helper.

create or replace function pg_temp.ctu(p_tag text, p_email text, p_role text default null)
returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
    values (u, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (u, p_email, 'ZZTEL ' || p_tag) on conflict (id) do nothing;
  if p_role is not null then insert into public.user_roles (user_id, role) values (u, p_role::public.app_role); end if;
  return u;
end $$;

create or replace function pg_temp.ctcall(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  else perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end if;
  execute p_sql into r; reset role; perform set_config('request.jwt.claims', '', true); return coalesce(r, 'null'::jsonb);
exception when others then reset role; perform set_config('request.jwt.claims', '', true); return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.ctrpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.run_calling_telecmi_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; cA uuid; cB uuid; usr uuid; r jsonb; s text; n int;
  lead1 uuid; lead2 uuid; v_flag text;
begin
  begin
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then raise exception 'not staging'; end if;

    adm := pg_temp.ctu('admin', 'zztel-admin@example.invalid', 'admin');
    cA  := pg_temp.ctu('callerA', 'zztel-a@example.invalid', 'caller');
    cB  := pg_temp.ctu('callerB', 'zztel-b@example.invalid', 'caller');
    usr := pg_temp.ctu('plain', 'zztel-plain@example.invalid', null);
    insert into public.calling_leads (name, phone, source, assigned_to) values ('ZZTEL Lead 1', '919000000001', 'manual', cA) returning id into lead1;
    insert into public.calling_leads (name, phone, source, assigned_to) values ('ZZTEL Lead 2', '919000000002', 'manual', cB) returning id into lead2;
    -- caller A gets mapped below via the admin RPC; caller B stays unmapped
    update public.app_flags set value = 'off' where key = 'telecmi_enabled';

    -- ── A. gates ──
    r := pg_temp.ctcall(null, pg_temp.ctrpc('calling_telecmi_prepare', jsonb_build_object('lead_id', lead1)), true);
    tn := tn || text 'A anon cannot call prepare'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.ctcall(usr, pg_temp.ctrpc('calling_telecmi_prepare', jsonb_build_object('lead_id', lead1)));
    tn := tn || text 'A a non-caller non-admin is forbidden from prepare'; td := td || r::text; tp := tp || (r->>'message' = 'forbidden');
    r := pg_temp.ctcall(usr, pg_temp.ctrpc('calling_set_telecmi_agent', jsonb_build_object('user_id', cA, 'telecmi_user_id', 'X')));
    tn := tn || text 'A a non-admin cannot map an agent'; td := td || r::text; tp := tp || (r->>'message' = 'forbidden');
    r := pg_temp.ctcall(cA, 'select public.calling_telecmi_roster()');
    tn := tn || text 'A a caller cannot read the admin roster'; td := td || r::text; tp := tp || (r->>'message' = 'forbidden');
    r := pg_temp.ctcall(cA, 'select public.calling_telecmi_ingest(''{}''::jsonb)');
    tn := tn || text 'A ingest is not callable by a caller (service role only)'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.ctcall(adm, 'select public.calling_telecmi_ingest(''{}''::jsonb)');
    tn := tn || text 'A ingest is not callable by an admin either'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.ctcall(cA, 'select to_jsonb(count(*)) from public.calling_call_events');
    tn := tn || text 'A the call-events table is not readable from the browser'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.ctcall(cA, 'select to_jsonb(count(*)) from public.calling_telecmi_agents');
    tn := tn || text 'A the agents table is not readable from the browser'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    select bool_and(relrowsecurity) into v_flag from pg_class where relname in ('calling_call_events','calling_telecmi_agents');
    tn := tn || text 'A RLS is on for both new tables'; td := td || coalesce(v_flag,'null'); tp := tp || (v_flag = 'true');

    -- ── B. admin agent mapping ──
    r := pg_temp.ctcall(adm, pg_temp.ctrpc('calling_set_telecmi_agent', jsonb_build_object('user_id', usr, 'telecmi_user_id', 'U1')));
    tn := tn || text 'B cannot map a non-caller'; td := td || r::text; tp := tp || (r->>'error' = 'not_a_caller');
    r := pg_temp.ctcall(adm, pg_temp.ctrpc('calling_set_telecmi_agent', jsonb_build_object('user_id', cA, 'telecmi_user_id', 'A1', 'call_mode', 'spaceship')));
    tn := tn || text 'B a bad call mode is refused'; td := td || r::text; tp := tp || (r->>'error' = 'bad_call_mode');
    r := pg_temp.ctcall(adm, pg_temp.ctrpc('calling_set_telecmi_agent', jsonb_build_object('user_id', cA, 'telecmi_user_id', 'A1', 'callerid', 'abc')));
    tn := tn || text 'B a non-numeric caller id is refused'; td := td || r::text; tp := tp || (r->>'error' = 'bad_callerid');
    r := pg_temp.ctcall(adm, pg_temp.ctrpc('calling_set_telecmi_agent', jsonb_build_object('user_id', cA, 'telecmi_user_id', 'A1', 'call_mode', 'mobile', 'callerid', '918000000000')));
    tn := tn || text 'B map caller A (mobile)'; td := td || r::text; tp := tp || (r->>'ok' = 'true');
    r := pg_temp.ctcall(adm, 'select public.calling_telecmi_roster()');
    tn := tn || text 'B roster shows caller A mapped, caller B not'; td := td || r::text;
    tp := tp || ((select bool_and(case when x->>'user_id' = cA::text then (x->>'mapped')='true' and x->>'telecmi_user_id'='A1'
                                       when x->>'user_id' = cB::text then (x->>'mapped')='false' else true end)
                 from jsonb_array_elements(r) x));

    -- ── C. prepare + the flag ──
    r := pg_temp.ctcall(cA, pg_temp.ctrpc('calling_telecmi_prepare', jsonb_build_object('lead_id', lead1)));
    tn := tn || text 'C prepare returns disabled while the flag is off'; td := td || r::text; tp := tp || (r->>'error' = 'disabled');
    update public.app_flags set value = 'on' where key = 'telecmi_enabled';
    r := pg_temp.ctcall(cA, pg_temp.ctrpc('calling_telecmi_prepare', jsonb_build_object('lead_id', lead1)));
    tn := tn || text 'C caller A prepares their own lead → dial 91+number, user A1, mobile'; td := td || r::text;
    tp := tp || (r->>'ok' = 'true' and r->>'to' = '919000000001' and r->>'telecmi_user_id' = 'A1' and r->>'call_mode' = 'mobile' and r->>'callerid' = '918000000000');
    r := pg_temp.ctcall(cA, pg_temp.ctrpc('calling_telecmi_prepare', jsonb_build_object('lead_id', lead2)));
    tn := tn || text 'C caller A cannot prepare a lead assigned to B'; td := td || r::text; tp := tp || (r->>'error' = 'not_your_lead');
    r := pg_temp.ctcall(cB, pg_temp.ctrpc('calling_telecmi_prepare', jsonb_build_object('lead_id', lead2)));
    tn := tn || text 'C an unmapped caller gets no_agent'; td := td || r::text; tp := tp || (r->>'error' = 'no_agent');
    r := pg_temp.ctcall(adm, pg_temp.ctrpc('calling_telecmi_prepare', jsonb_build_object('lead_id', lead2)));
    tn := tn || text 'C an admin without a mapping also gets no_agent'; td := td || r::text; tp := tp || (r->>'error' = 'no_agent');

    -- ── D. log attempt ──
    r := pg_temp.ctcall(cA, pg_temp.ctrpc('calling_telecmi_log_attempt', jsonb_build_object('lead_id', lead1, 'request_id', 'req_1')));
    tn := tn || text 'D log_attempt records an initiated event'; td := td || r::text; tp := tp || (r->>'ok' = 'true');
    select call_count into n from public.calling_leads where id = lead1;
    tn := tn || text 'D the lead call_count is bumped to 1'; td := td || n::text; tp := tp || (n = 1);
    select count(*)::int into n from public.calling_call_events where lead_id = lead1 and status = 'initiated';
    tn := tn || text 'D exactly one initiated event exists for the lead'; td := td || n::text; tp := tp || (n = 1);
    r := pg_temp.ctcall(cB, pg_temp.ctrpc('calling_telecmi_log_attempt', jsonb_build_object('lead_id', lead1)));
    tn := tn || text 'D caller B cannot log an attempt on A''s lead'; td := td || r::text; tp := tp || (r->>'error' = 'not_your_lead');

    -- ── E. CDR ingest (service role / db owner) ──
    -- the CDR for the attempt just logged → should ADOPT that initiated row (not insert a new one)
    r := public.calling_telecmi_ingest(jsonb_build_object('cmiuid','CMI-1','agent','A1','to','919000000001','duration',34,'billedsec',31,'filename','rec1.mp3','record','true','time', (extract(epoch from now())*1000)::bigint::text));
    tn := tn || text 'E ingest matches the lead and the caller'; td := td || r::text; tp := tp || (r->>'ok'='true' and r->>'matched_lead'='true' and r->>'matched_caller'='true');
    select count(*)::int into n from public.calling_call_events where lead_id = lead1;
    tn := tn || text 'E the CDR adopted the initiated attempt (still one event for the lead)'; td := td || n::text; tp := tp || (n = 1);
    select format('%s|%s|%s|%s', status, billedsec, recording_url, (caller_id = cA)::text) into s from public.calling_call_events where telecmi_cmiuid = 'CMI-1';
    tn := tn || text 'E the event is completed, billed 31s, recording url + caller set'; td := td || coalesce(s,'null');
    tp := tp || (s = 'completed|31|/api/calling/recording/rec1.mp3|true');
    -- a second CDR with the same cmiuid updates in place (idempotent)
    r := public.calling_telecmi_ingest(jsonb_build_object('cmiuid','CMI-1','agent','A1','to','919000000001','duration',40,'billedsec',38,'record','false','time', (extract(epoch from now())*1000)::bigint::text));
    select count(*)::int into n from public.calling_call_events where telecmi_cmiuid = 'CMI-1';
    tn := tn || text 'E the same cmiuid updates in place (no duplicate)'; td := td || n::text; tp := tp || (n = 1);
    -- an unmatched number is still stored (lead null), never throws
    r := public.calling_telecmi_ingest(jsonb_build_object('cmiuid','CMI-2','agent','A1','to','919999999999','billedsec',5,'time', (extract(epoch from now())*1000)::bigint::text));
    tn := tn || text 'E an unmatched number is stored with no lead'; td := td || r::text; tp := tp || (r->>'ok'='true' and r->>'matched_lead'='false' and r->>'matched_caller'='true');
    -- a missed call (no billedsec) → status missed
    r := public.calling_telecmi_ingest(jsonb_build_object('cmiuid','CMI-3','agent','A1','to','919000000001','duration',8,'time', (extract(epoch from now())*1000)::bigint::text));
    select status into s from public.calling_call_events where telecmi_cmiuid = 'CMI-3';
    tn := tn || text 'E a call that was never answered is recorded as missed'; td := td || coalesce(s,'null'); tp := tp || (s = 'missed');

    -- ── F. caller call history + recording access ──
    r := pg_temp.ctcall(cA, pg_temp.ctrpc('calling_lead_calls', jsonb_build_object('lead_id', lead1)));
    tn := tn || text 'F caller A sees the call history of their lead'; td := td || left(r::text,120);
    tp := tp || (r->>'ok'='true' and jsonb_array_length(r->'calls') >= 2);
    r := pg_temp.ctcall(cB, pg_temp.ctrpc('calling_lead_calls', jsonb_build_object('lead_id', lead1)));
    tn := tn || text 'F caller B cannot see A''s lead history'; td := td || r::text; tp := tp || (r->>'message' = 'forbidden');
    r := pg_temp.ctcall(cA, pg_temp.ctrpc('calling_recording_ok', jsonb_build_object('file', 'rec1.mp3')));
    tn := tn || text 'F caller A may hear their own lead''s recording'; td := td || r::text; tp := tp || (r->>'ok' = 'true');
    r := pg_temp.ctcall(cB, pg_temp.ctrpc('calling_recording_ok', jsonb_build_object('file', 'rec1.mp3')));
    tn := tn || text 'F caller B may not hear A''s recording'; td := td || r::text; tp := tp || (r->>'ok' = 'false');
    r := pg_temp.ctcall(adm, pg_temp.ctrpc('calling_recording_ok', jsonb_build_object('file', 'rec1.mp3')));
    tn := tn || text 'F an admin may hear any recording'; td := td || r::text; tp := tp || (r->>'ok' = 'true');

    -- ── G. dial helper ──
    tn := tn || text 'G dial = 91 + last 10 digits'; td := td || coalesce(public.calling_dial('+91 90000-00001'),'null'); tp := tp || (public.calling_dial('+91 90000-00001') = '919000000001');
    tn := tn || text 'G dial of empty is null'; td := td || coalesce(public.calling_dial(''),'null'); tp := tp || (public.calling_dial('') is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select test, pass, detail from pg_temp.run_calling_telecmi_tests();
