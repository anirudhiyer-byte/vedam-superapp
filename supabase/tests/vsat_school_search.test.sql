-- VSAT school search · tests for migration 0148 (STAGING ONLY)
--
-- Paste into the staging SQL editor (or run via the Supabase MCP) in ONE call. The last statement
-- returns one row per test: test | pass | detail. Seeds synthetic UDISE-like rows (ZZSCH codes),
-- asserts, and rolls everything back (ZDONE). Refuses to run unless app_flags.environment = 'staging'.
--
-- Covers: abbreviation expansion (DPS/KV/DAV), both DAV spellings (D.A.V. and DAV), multi-token
-- place narrowing, full-name search, an ordinary word, a no-match place, and the auth gate.

create or replace function pg_temp.ssu(p_email text)
returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
    values (u, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  return u;
end $$;

-- run the search as an authenticated user, return the array of result 'code's
create or replace function pg_temp.sscodes(p_uid uuid, p_q text)
returns text[] language plpgsql as $$
declare r jsonb; c text[];
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role','authenticated')::text, true); set local role authenticated;
  select public.vsat_school_search(jsonb_build_object('q', p_q)) into r;
  reset role; perform set_config('request.jwt.claims','',true);
  select coalesce(array_agg(x->>'code'), '{}') into c from jsonb_array_elements(coalesce(r->'schools','[]'::jsonb)) x;
  return c;
end $$;

create or replace function pg_temp.run_vsat_school_search_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}'; u uuid; c text[]; rr jsonb;
begin
  begin
    if coalesce((select value from public.app_flags where key='environment'),'') <> 'staging' then raise exception 'not staging'; end if;
    u := pg_temp.ssu('zzsch-u@example.invalid');

    insert into public.school_database (schcd, schname, dtname, stname) values
      ('ZZSCH01','DELHI PUBLIC SCHOOL R K PURAM','SOUTH WEST DELHI','DELHI'),
      ('ZZSCH02','D.A.V. PUBLIC SCHOOL SECTOR 14','GURUGRAM','HARYANA'),
      ('ZZSCH03','DAV PUBLIC SCHOOL','GURUGRAM','HARYANA'),
      ('ZZSCH04','KENDRIYA VIDYALAYA NO 1','PUNE','MAHARASHTRA'),
      ('ZZSCH05','ST XAVIERS HIGH SCHOOL','MUMBAI','MAHARASHTRA'),
      ('ZZSCH06','DELHI PUBLIC SCHOOL','PUNE','MAHARASHTRA'),
      ('ZZSCH07','DAV PUBLIC SCHOOL','PUNE','MAHARASHTRA');

    c := pg_temp.sscodes(u,'dps');
    tn := tn||text 'DPS expands to Delhi Public School'; td := td||array_to_string(c,','); tp := tp||('ZZSCH01'=any(c) and 'ZZSCH06'=any(c));

    c := pg_temp.sscodes(u,'kv');
    tn := tn||text 'KV expands to Kendriya Vidyalaya'; td := td||array_to_string(c,','); tp := tp||('ZZSCH04'=any(c));

    c := pg_temp.sscodes(u,'dav');
    tn := tn||text 'DAV finds both D.A.V. and DAV spellings'; td := td||array_to_string(c,','); tp := tp||('ZZSCH02'=any(c) and 'ZZSCH03'=any(c) and 'ZZSCH07'=any(c));

    c := pg_temp.sscodes(u,'dps delhi');
    tn := tn||text '"DPS Delhi" returns the Delhi DPS'; td := td||array_to_string(c,','); tp := tp||('ZZSCH01'=any(c));

    c := pg_temp.sscodes(u,'dav haryana');
    tn := tn||text '"DAV Haryana" narrows to the Haryana DAVs (excludes the Pune DAV)'; td := td||array_to_string(c,','); tp := tp||('ZZSCH02'=any(c) and 'ZZSCH03'=any(c) and not('ZZSCH07'=any(c)));

    c := pg_temp.sscodes(u,'dav pune');
    tn := tn||text '"DAV Pune" narrows to the Pune DAV (excludes the Haryana DAVs)'; td := td||array_to_string(c,','); tp := tp||('ZZSCH07'=any(c) and not('ZZSCH02'=any(c)));

    c := pg_temp.sscodes(u,'kendriya vidyalaya');
    tn := tn||text 'the full name still works'; td := td||array_to_string(c,','); tp := tp||('ZZSCH04'=any(c));

    c := pg_temp.sscodes(u,'xavier');
    tn := tn||text 'an ordinary word still works'; td := td||array_to_string(c,','); tp := tp||('ZZSCH05'=any(c));

    c := pg_temp.sscodes(u,'dps mumbai');
    tn := tn||text '"DPS Mumbai" (none exist) returns no Delhi Public School'; td := td||array_to_string(c,','); tp := tp||(not('ZZSCH01'=any(c)) and not('ZZSCH06'=any(c)));

    -- auth gate: an unauthenticated caller is refused
    perform set_config('request.jwt.claims','{"role":"anon"}',true); set local role anon;
    begin select public.vsat_school_search(jsonb_build_object('q','dps')) into rr; exception when others then rr := jsonb_build_object('sqlstate',sqlstate); end;
    reset role; perform set_config('request.jwt.claims','',true);
    tn := tn||text 'anon is blocked (unauthenticated / no table access)'; td := td||coalesce(rr::text,'null'); tp := tp||(rr->>'code'='UNAUTHENTICATED' or rr->>'sqlstate'='42501');

    raise exception using errcode='ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select test, pass, detail from pg_temp.run_vsat_school_search_tests();
