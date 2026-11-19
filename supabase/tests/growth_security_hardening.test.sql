-- Tests for 0111_growth_security_hardening. Paste into the STAGING SQL editor. Everything rolls back (ZDONE).
-- Returns one row per test: test | pass | detail.

create or replace function pg_temp.t_0111() returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  n bigint; m bigint; ok boolean; msg text; rid uuid; adm uuid := gen_random_uuid();
begin
  begin
    -- 1. the view is closed to the browser roles
    begin set local role anon; select count(*) into n from public.growth_cp_cost_view; reset role; ok := false; msg := format('anon read %s rows', n);
    exception when insufficient_privilege then reset role; ok := true; msg := sqlerrm; end;
    tn := tn || text 'VIEW anon cannot read growth_cp_cost_view'; tp := tp || ok; td := td || msg;

    begin set local role authenticated; select count(*) into n from public.growth_cp_cost_view; reset role; ok := false; msg := format('authenticated read %s rows', n);
    exception when insufficient_privilege then reset role; ok := true; msg := sqlerrm; end;
    tn := tn || text 'VIEW signed-in user cannot read growth_cp_cost_view'; tp := tp || ok; td := td || msg;

    begin set local role anon; delete from public.growth_cp_cost_view; reset role; ok := false; msg := 'anon delete ran';
    exception when others then reset role; ok := true; msg := sqlerrm; end;
    tn := tn || text 'VIEW anon cannot write through growth_cp_cost_view'; tp := tp || ok; td := td || msg;

    -- the server (service role) still reads every row, as the predictor cost route does
    select count(*) into m from public.growth_cp_cost_rows;
    set local role service_role; select count(*) into n from public.growth_cp_cost_view; reset role;
    tn := tn || text 'VIEW service role still reads all rows'; tp := tp || (n = m); td := td || format('view=%s table=%s', n, m);

    select coalesce('security_invoker=on' = any (reloptions), false) into ok from pg_class where oid = 'public.growth_cp_cost_view'::regclass;
    tn := tn || text 'VIEW runs with the caller''s rights (security_invoker)'; tp := tp || ok; td := td || ok::text;

    -- 2. audit history on the Ads / Influencers tables, with the acting user
    insert into auth.users (id, email, aud, role, email_confirmed_at) values (adm, 'zztest-0111@example.invalid', 'authenticated', 'authenticated', now());
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    insert into public.growth_ad_rows (ad_name, platform, spend) values ('ZZ audit', 'Meta', 10) returning id into rid;
    update public.growth_ad_rows set spend = 20 where id = rid;
    delete from public.growth_ad_rows where id = rid;
    select count(*) into n from public.audit_log where table_name = 'growth_ad_rows' and record_id = rid::text and actor_id = adm;
    select count(*) into m from public.audit_log where table_name = 'growth_ad_rows' and record_id = rid::text and action = 'UPDATE'
       and (old_data->>'spend')::numeric = 10 and (new_data->>'spend')::numeric = 20;
    tn := tn || text 'AUDIT ad row insert / update / delete logged with who and before/after'; tp := tp || (n = 3 and m = 1); td := td || format('rows=%s update-diff=%s', n, m);

    select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where t.tgname in ('trg_audit_growth_custom_columns', 'trg_audit_growth_ad_rows', 'trg_audit_growth_influencers', 'trg_audit_growth_infl_posts');
    tn := tn || text 'AUDIT trigger on all four 0105 tables'; tp := tp || (n = 4); td := td || format('%s of 4', n);

    raise exception 'ZDONE';
  exception when others then
    if sqlerrm <> 'ZDONE' then tn := tn || text 'HARNESS'; tp := tp || false; td := td || sqlerrm; end if;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.t_0111();
