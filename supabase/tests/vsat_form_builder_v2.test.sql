-- VSAT Form builder v2 · migration 0095 (STAGING ONLY)
--
-- How to run: paste into the staging SQL editor, or run through the Supabase MCP.
-- Covers: upsert accepts checkbox/radio + subcategories + pass-through question
-- fields; rejects unknown types and malformed subcategories; save_category treats
-- an empty-array answer as missing, enforces required questions inside a
-- subcategory, and stores array answers; the admin flatten view surfaces
-- subcategory questions and renders array answers (checkbox joined, files by name).
--
-- Everything runs inside a block rolled back with a private error code — the live
-- active form and all data are untouched. Fake data only (@example.invalid).

create or replace function pg_temp.mk_user(p_email text, p_admin boolean default false)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email;
  if p_admin then insert into public.user_roles (user_id, role) values (v, 'admin'); end if;
  return v;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql into r; reset role; perform set_config('request.jwt.claims', '', true); return coalesce(r, 'null'::jsonb);
exception when others then reset role; perform set_config('request.jwt.claims', '', true); return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.up(p jsonb) returns text language sql as $$ select format('select public.vsat_form_upsert(%L::jsonb)', p::text) $$;
create or replace function pg_temp.sv(p jsonb) returns text language sql as $$ select format('select public.vsat_form_save_category(%L::jsonb)', p::text) $$;

create or replace function pg_temp.run_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; appu uuid; r jsonb; fid uuid; good jsonb; s text;
begin
  begin
    adm  := pg_temp.mk_user('zztest-fb2-adm@example.invalid', true);
    appu := pg_temp.mk_user('zztest-fb2-app@example.invalid');

    -- a valid v2 schema: one category with a direct file question + a subcategory holding checkbox/radio/file
    good := jsonb_build_object('name','ZZTEST FB2 form','schema', jsonb_build_object('categories', jsonb_build_array(
      jsonb_build_object('key','docs','title','Documents','questions', jsonb_build_array(
        jsonb_build_object('key','photo','label','Your photo','type','file','required',true,'accept',jsonb_build_array('image/*'),'maxSizeMb',5,'multiple',false,'help','Upload a clear photo')
      ),'subcategories', jsonb_build_array(
        jsonb_build_object('key','marks','title','Marksheets','questions', jsonb_build_array(
          jsonb_build_object('key','tenth','label','10th marksheet','type','file','required',true,'multiple',true,'accept',jsonb_build_array('application/pdf')),
          jsonb_build_object('key','interests','label','Interests','type','checkbox','required',true,'options',jsonb_build_array('Coding','Music','Sports')),
          jsonb_build_object('key','gender','label','Gender','type','radio','required',true,'options',jsonb_build_array('Male','Female','Other'))
        ))
      ))
    )));

    -- ── A. upsert accepts the v2 schema (staff) ──
    r := pg_temp.call_as(adm, pg_temp.up(good));
    t_name := t_name || text 'A upsert accepts checkbox/radio + subcategory + file extras';
    t_det := t_det || left(r::text,200); t_pass := t_pass || ((r->>'ok')::boolean and (r ? 'id'));
    fid := (r->>'id')::uuid;

    -- ── B. upsert rejects an unknown type ──
    r := pg_temp.call_as(adm, pg_temp.up(jsonb_build_object('name','ZZX','schema', jsonb_build_object('categories', jsonb_build_array(
      jsonb_build_object('key','c','title','C','questions', jsonb_build_array(jsonb_build_object('key','q','label','Q','type','rating'))))))));
    t_name := t_name || text 'B upsert rejects unknown question type'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'code' = 'INVALID_SCHEMA');

    -- ── C. upsert rejects a malformed subcategory (no title) ──
    r := pg_temp.call_as(adm, pg_temp.up(jsonb_build_object('name','ZZX','schema', jsonb_build_object('categories', jsonb_build_array(
      jsonb_build_object('key','c','title','C','questions','[]'::jsonb,'subcategories', jsonb_build_array(
        jsonb_build_object('key','s','questions','[]'::jsonb))))))));
    t_name := t_name || text 'C upsert rejects subcategory missing title'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'code' = 'INVALID_SCHEMA');

    -- make the test form the active one (reverted on ZDONE)
    update public.vsat_forms set status = 'draft' where status = 'active';
    update public.vsat_forms set status = 'active' where id = fid;

    -- paid applicant fixtures
    insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage)
    values (appu, 'ZZTEST app', 'zztest-fb2-app@example.invalid', 'applicant_paid');
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, registered_mobile,
      campus_applied, class10_year, class12_year, marks_physics_12, marks_chemistry_12, marks_maths_12, vps_score)
    values ('ZZT-FB2-1', appu, 'ZZT-FB2-1', 'ZZTEST app', 'zztest-fb2-app@example.invalid', '9000000000',
            'No preference', 2024, 2026, 60, 60, 60, 8.0);
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, currency, amount)
    values (appu, now(), 'ZZTEST-ref', 'backfill', 'INR', 10);

    -- ── D. save_category: nothing filled → all 4 required missing (incl. subcategory ones) ──
    r := pg_temp.call_as(appu, pg_temp.sv(jsonb_build_object('formId', fid, 'category','docs','answers','{}'::jsonb,'exceptions','[]'::jsonb)));
    t_name := t_name || text 'D empty answers → MISSING_REQUIRED for photo+tenth+interests+gender';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'code' = 'MISSING_REQUIRED'
      and r->'fields' @> '["photo","tenth","interests","gender"]'::jsonb
      and jsonb_array_length(r->'fields') = 4);

    -- ── E. empty checkbox array still counts as missing ──
    r := pg_temp.call_as(appu, pg_temp.sv(jsonb_build_object('formId', fid, 'category','docs','answers', jsonb_build_object(
      'photo', jsonb_build_array(jsonb_build_object('path','p/1','name','me.jpg','size',1000)),
      'tenth', jsonb_build_array(jsonb_build_object('path','p/2','name','10th.pdf','size',2000)),
      'interests', '[]'::jsonb,
      'gender', 'Female'))));
    t_name := t_name || text 'E empty checkbox array → still MISSING (interests)';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'code' = 'MISSING_REQUIRED' and r->'fields' = '["interests"]'::jsonb);

    -- ── F. all filled (arrays + radio) → ok, submitted, array answers stored ──
    r := pg_temp.call_as(appu, pg_temp.sv(jsonb_build_object('formId', fid, 'category','docs','answers', jsonb_build_object(
      'photo', jsonb_build_array(jsonb_build_object('path','p/1','name','me.jpg','size',1000)),
      'tenth', jsonb_build_array(jsonb_build_object('path','p/2','name','10th.pdf','size',2000), jsonb_build_object('path','p/3','name','10th-back.pdf','size',2500)),
      'interests', jsonb_build_array('Coding','Music'),
      'gender', 'Female'))));
    t_name := t_name || text 'F all filled → ok + submitted (single category)';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'ok')::boolean and (r->>'submitted')::boolean);

    -- ── G. flatten view: subcategory questions surface; array answers joined (checkbox + file names) ──
    select string_agg(va.question || '=' || coalesce(va.answer,'∅'), ' | ' order by va.question) into s
      from public.vsat_application_answers va where va.application_id = 'ZZT-FB2-1';
    t_name := t_name || text 'G flatten view shows interests (joined), tenth (file names), gender, photo';
    t_det := t_det || s;
    t_pass := t_pass || (s like '%interests=Coding, Music%' and s like '%tenth=10th.pdf, 10th-back.pdf%'
                         and s like '%gender=Female%' and s like '%photo=me.jpg%');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass,false) as pass, detail from pg_temp.run_tests();
