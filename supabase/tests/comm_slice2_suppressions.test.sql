-- Communication Manager · Slice 2 (Suppressions add / remove) · database tests for migration 0064
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP / psql. The last statement returns one row per test: test | pass | detail.
-- Refuses to run unless app_flags.environment = 'staging'.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
-- error code at the end. Fake data only (@example.invalid e-mails, 90000003xx numbers, ZZ names).

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'not the staging database - refusing to run tests';
  end if;
end $$;

-- ── helpers (session-temporary) ────────────────────────────────────────────────
create or replace function pg_temp.mk_user(p_email text, p_phone text default null)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, phone) values (v, p_email, p_phone)
  on conflict (id) do update set email = excluded.email, phone = excluded.phone;
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

create or replace function pg_temp.add(p_uid uuid, p_channel text, p_contact text, p_category text, p_note text default null)
returns jsonb language sql as $$
  select pg_temp.call_as(p_uid, format('select public.comm_suppression_add(%L, %L, %L, %L)', p_channel, p_contact, p_category, p_note));
$$;

create or replace function pg_temp.rm(p_uid uuid, p_id uuid, p_reason text)
returns jsonb language sql as $$
  select pg_temp.call_as(p_uid, format('select public.comm_suppression_remove(%L::uuid, %L)', p_id, p_reason));
$$;

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_comm_slice2_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm2 uuid; usr uuid; prof uuid;
  r jsonb; s text; f text; n bigint; n2 bigint; ok boolean; id1 uuid; id2 uuid; id_stop uuid; id_link uuid; id_bounce uuid;
  o public.comms_optouts; o2 public.comms_optouts; before_counts text; after_counts text; cat text; bad text[];
  good_reason text := 'ZZ test: added by mistake';
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm  := pg_temp.mk_user('zz-s2-admin@example.invalid');  perform pg_temp.mk_admin(adm);
    adm2 := pg_temp.mk_user('zz-s2-admin2@example.invalid'); perform pg_temp.mk_admin(adm2);
    usr  := pg_temp.mk_user('zz-s2-user@example.invalid');
    prof := pg_temp.mk_user('zz-s2-person@example.invalid', '919000000399');   -- a profile our add should link to

    -- rows written by the EXISTING paths (STOP webhook, unsubscribe link, a bounce) — these must stay locked
    perform public.comms_opt_out(null, '919000000311', 'whatsapp', 'STOP reply');
    perform public.comms_opt_out('zz-s2-link@example.invalid', null, 'email', 'unsubscribe link');
    perform public.comms_opt_out('zz-s2-bounce@example.invalid', null, 'email', 'hard bounce');
    perform public.comms_opt_out('zz-s2-all@example.invalid', '919000000312', 'all', 'manual unsubscribe');
    select id into id_stop from public.comms_optouts where phone = '919000000311' and channel = 'whatsapp';
    select id into id_link from public.comms_optouts where email = 'zz-s2-link@example.invalid';
    select id into id_bounce from public.comms_optouts where email = 'zz-s2-bounce@example.invalid';

    select format('%s/%s/%s', (select count(*) from public.comms_campaigns), (select count(*) from public.whatsapp_sends),
                  (select count(*) from public.email_events)) into before_counts;

    -- ════ A. who may call ════
    foreach s in array array[
      format('select public.comm_suppression_add(%L, %L, %L, null)', 'Email', 'zz-s2-a@example.invalid', 'Block'),
      format('select public.comm_suppression_remove(%L::uuid, %L)', id_link, good_reason)] loop
      f := substring(s from 'public\.(comm_[a-z_]+)');
      r := pg_temp.call_as(null, s, true);
      t_name := t_name || ('A anon refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(null, s);
      t_name := t_name || ('A logged in without user id refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(usr, s);
      t_name := t_name || ('A non-admin refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    end loop;
    select count(*) into n from public.comms_optouts where email = 'zz-s2-a@example.invalid';
    t_name := t_name || text 'A refused callers wrote nothing (no row for the contact, the locked row is still there)';
    t_det := t_det || n::text; t_pass := t_pass || (n = 0 and exists (select 1 from public.comms_optouts where id = id_link));

    -- ════ B. grants, settings, table ════
    for f, ok in
      select p.oid::regprocedure::text,
             p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
               and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname in ('comm_suppression_add', 'comm_suppression_remove')
    loop
      t_name := t_name || ('B definer, search_path '''', authenticated yes, anon no: ' || f); t_det := t_det || ok::text; t_pass := t_pass || ok;
    end loop;
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('comm_suppression_add', 'comm_suppression_remove');
    t_name := t_name || text 'B exactly the 2 new functions exist (no overloads)'; t_det := t_det || n::text; t_pass := t_pass || (n = 2);
    select c.relrowsecurity and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comm_suppression_meta')
           and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
           and not has_table_privilege('authenticated', c.oid, 'insert') and not has_table_privilege('authenticated', c.oid, 'delete')
      into ok from pg_class c where c.oid = 'public.comm_suppression_meta'::regclass;
    t_name := t_name || text 'B comm_suppression_meta: RLS on, no policies, no table access for anon/authenticated'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    select string_agg(column_name, ',' order by ordinal_position) into s from information_schema.columns where table_schema = 'public' and table_name = 'comm_suppression_meta';
    t_name := t_name || text 'B comm_suppression_meta has only the agreed columns (no contact data)'; t_det := t_det || s;
    t_pass := t_pass || (s = 'optout_id,added_by,note,created_at');
    select count(*) into n from pg_constraint where conrelid = 'public.comm_suppression_meta'::regclass and contype = 'f';
    t_name := t_name || text 'B comm_suppression_meta has no foreign key'; t_det := t_det || n::text; t_pass := t_pass || (n = 0);
    select exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                    where t.tgrelid = 'public.comm_suppression_meta'::regclass and p.proname = 'audit_trigger') into ok;
    t_name := t_name || text 'B the existing audit_trigger() is attached to comm_suppression_meta'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    r := pg_temp.call_as(adm, 'select to_jsonb(x) from (select * from public.comm_suppression_meta limit 1) x');
    t_name := t_name || text 'B even an admin cannot read comm_suppression_meta directly'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');

    -- ════ C. add e-mail: cleaned exactly like the existing writer, and the send guard sees it ════
    r := pg_temp.add(adm, 'Email', '  ZZ-S2-Mixed@Example.INVALID  ', 'Block', '  ZZ note  ');
    t_name := t_name || text 'C add e-mail: status added, contact lower-cased and trimmed'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'status' = 'added' and r->>'contact' = 'zz-s2-mixed@example.invalid' and r->>'category' = 'Block');
    id1 := (r->>'id')::uuid;
    select * into o from public.comms_optouts where id = id1;
    t_name := t_name || text 'C stored row: email lower+trim, phone null, channel email, reason maps to Block';
    t_det := t_det || to_jsonb(o)::text;
    t_pass := t_pass || (o.email = 'zz-s2-mixed@example.invalid' and o.phone is null and o.channel = 'email' and o.reason = 'Block (added in admin panel)');
    t_name := t_name || text 'C is_opted_out() (the send guard) is true for the contact in any letter case, email + all-channel lookups';
    t_det := t_det || format('%s/%s/%s', public.is_opted_out('zz-s2-mixed@example.invalid', null, 'email'),
                              public.is_opted_out('ZZ-S2-MIXED@example.invalid', null, 'email'), public.is_opted_out('zz-s2-mixed@example.invalid', null, 'whatsapp'));
    t_pass := t_pass || (public.is_opted_out('zz-s2-mixed@example.invalid', null, 'email')
                         and public.is_opted_out('ZZ-S2-MIXED@example.invalid', null, 'email')
                         and not public.is_opted_out('zz-s2-mixed@example.invalid', null, 'whatsapp'));
    -- same input through the OLD writer gives the same row (compare after removing ours)
    delete from public.comms_optouts where id = id1;
    perform public.comms_opt_out('zz-s2-mixed@example.invalid', null, 'email', 'Block (added in admin panel)');
    select * into o2 from public.comms_optouts where email = 'zz-s2-mixed@example.invalid' and channel = 'email';
    t_name := t_name || text 'C normalisation equals the old comms_opt_out(): same email / phone / channel / user_id / reason';
    t_det := t_det || to_jsonb(o2)::text;
    t_pass := t_pass || (o2.email is not distinct from o.email and o2.phone is not distinct from o.phone and o2.channel = o.channel
                         and o2.user_id is not distinct from o.user_id and o2.reason = o.reason);
    delete from public.comms_optouts where id = o2.id;
    insert into public.comms_optouts (id, user_id, email, phone, channel, reason, opted_out_at)   -- put ours back for the tests below
    values (o.id, o.user_id, o.email, o.phone, o.channel, o.reason, o.opted_out_at);

    r := pg_temp.add(adm, 'Email', 'zz-s2-person@example.invalid', 'Unsubscribe');
    select * into o from public.comms_optouts where id = (r->>'id')::uuid;
    t_name := t_name || text 'C user_id is linked to the matching profile, like the old writer does'; t_det := t_det || coalesce(o.user_id::text, 'null');
    t_pass := t_pass || (o.user_id = prof);

    -- ════ D. add WhatsApp: every common way of typing the number → 91XXXXXXXXXX ════
    r := pg_temp.add(adm, 'WhatsApp', '+91 90000 00301', 'Unsubscribe');
    t_name := t_name || text 'D add "+91 90000 00301" → 919000000301, status added'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'status' = 'added' and r->>'contact' = '919000000301');
    id2 := (r->>'id')::uuid;
    select * into o from public.comms_optouts where id = id2;
    t_name := t_name || text 'D stored row: phone 919000000301, email null, channel whatsapp'; t_det := t_det || to_jsonb(o)::text;
    t_pass := t_pass || (o.phone = '919000000301' and o.email is null and o.channel = 'whatsapp');
    t_name := t_name || text 'D is_opted_out() is true for 919000000301 on WhatsApp, false on email'; t_det := t_det || public.is_opted_out(null, '919000000301', 'whatsapp')::text;
    t_pass := t_pass || (public.is_opted_out(null, '919000000301', 'whatsapp') and not public.is_opted_out(null, '919000000301', 'email'));
    foreach s in array array['09000000301', '9000000301', '919000000301', '+91 (900) 000-0301'] loop
      r := pg_temp.add(adm, 'WhatsApp', s, 'Unsubscribe');
      t_name := t_name || ('D same number typed as "' || s || '" → already, no second row'); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'status' = 'already' and r->>'id' = id2::text and r->>'contact' = '919000000301');
    end loop;
    select count(*) into n from public.comms_optouts where phone = '919000000301';
    t_name := t_name || text 'D still exactly one row for that number'; t_det := t_det || n::text; t_pass := t_pass || (n = 1);

    -- ════ E. duplicates and existing rows ════
    select count(*) into n from public.comm_suppression_meta;
    select count(*) into n2 from public.audit_log where action = 'comm_suppression_add';
    r := pg_temp.add(adm, 'Email', 'zz-s2-mixed@example.invalid', 'Spam');
    t_name := t_name || text 'E add the same e-mail again (other category) → already, same id'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'status' = 'already' and r->>'id' = id1::text);
    r := pg_temp.add(adm, 'WhatsApp', '9000000311', 'Unsubscribe');
    t_name := t_name || text 'E add a number that already sent STOP → already (points at the STOP row)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'status' = 'already' and r->>'id' = id_stop::text);
    r := pg_temp.add(adm, 'Email', 'ZZ-S2-ALL@example.invalid', 'Block');
    t_name := t_name || text 'E add an e-mail covered by an all-channel row → already'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'status' = 'already');
    r := pg_temp.add(adm, 'WhatsApp', '919000000312', 'Unsubscribe');
    t_name := t_name || text 'E add a number covered by an all-channel row → already'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'status' = 'already');
    t_name := t_name || text 'E duplicates wrote no metadata and no audit row';
    t_det := t_det || format('meta %s→%s, audit %s→%s', n, (select count(*) from public.comm_suppression_meta), n2,
                              (select count(*) from public.audit_log where action = 'comm_suppression_add'));
    t_pass := t_pass || ((select count(*) from public.comm_suppression_meta) = n
                         and (select count(*) from public.audit_log where action = 'comm_suppression_add') = n2);

    -- ════ F. round trip: the chosen category shows under the same tab (0060 list + counts unchanged) ════
    foreach cat in array array['Unsubscribe', 'Bounce', 'Block', 'Spam', 'Invalid'] loop
      r := pg_temp.add(adm, 'Email', 'zz-s2-rt-' || lower(cat) || '@example.invalid', cat);
      r := pg_temp.call_as(adm, format('select public.comm_suppressions_list(%L, %L, null, null, %L, null, null, 1, 10)', 'Email', cat, 'zz-s2-rt-'));
      t_name := t_name || ('F e-mail ' || cat || ': listed under the ' || cat || ' tab, and only there');
      t_det := t_det || r::text;
      t_pass := t_pass || ((r->>'total')::int = 1 and r#>>'{rows,0,contact}' = 'zz-s2-rt-' || lower(cat) || '@example.invalid' and r#>>'{rows,0,reason}' = cat);
    end loop;
    r := pg_temp.call_as(adm, 'select public.comm_suppressions_counts(''Email'', null, null, ''zz-s2-rt-'')');
    t_name := t_name || text 'F e-mail tab counts: one in each of the 5 tabs'; t_det := t_det || r::text;
    t_pass := t_pass || (r = '{"Unsubscribe":1,"Bounce":1,"Block":1,"Spam":1,"Invalid":1}'::jsonb);
    r := pg_temp.call_as(adm, 'select public.comm_suppressions_list(''WhatsApp'', ''Unsubscribe'', null, null, ''9000000301'', null, null, 1, 10)');
    t_name := t_name || text 'F WhatsApp add shows under Opt-Out (Unsubscribe) with its keyword'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'total')::int = 1 and r#>>'{rows,0,contact}' = '919000000301' and r#>>'{rows,0,source}' = 'Opt-out (added in admin panel)');
    r := pg_temp.call_as(adm, 'select public.comm_suppressions_counts(''Email'', null, null, ''zz-s2-'')');
    t_name := t_name || text 'F existing rows keep their old tabs (unsubscribe link → Unsubscribe, hard bounce → Bounce, manual all → Block)'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'Bounce')::int = 2 and (r->>'Block')::int = 3 and (r->>'Unsubscribe')::int = 3);

    -- ════ G. invalid input → 22023, nothing written ════
    select count(*) into n from public.comms_optouts;
    bad := array[
      'Email|zz-no-at.example.invalid|Block|', 'Email|zz two@example.invalid|Block|', 'Email|zz@two@example.invalid|Block|',
      'Email|zz-a@example.invalid,zz-b@example.invalid|Block|', 'Email|zz-a@example|Block|', 'Email|' || repeat('a', 250) || '@x.in|Block|',
      'Email||Block|', 'Email|   |Block|',
      'WhatsApp|12345|Unsubscribe|', 'WhatsApp|+1 202 555 0100|Unsubscribe|', 'WhatsApp|98abc76543|Unsubscribe|',
      'WhatsApp|9000000301900000030|Unsubscribe|', 'WhatsApp|5000000301|Unsubscribe|',
      'all|zz-c@example.invalid|Block|', 'SMS|zz-c@example.invalid|Block|', 'email|zz-c@example.invalid|Block|',
      'WhatsApp|9000000302|Spam|', 'WhatsApp|9000000302|Block|', 'Email|zz-c@example.invalid|Other|', 'Email|zz-c@example.invalid|block|',
      'Email|zz-c@example.invalid|Block|' || repeat('n', 201)];
    foreach s in array bad loop
      r := pg_temp.add(adm, nullif(split_part(s, '|', 1), ''), nullif(split_part(s, '|', 2), ''), nullif(split_part(s, '|', 3), ''), nullif(split_part(s, '|', 4), ''));
      t_name := t_name || ('G add refuses: ' || left(replace(s, '|', ' / '), 70)); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    r := pg_temp.add(adm, 'Email', 'zz-c@example.invalid', 'Block', 'line one' || chr(10) || 'line two');
    t_name := t_name || text 'G add refuses a note with control characters'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.add(adm, 'Email', 'zz-c' || chr(9) || '@example.invalid', 'Block');
    t_name := t_name || text 'G add refuses a contact with control characters'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.add(adm, 'Email', 'zz-c@example.invalid', 'Block', repeat('n', 200));
    t_name := t_name || text 'G a 200-character note is accepted'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->>'status' = 'added');
    select count(*) into n2 from public.comms_optouts;
    t_name := t_name || text 'G refused adds wrote nothing (only the accepted 200-char-note row was added)'; t_det := t_det || format('%s→%s', n, n2);
    t_pass := t_pass || (n2 = n + 1);

    -- ════ H. remove ════
    foreach s in array array['', 'too short', '         x', repeat('r', 201), 'ZZ reason with' || chr(10) || 'newline'] loop
      r := pg_temp.rm(adm, id1, s);
      t_name := t_name || ('H remove refuses reason "' || left(replace(s, chr(10), '\n'), 20) || '" (len ' || length(s) || ')'); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    r := pg_temp.rm(adm, id1, null);
    t_name := t_name || text 'H remove refuses a missing reason'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.call_as(adm, format('select public.comm_suppression_remove(null, %L)', good_reason));
    t_name := t_name || text 'H remove refuses a missing id'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    t_name := t_name || text 'H the row is still there after the refused removes'; t_det := t_det || text 'row exists';
    t_pass := t_pass || exists (select 1 from public.comms_optouts where id = id1);

    foreach s in array array[id_stop::text, id_link::text, id_bounce::text] loop
      r := pg_temp.rm(adm, s::uuid, good_reason);
      t_name := t_name || ('H locked: a row from ' || case s when id_stop::text then 'a STOP reply' when id_link::text then 'an unsubscribe link' else 'a bounce' end
                           || ' cannot be removed (55000), row kept'); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '55000' and exists (select 1 from public.comms_optouts where id = s::uuid));
    end loop;
    r := pg_temp.rm(usr, id1, good_reason);
    t_name := t_name || text 'H non-admin cannot remove even with the id and a reason; row kept'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501' and exists (select 1 from public.comms_optouts where id = id1));
    r := pg_temp.rm(adm, gen_random_uuid(), good_reason);
    t_name := t_name || text 'H unknown id → P0002'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = 'P0002');

    r := pg_temp.rm(adm, id1, '  ' || good_reason || '  ');
    t_name := t_name || text 'H owner removes a manual row with a reason → removed'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'removed' = 'true');
    t_name := t_name || text 'H after remove: row gone, metadata gone, is_opted_out() false again';
    t_det := t_det || public.is_opted_out('zz-s2-mixed@example.invalid', null, 'email')::text;
    t_pass := t_pass || (not exists (select 1 from public.comms_optouts where id = id1)
                         and not exists (select 1 from public.comm_suppression_meta where optout_id = id1)
                         and not public.is_opted_out('zz-s2-mixed@example.invalid', null, 'email'));
    r := pg_temp.rm(adm, id1, good_reason);
    t_name := t_name || text 'H remove twice → P0002'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = 'P0002');
    r := pg_temp.rm(adm2, id2, 'ZZ removed by the second admin');
    t_name := t_name || text 'H another admin may remove a manual row, with a reason'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'removed' = 'true' and not public.is_opted_out(null, '919000000301', 'whatsapp'));
    r := pg_temp.add(adm, 'WhatsApp', '9000000301', 'Unsubscribe');
    t_name := t_name || text 'H after remove the same number can be added again'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'status' = 'added');

    -- ════ I. audit ════
    select count(*) into n from public.audit_log
     where action = 'comm_suppression_add' and actor_id = adm and record_id = id2::text and new_data->>'channel' = 'WhatsApp';
    t_name := t_name || text 'I add writes an audit row: who (actor), what (channel, category), when'; t_det := t_det || n::text; t_pass := t_pass || (n = 1);
    select count(*) into n from public.audit_log
     where action = 'comm_suppression_remove' and actor_id = adm and record_id = id1::text
       and new_data->>'remove_reason' = good_reason and (new_data->>'removed_by_adder')::boolean and old_data->>'reason' = 'Block (added in admin panel)';
    t_name := t_name || text 'I remove writes an audit row with the trimmed reason and who added it'; t_det := t_det || n::text; t_pass := t_pass || (n = 1);
    select count(*) into n from public.audit_log
     where action = 'comm_suppression_remove' and actor_id = adm2 and record_id = id2::text and not (new_data->>'removed_by_adder')::boolean;
    t_name := t_name || text 'I removing another admin''s row is recorded as such'; t_det := t_det || n::text; t_pass := t_pass || (n = 1);
    select count(*) into n from public.audit_log where table_name = 'comms_optouts' and action = 'DELETE' and record_id = id1::text and actor_id = adm;
    t_name := t_name || text 'I the existing comms_optouts audit trigger also logged the delete, with the admin as actor'; t_det := t_det || n::text; t_pass := t_pass || (n = 1);
    select count(*) into n from public.audit_log where table_name = 'comm_suppression_meta' and actor_id = adm and action in ('INSERT', 'DELETE');
    t_name := t_name || text 'I the metadata table is audited too (insert + delete rows)'; t_det := t_det || n::text; t_pass := t_pass || (n >= 2);
    select count(*) into n from public.audit_log where action = 'comm_suppression_add' and new_data::text ~ '@|[0-9]{10}';
    t_name := t_name || text 'I our own audit rows hold no contact (no e-mail, no phone number)'; t_det := t_det || n::text; t_pass := t_pass || (n = 0);

    -- ════ J. nothing else touched ════
    select format('%s/%s/%s', (select count(*) from public.comms_campaigns), (select count(*) from public.whatsapp_sends),
                  (select count(*) from public.email_events)) into after_counts;
    t_name := t_name || text 'J campaigns / whatsapp_sends / email_events row counts unchanged'; t_det := t_det || (before_counts || ' -> ' || after_counts);
    t_pass := t_pass || (before_counts = after_counts);
    select count(*) into n from public.comms_optouts x
     where (x.email like 'zz-s2-%' or x.email like 'zz-c%' or x.phone like '9190000003%') and x.channel = 'all';
    t_name := t_name || text 'J add never writes an all-channel row'; t_det := t_det || n::text; t_pass := t_pass || (n = 1);  -- the one made by comms_opt_out above

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_comm_slice2_tests();
