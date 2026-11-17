-- VSAT Form conditional logic · migration 0099 (STAGING ONLY)
--
-- Covers section branching (routes → next category / __submit__), per-question
-- show/hide (showIf — a hidden required question is not required), branch-to-submit
-- (ggn.next = __submit__ submits after 2 of 3 sections), and the private helpers.
-- Runs inside a ZDONE-rolled-back block; the live active form and data are untouched.

create or replace function pg_temp.mk_user(p_email text, p_admin boolean default false)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email,'@',1))
  on conflict (id) do update set email = excluded.email;
  if p_admin then insert into public.user_roles (user_id, role) values (v, 'admin'); end if;
  return v;
end $$;
create or replace function pg_temp.call_as(p_uid uuid, p_sql text)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role','authenticated')::text, true);
  set local role authenticated;
  execute p_sql into r; reset role; perform set_config('request.jwt.claims','',true); return coalesce(r,'null'::jsonb);
exception when others then reset role; perform set_config('request.jwt.claims','',true); return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm);
end $$;
create or replace function pg_temp.sv(p jsonb) returns text language sql as $$ select format('select public.vsat_form_save_category(%L::jsonb)', p::text) $$;
create or replace function pg_temp.run()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[]:='{}'; t_pass boolean[]:='{}'; t_det text[]:='{}';
  appu uuid; r jsonb; fid uuid; sch jsonb;
begin
  begin
    appu := pg_temp.mk_user('zztest-cond-app@example.invalid');
    sch := jsonb_build_object('categories', jsonb_build_array(
      jsonb_build_object('key','start','title','Start','questions', jsonb_build_array(
        jsonb_build_object('key','campus','label','Campus','type','radio','required',true,'options',jsonb_build_array('Pune','Gurugram'),
          'routes', jsonb_build_array(jsonb_build_object('value','Pune','to','pune'), jsonb_build_object('value','Gurugram','to','ggn'))),
        jsonb_build_object('key','ggn_extra','label','Gurugram extra','type','text','required',true,
          'showIf', jsonb_build_object('q','campus','op','eq','value','Gurugram'))
      )),
      jsonb_build_object('key','pune','title','Pune docs','next','__submit__','questions', jsonb_build_array(
        jsonb_build_object('key','pune_doc','label','Pune doc','type','text','required',true))),
      jsonb_build_object('key','ggn','title','Gurugram docs','next','__submit__','questions', jsonb_build_array(
        jsonb_build_object('key','ggn_doc','label','GGN doc','type','text','required',true)))
    ));
    update public.vsat_forms set status='draft' where status='active';
    insert into public.vsat_forms (name, schema, status, created_by) values ('ZZTEST cond', sch, 'active', 'zz') returning id into fid;
    insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage)
      values (appu, 'ZZTEST', 'zztest-cond-app@example.invalid', 'applicant_paid');
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, registered_mobile,
      campus_applied, class10_year, class12_year, marks_physics_12, marks_chemistry_12, marks_maths_12, vps_score)
      values ('ZZT-COND-1', appu, 'ZZT-COND-1', 'ZZTEST', 'zztest-cond-app@example.invalid', '9000000000', 'No preference', 2024,2026,60,60,60,8.0);
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, currency, amount)
      values (appu, now(), 'ZZ', 'backfill', 'INR', 10);

    r := pg_temp.call_as(appu, pg_temp.sv(jsonb_build_object('formId',fid,'category','start','answers',jsonb_build_object('campus','Pune'),'exceptions','[]'::jsonb)));
    t_name:=t_name||text 'A Pune: hidden ggn_extra not required, next=pune'; t_det:=t_det||r::text;
    t_pass:=t_pass||((r->>'ok')::boolean and r->>'next'='pune' and not (r->>'submitted')::boolean);

    r := pg_temp.call_as(appu, pg_temp.sv(jsonb_build_object('formId',fid,'category','start','answers',jsonb_build_object('campus','Gurugram'),'exceptions','[]'::jsonb)));
    t_name:=t_name||text 'B Gurugram: ggn_extra now required → MISSING'; t_det:=t_det||r::text;
    t_pass:=t_pass||(r->>'code'='MISSING_REQUIRED' and r->'fields'='["ggn_extra"]'::jsonb);

    r := pg_temp.call_as(appu, pg_temp.sv(jsonb_build_object('formId',fid,'category','start','answers',jsonb_build_object('campus','Gurugram','ggn_extra','robotics'),'exceptions','[]'::jsonb)));
    t_name:=t_name||text 'C Gurugram+extra: ok, next=ggn'; t_det:=t_det||r::text;
    t_pass:=t_pass||((r->>'ok')::boolean and r->>'next'='ggn' and not (r->>'submitted')::boolean);

    r := pg_temp.call_as(appu, pg_temp.sv(jsonb_build_object('formId',fid,'category','ggn','answers',jsonb_build_object('ggn_doc','marksheet.pdf'),'exceptions','[]'::jsonb)));
    t_name:=t_name||text 'D ggn → submitted via __submit__, next=null, 100%'; t_det:=t_det||r::text;
    t_pass:=t_pass||((r->>'ok')::boolean and (r->>'submitted')::boolean and (r->'next'='null'::jsonb or r->>'next' is null) and (r->>'percentage')='100');

    t_name:=t_name||text 'E helpers private (no authenticated/anon)';
    t_pass:=t_pass||(not has_function_privilege('authenticated','public.vsat__ans_match(jsonb,text,text)','execute')
                     and not has_function_privilege('anon','public.vsat__q_visible(jsonb,jsonb)','execute'));
    t_det:=t_det||text '';

    raise exception using errcode='ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select x.n,x.p,x.d from unnest(t_name,t_pass,t_det) as x(n,p,d);
end $$;
select test, coalesce(pass,false) as pass, detail from pg_temp.run();
