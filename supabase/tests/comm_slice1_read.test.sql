-- Communication Manager · Slice 1 (read-only) · database tests for migration 0060
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor,
-- or run it through the Supabase MCP / psql. The last statement returns one row
-- per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled
-- back with a private error code at the end. Test data is fake only
-- (@example.invalid e-mails, 90000000xx numbers, names starting with ZZTEST).
--
-- Logged-in calls are simulated the way PostgREST does it: SET ROLE authenticated
-- (or anon) + request.jwt.claims {"sub": <uid>}. auth.uid() reads that claim.

-- ── helpers (session-temporary) ────────────────────────────────────────────────
create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email) values (v, p_email)
  on conflict (id) do update set email = excluded.email;
  return v;
end $$;

create or replace function pg_temp.mk_admin(p_uid uuid)
returns void language sql as $$
  insert into public.user_roles (user_id, role) values (p_uid, 'admin');
$$;

-- run one SQL expression as a logged-in user, as authenticated-without-sub, or as anon
create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      case when p_uid is null then '{"role":"authenticated"}'
           else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
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

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_comm_slice1_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; c_wa uuid; c_em uuid; c_sched uuid; c_und uuid; c_old uuid;
  r jsonb; s text; f text; n bigint; ok boolean; before_counts text; after_counts text;
  fr text := quote_literal((now() - interval '30 days')::text) || '::timestamptz';
  tt text := quote_literal((now() + interval '1 day')::text) || '::timestamptz';
  calls text[];
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-admin@example.invalid');
    perform pg_temp.mk_admin(adm);
    usr := pg_temp.mk_user('zztest-user@example.invalid');

    -- jobs: WhatsApp (3 sends: read, delivered, failed), e-mail (2: delivered+opened+clicked, bounced),
    -- scheduled (no sends), undelivered (2 failed sends), and one 200 days old (outside any 90-day range)
    insert into public.comms_campaigns (name, channel, template_ref, recipient_count, created_by, created_at, status)
    values ('ZZTEST WA job', 'whatsapp', 'zztest_tpl_a', 3, adm, now() - interval '1 day', 'sent') returning id into c_wa;
    insert into public.comms_campaigns (name, channel, template_ref, recipient_count, created_by, created_at, status)
    values ('ZZTEST Email job', 'email', 'zztest_tpl_b', 2, adm, now() - interval '2 days', 'sent') returning id into c_em;
    insert into public.comms_campaigns (name, channel, template_ref, recipient_count, created_by, created_at, scheduled_at, status)
    values ('ZZTEST Scheduled job', 'whatsapp', 'zztest_tpl_c', 5, adm, now(), now() + interval '1 day', 'sent') returning id into c_sched;
    insert into public.comms_campaigns (name, channel, template_ref, recipient_count, created_by, created_at, status)
    values ('ZZTEST Undelivered job', 'whatsapp', 'zztest_tpl_d', 4, adm, now() - interval '3 days', 'sent') returning id into c_und;
    insert into public.comms_campaigns (name, channel, template_ref, recipient_count, created_by, created_at, status)
    values ('ZZTEST Old job', 'whatsapp', 'zztest_tpl_e', 1, adm, now() - interval '200 days', 'sent') returning id into c_old;

    insert into public.whatsapp_sends (to_number, template_id, status, campaign_id, created_at, delivered_at, read_at, failed_reason) values
      ('919000000001', 'zztest_tpl_a', 'read',      c_wa, now() - interval '1 day', now(), now(), null),
      ('919000000002', 'zztest_tpl_a', 'delivered', c_wa, now() - interval '1 day', now(), null,  null),
      ('919000000003', 'zztest_tpl_a', 'failed',    c_wa, now() - interval '1 day', null,  null,  'Number not on WhatsApp'),
      ('919000000004', 'zztest_tpl_d', 'failed',    c_und, now() - interval '3 days', null, null, null),
      ('919000000005', 'zztest_tpl_d', 'undelivered', c_und, now() - interval '3 days', null, null, 'Expired');
    insert into public.email_events (to_email, kind, subject, status, campaign_id, sent_at, delivered_at, opened_at, clicked_at, bounced_at) values
      ('zz-e1@example.invalid', 'campaign', 'ZZTEST subject', 'delivered', c_em, now() - interval '2 days', now(), now(), now(), null),
      ('zz-e2@example.invalid', 'campaign', 'ZZTEST subject', 'bounced',   c_em, now() - interval '2 days', null,  null,  null,  now());

    insert into public.comms_optouts (email, phone, channel, reason, opted_out_at) values
      ('zz-unsub@example.invalid', null, 'email', 'unsubscribe link', now() - interval '5 days'),
      ('zz-bounce@example.invalid', null, 'email', 'hard bounce', now() - interval '4 days'),
      (null, '919000000011', 'whatsapp', 'STOP reply', now() - interval '3 days'),
      ('zz-all@example.invalid', '919000000012', 'all', 'manual unsubscribe', now() - interval '2 days');

    select format('%s/%s/%s/%s', (select count(*) from public.comms_campaigns), (select count(*) from public.whatsapp_sends),
                  (select count(*) from public.email_events), (select count(*) from public.comms_optouts)) into before_counts;

    -- ════ A. who may call: anon, logged-in without sub, non-admin → 42501; admin → data ════
    calls := array[
      format('select public.comm_logs_list(%s, %s, null, null, null, null, null, null, null, null, 1, 10)', fr, tt),
      format('select public.comm_logs_options(%s, %s)', fr, tt),
      format('select public.comm_log_get(%L::uuid)', c_wa),
      format('select public.comm_log_recipients(%L::uuid, null, null, null, null, null, null, 1, 10)', c_wa),
      format('select public.comm_log_failures(%L::uuid)', c_wa),
      format('select public.comm_performance(%s, %s, null, null)', fr, tt),
      'select public.comm_suppressions_list(''Email'', null, null, null, null, null, null, 1, 10)',
      'select public.comm_suppressions_counts(''Email'', null, null, null)'];
    foreach s in array calls loop
      f := substring(s from 'public\.(comm_[a-z_]+)');
      r := pg_temp.call_as(null, s, true);
      t_name := t_name || ('A anon refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(null, s);
      t_name := t_name || ('A logged in without user id refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(usr, s);
      t_name := t_name || ('A non-admin refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(adm, s);
      t_name := t_name || ('A admin allowed: ' || f); t_det := t_det || left(r::text, 200); t_pass := t_pass || (r->>'sqlstate' is null);
    end loop;

    -- ════ B. grants and function settings ════
    for f, ok in
      select p.oid::regprocedure::text,
             p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
               and has_function_privilege('authenticated', p.oid, 'execute')
               and not has_function_privilege('anon', p.oid, 'execute')
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname like 'comm\_%' and p.proname not like 'comm\_\_%'
    loop
      t_name := t_name || ('B page function: definer, search_path '''', authenticated yes, anon no: ' || f); t_det := t_det || ok::text; t_pass := t_pass || ok;
    end loop;
    for f, ok in
      select p.oid::regprocedure::text,
             not has_function_privilege('authenticated', p.oid, 'execute')
               and not has_function_privilege('anon', p.oid, 'execute')
               and not p.prosecdef
               and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname like 'comm\_\_%'
    loop
      t_name := t_name || ('B private helper not callable by anon/authenticated: ' || f); t_det := t_det || ok::text; t_pass := t_pass || ok;
    end loop;
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname like 'comm\_%';
    t_name := t_name || text 'B exactly 13 comm functions exist (8 page + 5 helpers)'; t_det := t_det || n::text; t_pass := t_pass || (n = 13);

    -- ════ C. Communication Logs list ════
    r := pg_temp.call_as(adm, format('select public.comm_logs_list(%s, %s, null, null, null, null, null, %L, ''targeted'', ''asc'', 1, 10)', fr, tt, 'ZZTEST'));
    t_name := t_name || text 'C search ZZTEST in last 30 days: 4 jobs, the 200-day-old job is not included'; t_det := t_det || (r->>'total');
    t_pass := t_pass || ((r->>'total')::int = 4 and not (r->'rows') @> jsonb_build_array(jsonb_build_object('id', c_old)));
    t_name := t_name || text 'C sort Targeted asc: email(2), WA(3), undelivered(4), scheduled(5)';
    t_det := t_det || (select string_agg(x->>'recipient_count', ',') from jsonb_array_elements(r->'rows') x);
    t_pass := t_pass || ((select string_agg(x->>'recipient_count', ',') from jsonb_array_elements(r->'rows') x) = '2,3,4,5');
    t_name := t_name || text 'C statuses: Completed, Completed, Undelivered, Scheduled';
    t_det := t_det || (select string_agg(x->>'status', ',') from jsonb_array_elements(r->'rows') x);
    t_pass := t_pass || ((select string_agg(x->>'status', ',') from jsonb_array_elements(r->'rows') x) = 'Completed,Completed,Undelivered,Scheduled');
    select x into r from jsonb_array_elements(r->'rows') x where x->>'id' = c_wa::text;
    t_name := t_name || text 'C WA job counts: sent 3, delivered 2, read 1, failed 1'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sent' = '3' and r->>'delivered' = '2' and r->>'read' = '1' and r->>'failed' = '1' and r->>'clicked' = '0');
    t_name := t_name || text 'C job row has only the agreed keys (no ord, no created_by)'; t_det := t_det || (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k);
    t_pass := t_pass || ((select string_agg(k, ',' order by k) from jsonb_object_keys(r) k)
                         = 'audience,channel,clicked,created_at,delivered,failed,id,kind,name,read,recipient_count,scheduled_at,sent,status,template');

    r := pg_temp.call_as(adm, format('select public.comm_logs_list(%s, %s, ''email'', null, null, null, null, ''ZZTEST'', null, null, 1, 10)', fr, tt));
    t_name := t_name || text 'C channel=email: 1 job, counts sent 2, delivered 1, read 1, clicked 1, failed 1'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'total')::int = 1 and r#>>'{rows,0,sent}' = '2' and r#>>'{rows,0,delivered}' = '1' and r#>>'{rows,0,read}' = '1'
                         and r#>>'{rows,0,clicked}' = '1' and r#>>'{rows,0,failed}' = '1');
    r := pg_temp.call_as(adm, format('select public.comm_logs_list(%s, %s, null, ''Scheduled'', null, null, null, ''ZZTEST'', null, null, 1, 10)', fr, tt));
    t_name := t_name || text 'C status=Scheduled: 1 job'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 1);
    r := pg_temp.call_as(adm, format('select public.comm_logs_list(%s, %s, null, null, ''zztest_tpl_d'', null, null, null, null, null, 1, 10)', fr, tt));
    t_name := t_name || text 'C template filter: 1 job'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 1);
    r := pg_temp.call_as(adm, format('select public.comm_logs_list(%s, %s, null, null, null, ''Single User'', null, ''ZZTEST'', null, null, 1, 10)', fr, tt));
    t_name := t_name || text 'C nature=Single User: 0 jobs (all test jobs are bulk)'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 0);
    r := pg_temp.call_as(adm, format('select public.comm_logs_list(%s, %s, null, null, null, null, ''Undelivered job'', null, null, null, 1, 10)', fr, tt));
    t_name := t_name || text 'C campaign name filter: 1 job'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 1);
    r := pg_temp.call_as(adm, format('select public.comm_logs_list(%s, %s, null, null, null, null, null, %L, null, null, 1, 10)', fr, tt, 'Job#' || upper(left(c_wa::text, 8))));
    t_name := t_name || text 'C search by Job# id prefix finds the job'; t_det := t_det || (r->>'total');
    t_pass := t_pass || (r->'rows' @> jsonb_build_array(jsonb_build_object('id', c_wa)));
    r := pg_temp.call_as(adm, format('select public.comm_logs_list(%s, %s, null, null, null, null, null, ''ZZ%%TEST'', null, null, 1, 10)', fr, tt));
    t_name := t_name || text 'C search treats % literally (ZZ%TEST matches nothing)'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 0);
    r := pg_temp.call_as(adm, format('select public.comm_logs_list(%s, %s, null, null, null, null, null, ''ZZTEST'', ''targeted'', ''asc'', 2, 3)', fr, tt));
    t_name := t_name || text 'C paging: page 2 of size 3 has 1 row, total still 4'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'total')::int = 4 and jsonb_array_length(r->'rows') = 1 and r#>>'{rows,0,recipient_count}' = '5');
    r := pg_temp.call_as(adm, format('select public.comm_logs_list(%s, %s, null, null, null, null, null, ''ZZTEST'', null, null, 50, 10)', fr, tt));
    t_name := t_name || text 'C page past the end: empty rows, total 4'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'total')::int = 4 and r->'rows' = '[]'::jsonb);

    -- ════ D. bad input → 22023 (never data) ════
    foreach s in array array[
      format('select public.comm_logs_list(%s, %s, null, null, null, null, null, null, null, null, 1, 10)', fr, quote_literal((now() + interval '61 days')::text) || '::timestamptz'),
      format('select public.comm_logs_list(%s, %s, null, null, null, null, null, null, null, null, 1, 10)', tt, fr),
      format('select public.comm_logs_list(%s, null, null, null, null, null, null, null, null, null, 1, 10)', fr),
      'select public.comm_logs_list(null, null, null, null, null, null, null, null, null, null, 1, 10)',
      format('select public.comm_logs_list(%s, %s, null, null, null, null, null, null, null, null, 1, 101)', fr, tt),
      format('select public.comm_logs_list(%s, %s, null, null, null, null, null, null, null, null, 1, 0)', fr, tt),
      format('select public.comm_logs_list(%s, %s, null, null, null, null, null, null, null, null, 0, 10)', fr, tt),
      format('select public.comm_logs_list(%s, %s, null, null, null, null, null, null, null, null, 10001, 10)', fr, tt),
      format('select public.comm_logs_list(%s, %s, null, null, null, null, null, null, ''created_by'', null, 1, 10)', fr, tt),
      format('select public.comm_logs_list(%s, %s, null, null, null, null, null, null, null, ''sideways'', 1, 10)', fr, tt),
      format('select public.comm_logs_list(%s, %s, ''sms'', null, null, null, null, null, null, null, 1, 10)', fr, tt),
      format('select public.comm_logs_list(%s, %s, null, ''Deleted'', null, null, null, null, null, null, 1, 10)', fr, tt),
      format('select public.comm_logs_list(%s, %s, null, null, null, null, null, %L, null, null, 1, 10)', fr, tt, repeat('a', 101)),
      format('select public.comm_performance(%s, %s, null, null)', fr, quote_literal((now() + interval '61 days')::text) || '::timestamptz'),
      'select public.comm_performance(null, null, null, null)',
      format('select public.comm_log_recipients(%L::uuid, ''Opened'', null, null, null, null, null, 1, 10)', c_wa),
      format('select public.comm_log_recipients(%L::uuid, null, null, null, null, ''to_number'', null, 1, 10)', c_wa),
      format('select public.comm_log_recipients(%L::uuid, null, null, null, null, null, null, 1, 1000)', c_wa),
      'select public.comm_log_get(null)',
      'select public.comm_suppressions_list(null, null, null, null, null, null, null, 1, 10)',
      'select public.comm_suppressions_list(''SMS'', null, null, null, null, null, null, 1, 10)',
      'select public.comm_suppressions_list(''Email'', ''Deleted'', null, null, null, null, null, 1, 10)',
      'select public.comm_suppressions_counts(''Fax'', null, null, null)'] loop
      r := pg_temp.call_as(adm, s);
      t_name := t_name || ('D refused with 22023: ' || left(regexp_replace(s, '\s+', ' ', 'g'), 120)); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    r := pg_temp.call_as(adm, format('select public.comm_logs_list(%s, %s, null, null, null, null, null, null, null, null, 1, 10)',
                                     quote_literal((now() - interval '89 days')::text) || '::timestamptz', quote_literal((now() + interval '1 day')::text) || '::timestamptz'));
    t_name := t_name || text 'D exactly 90 days is allowed'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->>'sqlstate' is null);

    -- ════ E. one job ════
    r := pg_temp.call_as(adm, format('select public.comm_log_get(%L::uuid)', c_em));
    t_name := t_name || text 'E get e-mail job: counts + subject'; t_det := t_det || r::text;
    t_pass := t_pass || (r#>>'{job,sent}' = '2' and r->>'subject' = 'ZZTEST subject');
    r := pg_temp.call_as(adm, format('select public.comm_log_get(%L::uuid)', gen_random_uuid()));
    t_name := t_name || text 'E unknown id: job is null (route answers 404)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->'job' = 'null'::jsonb);
    r := pg_temp.call_as(adm, format('select public.comm_log_get(%L::uuid)', c_old));
    t_name := t_name || text 'E get works for an old job (no date limit on a single id)'; t_det := t_det || left(r::text, 120);
    t_pass := t_pass || (r#>>'{job,id}' = c_old::text);

    -- ════ F. recipients (Detailed Report) ════
    r := pg_temp.call_as(adm, format('select public.comm_log_recipients(%L::uuid, null, null, null, null, null, null, 1, 10)', c_wa));
    t_name := t_name || text 'F WA job has 3 recipients with statuses Read, Delivered, Failed'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'total')::int = 3
      and (select string_agg(x->>'status', ',' order by x->>'status') from jsonb_array_elements(r->'rows') x) = 'Delivered,Failed,Read');
    r := pg_temp.call_as(adm, format('select public.comm_log_recipients(%L::uuid, ''Failed'', null, null, null, null, null, 1, 10)', c_wa));
    t_name := t_name || text 'F status=Failed: 1'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 1);
    r := pg_temp.call_as(adm, format('select public.comm_log_recipients(%L::uuid, null, null, null, ''9000000002'', null, null, 1, 10)', c_wa));
    t_name := t_name || text 'F search by number: 1'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 1);
    r := pg_temp.call_as(adm, format('select public.comm_log_recipients(%L::uuid, null, null, null, null, ''status'', ''asc'', 2, 2)', c_wa));
    t_name := t_name || text 'F paging + sort status asc: page 2 of size 2 = Read'; t_det := t_det || r::text;
    t_pass := t_pass || (jsonb_array_length(r->'rows') = 1 and r#>>'{rows,0,status}' = 'Read');
    r := pg_temp.call_as(adm, format('select public.comm_log_recipients(%L::uuid, null, null, null, null, null, null, 1, 10)', c_em));
    t_name := t_name || text 'F e-mail job: Clicked + Failed (bounce)'; t_det := t_det || r::text;
    t_pass := t_pass || ((select string_agg(x->>'status', ',' order by x->>'status') from jsonb_array_elements(r->'rows') x) = 'Clicked,Failed');

    -- ════ G. failure reasons (no contact details) ════
    r := pg_temp.call_as(adm, format('select public.comm_log_failures(%L::uuid)', c_wa));
    t_name := t_name || text 'G WA failures: 1 line, reason kept, no contact field'; t_det := t_det || r::text;
    t_pass := t_pass || (jsonb_array_length(r) = 1 and r#>>'{0,reason}' = 'Number not on WhatsApp' and not (r->0 ? 'contact'));
    r := pg_temp.call_as(adm, format('select public.comm_log_failures(%L::uuid)', c_und));
    t_name := t_name || text 'G empty failed_reason becomes "Failed"'; t_det := t_det || r::text;
    t_pass := t_pass || (jsonb_array_length(r) = 2 and r::text like '%"Failed"%' and r::text like '%"Expired"%');

    -- ════ H. performance ════
    r := pg_temp.call_as(adm, format('select public.comm_performance(%s, %s, null, ''zztest_tpl_a'')', fr, tt));
    t_name := t_name || text 'H template A: totals sent 3 / delivered 2 / read 1 / failed 1; basis 1 matched, 1 counted'; t_det := t_det || r::text;
    t_pass := t_pass || (r#>>'{totals,sent}' = '3' and r#>>'{totals,delivered}' = '2' and r#>>'{totals,read}' = '1' and r#>>'{totals,failed}' = '1'
                         and r#>>'{basis,matched}' = '1' and r#>>'{basis,counted}' = '1' and jsonb_array_length(r->'by_day') = 1
                         and r#>>'{by_channel,0,channel}' = 'whatsapp');
    r := pg_temp.call_as(adm, format('select public.comm_performance(%s, %s, null, ''zztest_tpl_c'')', fr, tt));
    t_name := t_name || text 'H scheduled job is listed in basis, not counted'; t_det := t_det || r::text;
    t_pass := t_pass || (r#>>'{basis,matched}' = '1' and r#>>'{basis,counted}' = '0' and r#>>'{basis,scheduled}' = '1' and r#>>'{totals,sent}' = '0');
    r := pg_temp.call_as(adm, format('select public.comm_performance(%s, %s, ''email'', ''zztest_tpl_a'')', fr, tt));
    t_name := t_name || text 'H channel + template that do not match: zeros'; t_det := t_det || r::text;
    t_pass := t_pass || (r#>>'{basis,matched}' = '0' and r#>>'{totals,sent}' = '0' and r->'by_day' = '[]'::jsonb);

    -- ════ I. suppressions ════
    r := pg_temp.call_as(adm, 'select public.comm_suppressions_counts(''Email'', null, null, ''example.invalid'')');
    t_name := t_name || text 'I e-mail counts: Unsubscribe 1, Bounce 1, Block 1 (manual), Spam 0, Invalid 0'; t_det := t_det || r::text;
    t_pass := t_pass || (r = '{"Unsubscribe":1,"Bounce":1,"Block":1,"Spam":0,"Invalid":0}'::jsonb);
    r := pg_temp.call_as(adm, 'select public.comm_suppressions_counts(''WhatsApp'', null, null, ''90000000'')');
    t_name := t_name || text 'I WhatsApp counts: 2 opt-outs (whatsapp + all), all as Unsubscribe'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'Unsubscribe' = '2' and r->>'Bounce' = '0');
    r := pg_temp.call_as(adm, 'select public.comm_suppressions_list(''Email'', ''Bounce'', null, null, ''example.invalid'', null, null, 1, 10)');
    t_name := t_name || text 'I e-mail Bounce list: 1 row with the e-mail as contact'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'total')::int = 1 and r#>>'{rows,0,contact}' = 'zz-bounce@example.invalid' and r#>>'{rows,0,channel}' = 'Email');
    r := pg_temp.call_as(adm, 'select public.comm_suppressions_list(''WhatsApp'', null, null, null, ''90000000'', ''contact'', ''asc'', 1, 10)');
    t_name := t_name || text 'I WhatsApp list sorted by contact: phone numbers, not e-mails'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'total')::int = 2 and r#>>'{rows,0,contact}' = '919000000011' and r#>>'{rows,1,contact}' = '919000000012');
    r := pg_temp.call_as(adm, format('select public.comm_suppressions_list(''Email'', null, %L::timestamptz, %L::timestamptz, ''example.invalid'', null, null, 1, 10)',
                                     (now() - interval '4 days 12 hours')::text, now()::text));
    t_name := t_name || text 'I date range keeps only opt-outs inside it'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 2);

    -- ════ J. read-only: nothing changed in the four tables ════
    select format('%s/%s/%s/%s', (select count(*) from public.comms_campaigns), (select count(*) from public.whatsapp_sends),
                  (select count(*) from public.email_events), (select count(*) from public.comms_optouts)) into after_counts;
    t_name := t_name || text 'J row counts of the 4 tables unchanged after all calls'; t_det := t_det || (before_counts || ' -> ' || after_counts);
    t_pass := t_pass || (before_counts = after_counts);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_comm_slice1_tests();
