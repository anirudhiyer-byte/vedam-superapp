-- VSAT Form mid-stage autosave · migration 0100 (STAGING ONLY)
--
-- Verifies vsat_form_autosave_category persists a PARTIAL stage (required fields
-- missing) without marking the category completed or the form submitted, and that
-- the function is private to `authenticated`. Runs inside a ZDONE-rolled-back block;
-- the live active form and applicant data are untouched.

create or replace function pg_temp.mk_user(p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated','authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZ') on conflict (id) do nothing;
  return v;
end $$;
create or replace function pg_temp.call_as(p_uid uuid, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true);
  set local role authenticated; execute p_sql into r; reset role;
  perform set_config('request.jwt.claims','',true); return coalesce(r,'null'::jsonb);
exception when others then reset role; perform set_config('request.jwt.claims','',true);
  return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm); end $$;
create or replace function pg_temp.run() returns table(test text, pass boolean, detail text) language plpgsql as $$
declare appu uuid; fid uuid; r jsonb; fd jsonb; sch jsonb;
  n text[]:='{}'; pz boolean[]:='{}'; d text[]:='{}';
begin
  begin
    appu := pg_temp.mk_user('zztest-autosave@example.invalid');
    sch := jsonb_build_object('categories', jsonb_build_array(
      jsonb_build_object('key','basic','title','Basic','questions', jsonb_build_array(
        jsonb_build_object('key','name','label','Name','type','text','required',true),
        jsonb_build_object('key','city','label','City','type','text','required',true)))));
    update public.vsat_forms set status='draft' where status='active';
    insert into public.vsat_forms(name,schema,status,created_by) values('ZZ autosave',sch,'active','zz') returning id into fid;
    insert into public.lead_manager(lead_id,registered_name,registered_email,lead_stage)
      values(appu,'ZZ','zztest-autosave@example.invalid','applicant_paid');
    insert into public.application_manager(application_id,lead_id,application_no,registered_name,registered_email,registered_mobile,campus_applied,class10_year,class12_year,marks_physics_12,marks_chemistry_12,marks_maths_12,vps_score)
      values('ZZ-AS-1',appu,'ZZ-AS-1','ZZ','zztest-autosave@example.invalid','9000000000','No preference',2024,2026,60,60,60,8.0);
    insert into public.vsat_payments(lead_id,paid_at,payment_ref,provider,currency,amount) values(appu,now(),'ZZ','backfill','INR',10);

    r := pg_temp.call_as(appu, format('select public.vsat_form_autosave_category(%L::jsonb)',
      jsonb_build_object('formId',fid,'category','basic','answers',jsonb_build_object('name','Partial Pawan'))::text));
    select form_data into fd from public.application_manager where lead_id=appu;

    n:=array_append(n,'A ok+saved on partial'); pz:=array_append(pz,(r->>'ok')::boolean and (r->>'saved')::boolean); d:=array_append(d,r::text);
    n:=array_append(n,'B partial name persisted'); pz:=array_append(pz,fd->'basic'->>'name'='Partial Pawan'); d:=array_append(d,(fd->'basic')::text);
    n:=array_append(n,'C NOT submitted'); pz:=array_append(pz,coalesce((fd->'_meta'->>'submitted')::boolean,false)=false); d:=array_append(d,coalesce(fd->'_meta','null'::jsonb)::text);
    n:=array_append(n,'D NOT completed'); pz:=array_append(pz,not coalesce(fd->'_meta'->'completed' ? 'basic',false)); d:=array_append(d,'');
    n:=array_append(n,'E private(auth only)'); pz:=array_append(pz,has_function_privilege('authenticated','public.vsat_form_autosave_category(jsonb)','execute') and not has_function_privilege('anon','public.vsat_form_autosave_category(jsonb)','execute')); d:=array_append(d,'');

    raise exception using errcode='ZDONE';
  exception when sqlstate 'ZDONE' then null; end;
  return query select x.a,x.b,x.c from unnest(n,pz,d) as x(a,b,c);
end $$;
select test, coalesce(pass,false) as pass, detail from pg_temp.run();
