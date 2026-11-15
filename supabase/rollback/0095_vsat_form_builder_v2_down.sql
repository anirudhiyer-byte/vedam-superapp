-- Rollback for 0095_vsat_form_builder_v2.sql
-- Restores the pre-0095 definitions of vsat_form_upsert, vsat_form_save_category
-- and the vsat_application_answers view (no checkbox/radio types, no subcategories).
-- Note: forms saved with subcategories or checkbox/radio questions will fail the
-- restored upsert validation on their next save — roll back only if no live form
-- uses the new features.

create or replace function public.vsat_form_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  k text; v_id uuid; v_name text; v_schema jsonb; v_cat jsonb; v_q jsonb; v_who text;
begin
  if not public.vsat_is_staff() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 100000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('id','name','schema') then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  end loop;
  if jsonb_typeof(p->'name') is distinct from 'string' then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  v_name := btrim(p->>'name');
  if char_length(v_name) between 1 and 120 is not true then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  v_schema := p->'schema';
  if jsonb_typeof(v_schema) is distinct from 'object' or jsonb_typeof(v_schema->'categories') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SCHEMA');
  end if;
  for v_cat in select * from jsonb_array_elements(v_schema->'categories') loop
    if jsonb_typeof(v_cat->'key') is distinct from 'string' or jsonb_typeof(v_cat->'title') is distinct from 'string'
       or jsonb_typeof(v_cat->'questions') is distinct from 'array' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SCHEMA');
    end if;
    for v_q in select * from jsonb_array_elements(v_cat->'questions') loop
      if jsonb_typeof(v_q->'key') is distinct from 'string' or jsonb_typeof(v_q->'label') is distinct from 'string'
         or coalesce(v_q->>'type','') not in ('text','textarea','number','date','dropdown','file','school','state','city') then
        return jsonb_build_object('ok', false, 'code', 'INVALID_SCHEMA');
      end if;
    end loop;
  end loop;
  select coalesce(nullif(u.raw_user_meta_data->>'full_name',''), u.email) into v_who
    from auth.users u where u.id = auth.uid();
  if p ? 'id' and jsonb_typeof(p->'id') = 'string' then
    if lower(p->>'id') !~ c_uuid then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
    v_id := (p->>'id')::uuid;
    update public.vsat_forms set name = v_name, schema = v_schema, version = version + 1, updated_at = now()
     where id = v_id and status <> 'archived';
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  else
    insert into public.vsat_forms (name, schema, created_by) values (v_name, v_schema, v_who) returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

create or replace function public.vsat_form_save_category(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  u uuid := auth.uid();
  f public.vsat_forms;
  v_cat_key text; v_answers jsonb; v_exc jsonb; v_cat jsonb; v_q jsonb;
  v_missing text[] := '{}'; v_qkey text; v_val jsonb; v_exc_key text;
  v_app public.application_manager;
  v_completed jsonb; v_total int; v_done int; v_submitted boolean := false;
  v_stage public.vm_form_stage; v_meta jsonb; k text;
begin
  if u is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 200000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('formId','category','answers','exceptions') then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  end loop;
  if lower(coalesce(p->>'formId','')) !~ c_uuid or jsonb_typeof(p->'category') <> 'string'
     or jsonb_typeof(p->'answers') <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  v_cat_key := p->>'category';
  v_answers := p->'answers';
  v_exc := case when jsonb_typeof(p->'exceptions') = 'array' then p->'exceptions' else '[]'::jsonb end;
  select * into v_app from public.application_manager where lead_id = u limit 1;
  if v_app.application_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_AN_APPLICANT'); end if;
  if not exists (select 1 from public.vsat_payments vp where vp.lead_id = u) then
    return jsonb_build_object('ok', false, 'code', 'NOT_PAID');
  end if;
  select * into f from public.vsat_forms where status = 'active' limit 1;
  if f.id is null then return jsonb_build_object('ok', false, 'code', 'NO_ACTIVE_FORM'); end if;
  if f.id <> (p->>'formId')::uuid then return jsonb_build_object('ok', false, 'code', 'FORM_CHANGED'); end if;
  select c into v_cat from jsonb_array_elements(f.schema->'categories') c where c->>'key' = v_cat_key;
  if v_cat is null then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CATEGORY'); end if;
  for v_q in select * from jsonb_array_elements(v_cat->'questions') loop
    if coalesce((v_q->>'required')::boolean, false) then
      v_qkey := v_q->>'key';
      v_exc_key := v_q->'exception'->>'key';
      if v_exc_key is not null and v_exc ? v_exc_key then
        continue;
      end if;
      v_val := v_answers->v_qkey;
      if v_val is null or jsonb_typeof(v_val) = 'null'
         or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '') then
        v_missing := array_append(v_missing, v_qkey);
      end if;
    end if;
  end loop;
  if array_length(v_missing, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'MISSING_REQUIRED', 'fields', to_jsonb(v_missing));
  end if;
  v_meta := coalesce(v_app.form_data->'_meta', jsonb_build_object('completed', '[]'::jsonb, 'submitted', false));
  v_completed := coalesce(v_meta->'completed', '[]'::jsonb);
  if not (v_completed ? v_cat_key) then v_completed := v_completed || to_jsonb(v_cat_key); end if;
  v_total := jsonb_array_length(coalesce(f.schema->'categories', '[]'::jsonb));
  v_done  := jsonb_array_length(v_completed);
  v_submitted := v_done >= v_total;
  v_meta := jsonb_build_object('completed', v_completed, 'submitted', v_submitted, 'formId', f.id);
  v_stage := case
    when v_submitted then 'form_submitted'::public.vm_form_stage
    when v_cat_key in ('basic_details','academic_details','parent_details','documents_uploaded')
      then v_cat_key::public.vm_form_stage
    else 'form_initiated'::public.vm_form_stage end;
  update public.application_manager am set
    form_data = (coalesce(am.form_data, '{}'::jsonb) || jsonb_build_object(v_cat_key, v_answers)) || jsonb_build_object('_meta', v_meta),
    active_form_id = f.id,
    form_name = f.name,
    form_stage_1 = v_stage,
    form_status = case when v_submitted then 'completed' else 'in_progress' end,
    form_completion_percentage = case when v_total > 0 then round(v_done * 100.0 / v_total) else 0 end,
    form_start_date = coalesce(am.form_start_date, now()),
    last_updated_date = now()
  where am.lead_id = u;
  insert into public.crm_activity_log (entity_type, application_id, lead_id, action, stage_type, to_value, metadata, actor, path)
  values ('application', v_app.application_id, u, 'stage_change', 'form',
          v_stage::text, jsonb_build_object('category', v_cat_key, 'submitted', v_submitted, 'form_id', f.id),
          'applicant', '/vsat/dashboard');
  return jsonb_build_object('ok', true, 'submitted', v_submitted,
    'progress', v_meta, 'percentage', case when v_total > 0 then round(v_done * 100.0 / v_total) else 0 end);
end $fn$;

create or replace view public.vsat_application_answers as
  select am.application_id, am.lead_id, am.form_name, am.form_stage_1, am.form_status,
         am.form_completion_percentage, am.active_form_id,
         cat->>'key'   as category,
         cat->>'title' as category_title,
         q->>'key'     as question,
         q->>'label'   as question_label,
         am.form_data #>> array[cat->>'key', q->>'key'] as answer
  from public.application_manager am
  left join public.vsat_forms f on f.id = am.active_form_id
  left join lateral jsonb_array_elements(coalesce(f.schema->'categories','[]'::jsonb)) as cat on true
  left join lateral jsonb_array_elements(cat->'questions') as q on true
  where am.active_form_id is not null;

alter view public.vsat_application_answers set (security_invoker = on);
revoke all on public.vsat_application_answers from public, anon, authenticated;
grant select on public.vsat_application_answers to service_role;
