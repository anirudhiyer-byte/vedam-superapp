-- Communication Manager · C1 (opted-out contacts in list counts) · database tests for migration 0106
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP / psql. The last statement returns one row per test: test | pass | detail.
-- Refuses to run unless app_flags.environment = 'staging'.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
-- error code at the end. Fake data only (@example.invalid e-mails, 90000003xx numbers, ZZ names).
-- No big inserts here: the 50,000-profile / 5,000-opt-out volume run is done on a local Postgres.
--
-- The same 4 numbers (total, with_phone, with_email, consented) are read from all 4 places that count:
--   preview (comm_audience_preview), saved dynamic list and saved static list (comm_list_count),
--   import dry run (comm_list_import, `members` = total). They must always agree.

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'not the staging database - refusing to run tests';
  end if;
end $$;

-- ── helpers (session-temporary) ────────────────────────────────────────────────
create or replace function pg_temp.mk_user(p_email text, p_phone text default null, p_consent boolean default false)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, coalesce(nullif(btrim(p_email), ''), 'zz-c1-noemail-' || substr(v::text, 1, 8) || '@example.invalid'),
          'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id) values (v) on conflict (id) do nothing;
  update public.profiles set email = p_email, phone = p_phone, consent_given = coalesce(p_consent, false) where id = v;
  return v;
end $$;

create or replace function pg_temp.mk_admin(p_uid uuid)
returns void language sql as $$
  insert into public.user_roles (user_id, role) values (p_uid, 'admin');
$$;

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

-- the 4 counting places → 4 strings "total/with_phone/with_email/consented"
create or replace function pg_temp.c4(p_adm uuid, p_dyn uuid, p_st uuid, p_ids jsonb)
returns text[] language plpgsql as $$
declare r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
begin
  r1 := pg_temp.call_as(p_adm, format('select public.comm_audience_preview(%L::jsonb)', '{"utm_source":["zz_c1_src"]}'));
  r2 := pg_temp.call_as(p_adm, format('select public.comm_list_count(%L::uuid)', p_dyn));
  r3 := pg_temp.call_as(p_adm, format('select public.comm_list_count(%L::uuid)', p_st));
  r4 := pg_temp.call_as(p_adm, format('select public.comm_list_import(null, %L::jsonb, true)', p_ids));
  return array[
    format('%s/%s/%s/%s', r1->>'total', r1->>'with_phone', r1->>'with_email', r1->>'consented'),
    format('%s/%s/%s/%s', r2->>'total', r2->>'with_phone', r2->>'with_email', r2->>'consented'),
    format('%s/%s/%s/%s', r3->>'total', r3->>'with_phone', r3->>'with_email', r3->>'consented'),
    format('%s/%s/%s/%s', r4->>'members', r4->>'with_phone', r4->>'with_email', r4->>'consented')];
end $$;

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_comm_c1_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; a1 uuid; a2 uuid; a3 uuid; dyn uuid; st uuid;
  ids jsonb; c text[]; r jsonb; s text; f text; ok boolean;
  base text; exp_ph bigint; exp_em bigint; before_counts text; after_counts text;
  acl_expected constant text := '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}';
  sc record;
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zz-c1-admin@example.invalid'); perform pg_temp.mk_admin(adm);
    usr := pg_temp.mk_user('zz-c1-user@example.invalid');
    -- the three phone shapes a profile can hold; opt-outs are stored as 91XXXXXXXXXX
    a1 := pg_temp.mk_user('zz-c1-a1@example.invalid', '9000000311', true);          -- 10 digits
    a2 := pg_temp.mk_user('zz-c1-a2@example.invalid  ', '+91 90000 00312', false);  -- +91 with spaces, e-mail with trailing spaces
    a3 := pg_temp.mk_user('ZZ-C1-A3@Example.INVALID', '919000000313', true);        -- 91 + 10 digits, upper-case e-mail
    update public.profiles set utm_source = 'zz_c1_src' where id in (a1, a2, a3);

    insert into public.comm_lists (name, kind, conditions, owner_id)
    values ('ZZ c1 dynamic', 'dynamic', '{"utm_source":["zz_c1_src"]}'::jsonb, adm) returning id into dyn;
    insert into public.comm_lists (name, kind, conditions, owner_id)
    values ('ZZ c1 static', 'static', '{}'::jsonb, adm) returning id into st;
    insert into public.comm_list_members (list_id, user_id) values (st, a1), (st, a2), (st, a3);
    ids := jsonb_build_array(jsonb_build_object('p', '9000000311'), jsonb_build_object('p', '9000000312'),
                             jsonb_build_object('p', '9000000313'));

    select format('%s/%s/%s', (select count(*) from public.profiles), (select count(*) from public.comm_lists),
                  (select count(*) from public.comms_optouts)) into before_counts;

    -- ════ A. no opt-outs for these people: every count as before ════
    -- (none of the test contacts is in comms_optouts yet, so the old and new rules give the same numbers)
    c := pg_temp.c4(adm, dyn, st, ids);
    t_name := t_name || text 'A no opt-outs: preview / dynamic / static / import all 3/3/3/2'; t_det := t_det || c::text;
    t_pass := t_pass || (c = array['3/3/3/2', '3/3/3/2', '3/3/3/2', '3/3/3/2']);

    -- ════ B. two WhatsApp opt-outs → with_phone 1, e-mail unchanged ════
    insert into public.comms_optouts (phone, channel, reason) values ('919000000311', 'whatsapp', 'ZZ c1 test'), ('919000000312', 'whatsapp', 'ZZ c1 test');
    c := pg_temp.c4(adm, dyn, st, ids);
    t_name := t_name || text 'B 2 WhatsApp opt-outs: total 3, with_phone 1, with_email 3, consented 2 (all 4 places)'; t_det := t_det || c::text;
    t_pass := t_pass || (c = array['3/1/3/2', '3/1/3/2', '3/1/3/2', '3/1/3/2']);
    delete from public.comms_optouts where reason = 'ZZ c1 test';

    -- ════ C. e-mail-only opt-out lowers with_email only (e-mail case differs from the profile) ════
    insert into public.comms_optouts (email, channel, reason) values ('zz-c1-a3@example.invalid', 'email', 'ZZ c1 test');
    c := pg_temp.c4(adm, dyn, st, ids);
    t_name := t_name || text 'C e-mail opt-out (lower-case vs upper-case profile): with_email 2, with_phone 3'; t_det := t_det || c::text;
    t_pass := t_pass || (c = array['3/3/2/2', '3/3/2/2', '3/3/2/2', '3/3/2/2']);
    delete from public.comms_optouts where reason = 'ZZ c1 test';

    -- e-mail with trailing spaces in the profile still matches
    insert into public.comms_optouts (email, channel, reason) values ('ZZ-C1-A2@example.invalid', 'email', 'ZZ c1 test');
    c := pg_temp.c4(adm, dyn, st, ids);
    t_name := t_name || text 'C profile e-mail with spaces + different case matches the opt-out'; t_det := t_det || c::text;
    t_pass := t_pass || (c = array['3/3/2/2', '3/3/2/2', '3/3/2/2', '3/3/2/2']);
    delete from public.comms_optouts where reason = 'ZZ c1 test';

    -- ════ D. channel 'all' lowers both ════
    insert into public.comms_optouts (email, phone, channel, reason) values ('zz-c1-a1@example.invalid', '919000000311', 'all', 'ZZ c1 test');
    c := pg_temp.c4(adm, dyn, st, ids);
    t_name := t_name || text 'D channel all (phone + e-mail): with_phone 2 and with_email 2'; t_det := t_det || c::text;
    t_pass := t_pass || (c = array['3/2/2/2', '3/2/2/2', '3/2/2/2', '3/2/2/2']);
    delete from public.comms_optouts where reason = 'ZZ c1 test';

    -- 'all' with only a phone lowers with_phone only (is_opted_out(email, null, 'email') cannot match it)
    insert into public.comms_optouts (phone, channel, reason) values ('919000000313', 'all', 'ZZ c1 test');
    c := pg_temp.c4(adm, dyn, st, ids);
    t_name := t_name || text 'D channel all with phone only: with_phone 2, with_email 3'; t_det := t_det || c::text;
    t_pass := t_pass || (c = array['3/2/3/2', '3/2/3/2', '3/2/3/2', '3/2/3/2']);
    delete from public.comms_optouts where reason = 'ZZ c1 test';

    -- a WhatsApp opt-out never lowers e-mail, an e-mail opt-out never lowers phone (same person, cross channel)
    insert into public.comms_optouts (email, phone, channel, reason) values ('zz-c1-a1@example.invalid', '919000000311', 'whatsapp', 'ZZ c1 test');
    c := pg_temp.c4(adm, dyn, st, ids);
    t_name := t_name || text 'D whatsapp row holding an e-mail too: with_email unchanged 3'; t_det := t_det || c::text;
    t_pass := t_pass || (c = array['3/2/3/2', '3/2/3/2', '3/2/3/2', '3/2/3/2']);
    delete from public.comms_optouts where reason = 'ZZ c1 test';

    -- ════ E. every profile phone shape matches an opt-out stored as 91XXXXXXXXXX ════
    foreach s in array array['919000000311|10 digits', '919000000312|+91 with spaces', '919000000313|91 + 10 digits'] loop
      insert into public.comms_optouts (phone, channel, reason) values (split_part(s, '|', 1), 'whatsapp', 'ZZ c1 test');
      c := pg_temp.c4(adm, dyn, st, ids);
      t_name := t_name || ('E phone shape matches: ' || split_part(s, '|', 2)); t_det := t_det || c::text;
      t_pass := t_pass || (c = array['3/2/3/2', '3/2/3/2', '3/2/3/2', '3/2/3/2']);
      delete from public.comms_optouts where reason = 'ZZ c1 test';
    end loop;

    -- ════ F. an opt-out for someone who is not in profiles changes nothing ════
    insert into public.comms_optouts (email, phone, channel, reason) values
      ('zz-c1-nobody@example.invalid', '919000000399', 'all', 'ZZ c1 test'),
      ('zz-c1-nobody2@example.invalid', null, 'email', 'ZZ c1 test'),
      (null, '919000000398', 'whatsapp', 'ZZ c1 test');
    c := pg_temp.c4(adm, dyn, st, ids);
    t_name := t_name || text 'F opt-outs for contacts not in profiles: counts unchanged 3/3/3/2'; t_det := t_det || c::text;
    t_pass := t_pass || (c = array['3/3/3/2', '3/3/3/2', '3/3/3/2', '3/3/3/2']);
    delete from public.comms_optouts where reason = 'ZZ c1 test';

    -- ════ G. whole database: preview of everyone = set-based count that follows is_opted_out ════
    insert into public.comms_optouts (phone, channel, reason) values ('919000000311', 'whatsapp', 'ZZ c1 test');
    insert into public.comms_optouts (email, channel, reason) values ('zz-c1-a3@example.invalid', 'all', 'ZZ c1 test');
    select count(*) filter (where public.comm__phone91(p.phone) is not null
                              and not exists (select 1 from public.comms_optouts o where o.channel in ('whatsapp', 'all')
                                                 and o.phone = public.comm__phone91(p.phone))),
           count(*) filter (where nullif(btrim(p.email), '') is not null
                              and not exists (select 1 from public.comms_optouts o where o.channel in ('email', 'all')
                                                 and lower(o.email) = lower(nullif(btrim(p.email), ''))))
      into exp_ph, exp_em from public.profiles p;
    r := pg_temp.call_as(adm, 'select public.comm_audience_preview(''{}''::jsonb)');
    t_name := t_name || text 'G preview of everyone = independent set-based count (phone, e-mail)';
    t_det := t_det || format('preview %s/%s expected %s/%s', r->>'with_phone', r->>'with_email', exp_ph, exp_em);
    t_pass := t_pass || ((r->>'with_phone')::bigint = exp_ph and (r->>'with_email')::bigint = exp_em);
    t_name := t_name || text 'G total and consented of everyone are plain profile counts (unchanged rule)';
    t_det := t_det || format('total %s consented %s', r->>'total', r->>'consented');
    t_pass := t_pass || ((r->>'total')::bigint = (select count(*) from public.profiles)
                         and (r->>'consented')::bigint = (select count(*) from public.profiles where coalesce(consent_given, false)));
    -- answer shape unchanged; sample masked (no full e-mail, no full phone)
    t_name := t_name || text 'G answer keys unchanged and sample is masked';
    t_det := t_det || (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k);
    t_pass := t_pass || ((select array_agg(k order by k) from jsonb_object_keys(r) k) = array['consented', 'sample', 'total', 'with_email', 'with_phone']
                         and (r->'sample')::text !~ '[^*@ ]+@[^*]+\.[a-z]{2,}' and (r->'sample')::text !~ '[0-9]{10}');
    delete from public.comms_optouts where reason = 'ZZ c1 test';

    -- ════ H. who may call (break-it) ════
    foreach s in array array[
      format('select public.comm_audience_preview(%L::jsonb)', '{}'),
      format('select public.comm_list_count(%L::uuid)', st),
      format('select public.comm_list_import(null, %L::jsonb, true)', ids)] loop
      f := substring(s from 'public\.(comm_[a-z_]+)');
      r := pg_temp.call_as(null, s, true);
      t_name := t_name || ('H anon refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(null, s);
      t_name := t_name || ('H logged in without user id refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(usr, s);
      t_name := t_name || ('H non-admin refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    end loop;

    -- ════ I. definition: grants, definer, search_path, volatility ════
    for sc in select p.oid::regprocedure::text as sig, p.proacl::text as acl, p.prosecdef, p.proconfig, p.provolatile
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname in ('comm_audience_preview', 'comm_list_count', 'comm_list_import') loop
      t_name := t_name || ('I ACL / definer / search_path / volatility: ' || sc.sig);
      t_det := t_det || format('%s %s %s %s', sc.acl, sc.prosecdef, sc.proconfig, sc.provolatile);
      t_pass := t_pass || (sc.acl = acl_expected and sc.prosecdef and sc.proconfig = array['search_path=""']
                           and sc.provolatile = case when sc.sig like 'comm_list_import%' then 'v' else 's' end);
    end loop;
    t_name := t_name || text 'I anon cannot execute any of the 3 functions; authenticated can';
    t_det := t_det || text '';
    t_pass := t_pass || (not has_function_privilege('anon', 'public.comm_audience_preview(jsonb)', 'execute')
                         and not has_function_privilege('anon', 'public.comm_list_count(uuid)', 'execute')
                         and not has_function_privilege('anon', 'public.comm_list_import(text,jsonb,boolean)', 'execute')
                         and has_function_privilege('authenticated', 'public.comm_audience_preview(jsonb)', 'execute')
                         and has_function_privilege('authenticated', 'public.comm_list_count(uuid)', 'execute')
                         and has_function_privilege('authenticated', 'public.comm_list_import(text,jsonb,boolean)', 'execute'));
    t_name := t_name || text 'I the 3 functions use the existing is_opted_out (no second opt-out rule)';
    t_det := t_det || text '';
    t_pass := t_pass || (select bool_and(pg_get_functiondef(p.oid) like '%public.is_opted_out(%' and pg_get_functiondef(p.oid) not like '%comms_optouts%')
                           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname in ('comm_audience_preview', 'comm_list_count', 'comm_list_import'));

    -- ════ J. nothing else touched ════
    select format('%s/%s/%s', (select count(*) from public.profiles), (select count(*) from public.comm_lists),
                  (select count(*) from public.comms_optouts)) into after_counts;
    t_name := t_name || text 'J profiles / comm_lists / comms_optouts row counts back to start inside the test';
    t_det := t_det || (before_counts || ' -> ' || after_counts);
    t_pass := t_pass || (before_counts = after_counts);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_comm_c1_tests();
