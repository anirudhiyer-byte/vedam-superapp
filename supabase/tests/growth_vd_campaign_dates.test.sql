-- Growth · VSAT date change vs Vedantu rows · tests for migration 0138 (STAGING ONLY)
--
-- How to run: apply 0138 on staging, then paste this whole file into the staging SQL editor (or the Supabase MCP) in ONE call.
-- The last statement returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (ZZTEST names, zzb1* UTMs, ZZB1 campaigns in 2095). Refuses to run unless app_flags.environment = 'staging'.

create or replace function pg_temp.g38_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

create or replace function pg_temp.g38_call(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb; d text;
begin
  if p_anon then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm, 'detail', d);
end $$;

create or replace function pg_temp.g38_rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.g38_camp(p_id uuid, p_name text, p_s text, p_e text, p_extra jsonb default '{}'::jsonb)
returns text language sql as $$
  select pg_temp.g38_rpc('growth_campaign_save',
    jsonb_strip_nulls(jsonb_build_object('id', p_id, 'name', p_name, 'campaign_start', p_s, 'campaign_end', p_e)) || p_extra)
$$;

create or replace function pg_temp.g38_row(p_ch text, p_utm text, p_date text)
returns text language sql as $$
  select pg_temp.g38_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', p_ch, 'utm_link', p_utm, 'live_date', p_date)))
$$;

create or replace function pg_temp.run_growth_vd_campaign_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; usr uuid; r jsonb; t0 timestamptz; ms int; n int; s text; n2 boolean;
  o1 uuid; o2 uuid; p1 uuid; p2 uuid; q1 uuid; r1 uuid; r2 uuid; x1 uuid; ra uuid; rb uuid; rx uuid; ry uuid; re uuid; rf uuid; rg uuid; rh uuid;
  u1 text := 'https://y.invalid/zzb1?utm_source=zzb1a&utm_medium=yt&utm_campaign=zz';
  u2 text := 'https://y.invalid/zzb1?utm_source=zzb1b&utm_medium=yt&utm_campaign=zz';
  u3 text := 'https://y.invalid/zzb1?utm_source=zzb1c&utm_medium=yt&utm_campaign=zz';
  u4 text := 'https://y.invalid/zzb1?utm_source=zzb1d&utm_medium=yt&utm_campaign=zz';
  u5 text := 'https://y.invalid/zzb1?utm_source=zzb1e&utm_medium=yt&utm_campaign=zz';
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    adm := pg_temp.g38_user('zztest-b1-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.g38_user('zztest-b1-user@example.invalid');

    -- ════ A. security (unchanged by 0138) ════
    r := pg_temp.g38_call(null, pg_temp.g38_camp(null, 'ZZB1 Anon', '2095-01-01', '2095-01-31'), true);
    tn := tn || text 'A anon cannot call growth_campaign_save'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.g38_call(usr, pg_temp.g38_camp(null, 'ZZB1 User', '2095-01-01', '2095-01-31'));
    tn := tn || text 'A a signed-in non-admin gets FORBIDDEN'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    tn := tn || text 'A anon has no EXECUTE on growth_campaign_save';
    td := td || has_function_privilege('anon', 'public.growth_campaign_save(jsonb)', 'execute')::text;
    tp := tp || not has_function_privilege('anon', 'public.growth_campaign_save(jsonb)', 'execute');
    tn := tn || text 'A authenticated keeps EXECUTE on growth_campaign_save';
    td := td || has_function_privilege('authenticated', 'public.growth_campaign_save(jsonb)', 'execute')::text;
    tp := tp || has_function_privilege('authenticated', 'public.growth_campaign_save(jsonb)', 'execute');
    tn := tn || text 'A the function is SECURITY DEFINER with an empty search_path';
    select (p.prosecdef and p.proconfig @> array['search_path=""']) into n2 from pg_proc p where p.oid = 'public.growth_campaign_save(jsonb)'::regprocedure;
    td := td || n2::text; tp := tp || n2;

    -- ════ B. everything 0120 did still works ════
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(null, 'ZZB1 One', '2095-01-01', '2095-01-31', '{"exam_date":"2095-02-01"}'));
    o1 := (r->>'id')::uuid;
    tn := tn || text 'B add a campaign (with an exam date)'; td := td || r::text; tp := tp || (o1 is not null);
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(null, 'ZZB1 Two', '2095-03-01', '2095-03-31'));
    o2 := (r->>'id')::uuid;
    tn := tn || text 'B add a campaign (no exam date, 0120)'; td := td || r::text; tp := tp || (o2 is not null);
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(null, 'zzb1 one', '2095-05-01', '2095-05-31'));
    tn := tn || text 'B the same name again is DUPLICATE'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE');
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(null, 'ZZB1 Bad', '2095-05-31', '2095-05-01'));
    tn := tn || text 'B end before start is BAD_VALUE'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: campaign_end');
    r := pg_temp.g38_call(adm, pg_temp.g38_rpc('growth_campaign_save', '{"name":"ZZB1 Bad","campaign_start":"2095-05-01"}'));
    tn := tn || text 'B a missing end date is REQUIRED'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: campaign_end');
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(null, 'ZZB1 Bad', '2095-05-01', '2095-05-31', '{"evil":"x"}'));
    tn := tn || text 'B an unknown key is refused'; td := td || r::text; tp := tp || (r->>'sqlstate' = '22023' and r->>'message' like 'UNKNOWN_KEY%');
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(gen_random_uuid(), 'ZZB1 Ghost', '2095-05-01', '2095-05-31'));
    tn := tn || text 'B editing a campaign that does not exist is NOT_FOUND'; td := td || r::text; tp := tp || (r->>'message' = 'NOT_FOUND');
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(o1, 'ZZB1 One', '2095-01-01', '2095-01-31', '{"budget":1000}'));
    tn := tn || text 'B an edit with the same dates works'; td := td || r::text; tp := tp || (r->>'id' = o1::text);
    tn := tn || text 'B an edit without exam_date keeps the stored one (0120)';
    s := (select exam_date::text from public.vsat_campaigns where id = o1); td := td || s; tp := tp || (s = '2095-02-01');

    -- ════ C. the bug: a date change that puts two rows with one UTM into one VSAT ════
    r := pg_temp.g38_call(adm, pg_temp.g38_row('ZZTEST B1 A', u1, '2095-01-10')); ra := (r->>'id')::uuid;
    tn := tn || text 'C row A (VSAT One) is saved'; td := td || r::text; tp := tp || (ra is not null);
    r := pg_temp.g38_call(adm, pg_temp.g38_row('ZZTEST B1 B', u1, '2095-03-10')); rb := (r->>'id')::uuid;
    tn := tn || text 'C row B, same UTM in another VSAT (Two), is allowed'; td := td || r::text; tp := tp || (rb is not null);
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(o2, 'ZZB1 Two', '2095-01-05', '2095-03-31'));
    tn := tn || text 'C moving Two to start before row A (both rows would be in one VSAT) is refused: VD_UTM_CONFLICT';
    td := td || r::text; tp := tp || (r->>'sqlstate' = '22023' and r->>'message' = 'VD_UTM_CONFLICT');
    tn := tn || text 'C the refusal names the Channel of a row in its detail'; td := td || coalesce(r->>'detail', '(none)');
    tp := tp || (r->>'detail' like 'ZZTEST B1 %');
    s := (select campaign_start::text from public.vsat_campaigns where id = o2);
    tn := tn || text 'C nothing was written: Two still starts on 2095-03-01'; td := td || s; tp := tp || (s = '2095-03-01');
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(o2, 'ZZB1 Two', '2095-03-05', '2095-03-31'));
    tn := tn || text 'C a date change that keeps the rows in separate VSATs works'; td := td || r::text; tp := tp || (r->>'id' = o2::text);
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(o1, 'ZZB1 One', '2095-01-01', '2095-03-31'));
    tn := tn || text 'C One reaching over row B is fine while Two (later start) still holds B (latest start wins, same as the Listing)';
    td := td || r::text; tp := tp || (r->>'id' = o1::text);
    s := (select count(*)::text from public.vsat_campaigns where id = o1 and campaign_end = '2095-03-31');
    tn := tn || text 'C ... and that save was written'; td := td || s; tp := tp || (s = '1');
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(o1, 'ZZB1 One', '2095-01-01', '2095-01-31'));
    tn := tn || text 'C One back to January works'; td := td || r::text; tp := tp || (r->>'id' = o1::text);
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(null, 'ZZB1 Free', '2095-02-01', '2095-02-20'));
    tn := tn || text 'C a new campaign that holds no clashing rows works'; td := td || r::text; tp := tp || (r->>'id' is not null);
    r := pg_temp.g38_call(adm, pg_temp.g38_row('ZZTEST B1 C', u1, '2095-03-20'));
    tn := tn || text 'C the normal one-UTM-per-VSAT rule at row save is unchanged (DUPLICATE_UTM)'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE_UTM');

    -- ════ D. an older clash never blocks an unrelated edit ════
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(null, 'ZZB1 P1', '2095-06-01', '2095-06-30')); p1 := (r->>'id')::uuid;
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(null, 'ZZB1 P2', '2095-07-01', '2095-07-31')); p2 := (r->>'id')::uuid;
    r := pg_temp.g38_call(adm, pg_temp.g38_row('ZZTEST B1 X', u2, '2095-06-10')); rx := (r->>'id')::uuid;
    r := pg_temp.g38_call(adm, pg_temp.g38_row('ZZTEST B1 Y', u2, '2095-07-10')); ry := (r->>'id')::uuid;
    tn := tn || text 'D rows X and Y (same UTM, two VSATs) are saved'; td := td || (coalesce(rx::text, 'null') || ' ' || coalesce(ry::text, 'null'));
    tp := tp || (rx is not null and ry is not null);
    update public.vsat_campaigns set campaign_start = '2095-06-05' where id = p2;   -- an older clash, made behind the function's back
    tn := tn || text 'D (set-up) X and Y now share one VSAT'; td := td || public.growth__vd_campaign(date '2095-06-10')::text;
    tp := tp || (public.growth__vd_campaign(date '2095-06-10') = p2 and public.growth__vd_campaign(date '2095-07-10') = p2);
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(p1, 'ZZB1 P1', '2095-06-01', '2095-06-30', '{"budget":5000}'));
    tn := tn || text 'D editing an unrelated field of a campaign is not blocked by the old clash'; td := td || r::text; tp := tp || (r->>'id' = p1::text);
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(o1, 'ZZB1 One', '2095-01-01', '2095-01-30'));
    tn := tn || text 'D changing the dates of another campaign (no row moves) is not blocked by the old clash'; td := td || r::text; tp := tp || (r->>'id' = o1::text);
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(p2, 'ZZB1 P2', '2095-06-06', '2095-07-31'));
    tn := tn || text 'D changing the dates of the clashing campaign when no row changes VSAT is not blocked'; td := td || r::text; tp := tp || (r->>'id' = p2::text);

    -- ════ E. a VSAT that shrinks pushes a row out of every VSAT ════
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(null, 'ZZB1 Q1', '2095-09-01', '2095-09-30')); q1 := (r->>'id')::uuid;
    r := pg_temp.g38_call(adm, pg_temp.g38_row('ZZTEST B1 E', u3, '2095-09-10')); re := (r->>'id')::uuid;
    r := pg_temp.g38_call(adm, pg_temp.g38_row('ZZTEST B1 F', u3, '2095-11-10')); rf := (r->>'id')::uuid;
    tn := tn || text 'E rows E (in Q1) and F (in no VSAT), same UTM, are saved'; td := td || (coalesce(re::text, 'null') || ' ' || coalesce(rf::text, 'null'));
    tp := tp || (re is not null and rf is not null);
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(q1, 'ZZB1 Q1', '2095-09-01', '2095-09-05'));
    tn := tn || text 'E shrinking Q1 would put E next to F in "no VSAT" with the same UTM: refused'; td := td || r::text;
    tp := tp || (r->>'message' = 'VD_UTM_CONFLICT');
    r := pg_temp.g38_call(adm, pg_temp.g38_rpc('growth_vd_trash', jsonb_build_object('ids', jsonb_build_array(rf), 'trash', true)));
    tn := tn || text 'E (set-up) row F is moved to the trash'; td := td || r::text; tp := tp || (r->>'changed' = '1');
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(q1, 'ZZB1 Q1', '2095-09-01', '2095-09-05'));
    tn := tn || text 'E a trashed row does not block the date change'; td := td || r::text; tp := tp || (r->>'id' = q1::text);
    r := pg_temp.g38_call(adm, pg_temp.g38_rpc('growth_vd_trash', jsonb_build_object('ids', jsonb_build_array(rf), 'trash', false)));
    tn := tn || text 'E ... and restoring F is then refused by the restore check (DUPLICATE_UTM), as in 0136'; td := td || r::text;
    tp := tp || (r->>'message' = 'DUPLICATE_UTM');

    -- ════ F. different UTMs never clash ════
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(null, 'ZZB1 R1', '2095-12-01', '2095-12-10')); r1 := (r->>'id')::uuid;
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(null, 'ZZB1 R2', '2095-12-20', '2095-12-31')); r2 := (r->>'id')::uuid;
    r := pg_temp.g38_call(adm, pg_temp.g38_row('ZZTEST B1 G', u4, '2095-12-05')); rg := (r->>'id')::uuid;
    r := pg_temp.g38_call(adm, pg_temp.g38_row('ZZTEST B1 H', u5, '2095-12-25')); rh := (r->>'id')::uuid;
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(r2, 'ZZB1 R2', '2095-12-03', '2095-12-31'));
    tn := tn || text 'F two rows with different UTMs may end up in one VSAT'; td := td || r::text; tp := tp || (r->>'id' = r2::text);

    -- ════ G. speed with many rows ════
    insert into public.growth_vd_rows (channel, utm_link, live_date, cpa, video_spend)
      select 'ZZTEST load ' || g, 'https://y.invalid/zzload?utm_source=zzb1load' || g || '&utm_medium=yt&utm_campaign=zz', date '2095-02-25', 40, 1500
        from generate_series(1, 2000) g;
    t0 := clock_timestamp();
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(o1, 'ZZB1 One', '2095-01-01', '2095-01-29'));
    ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
    tn := tn || text 'G a date change with 2000+ Vedantu rows in the table takes under 1 second'; td := td || (ms || ' ms, ' || left(r::text, 60));
    tp := tp || (ms < 1000 and r->>'id' = o1::text);
    t0 := clock_timestamp();
    r := pg_temp.g38_call(adm, pg_temp.g38_camp(o1, 'ZZB1 One', '2095-01-01', '2095-01-29', '{"budget":2000}'));
    ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
    tn := tn || text 'G a save without date change (no check) is as fast as before'; td := td || (ms || ' ms'); tp := tp || (ms < 500 and r->>'id' = o1::text);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.run_growth_vd_campaign_tests();
