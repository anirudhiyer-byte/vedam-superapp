-- 0039 · VSAT Form builder + adaptive answers (1 Nov 2026)
--
-- Admin defines a form as DATA (categories -> questions, each with a type,
-- mandatory flag and optional "exception" that lets a student skip it). Exactly
-- one form is active at a time; whoever has paid the VSAT fee fills THAT form.
-- Answers are stored adaptively in application_manager.form_data (jsonb) keyed by
-- category + question key — no runtime DDL. Admins read a flattened view.
--
-- Security (CLAUDE.md): RLS on, no table policies; browsers never touch the
-- tables directly. All access is through these SECURITY DEFINER rpcs, which
-- carry their own auth.uid()/is_admin() checks, run with set search_path to '',
-- and are granted EXECUTE to authenticated only.
--
-- Rollback: supabase/rollback/0039_vsat_form_builder_down.sql

-- ── schema ────────────────────────────────────────────────────────────────
create table if not exists public.vsat_forms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  version     int  not null default 1,
  status      text not null default 'draft' check (status in ('draft','active','archived')),
  schema      jsonb not null default '{"categories":[]}'::jsonb check (jsonb_typeof(schema) = 'object'),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- at most one active form at a time
create unique index if not exists vsat_forms_one_active on public.vsat_forms (status) where status = 'active';

alter table public.vsat_forms enable row level security;
revoke all on table public.vsat_forms from public, anon, authenticated;
grant select, insert, update on table public.vsat_forms to service_role;

-- adaptive answer store + which form the applicant is filling
alter table public.application_manager add column if not exists form_data jsonb not null default '{}'::jsonb;
alter table public.application_manager add column if not exists active_form_id uuid;

-- ── admin: create / update a (draft) form ──────────────────────────────────
create or replace function public.vsat_form_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  k text; v_id uuid; v_name text; v_schema jsonb; v_cat jsonb; v_q jsonb; v_who text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
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
  -- shallow shape check: every category has a key + title + questions[]; every question has key + label + type
  for v_cat in select * from jsonb_array_elements(v_schema->'categories') loop
    -- `is distinct from` so an ABSENT key (jsonb_typeof -> NULL) is rejected, not skipped
    if jsonb_typeof(v_cat->'key') is distinct from 'string' or jsonb_typeof(v_cat->'title') is distinct from 'string'
       or jsonb_typeof(v_cat->'questions') is distinct from 'array' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SCHEMA');
    end if;
    for v_q in select * from jsonb_array_elements(v_cat->'questions') loop
      if jsonb_typeof(v_q->'key') is distinct from 'string' or jsonb_typeof(v_q->'label') is distinct from 'string'
         or coalesce(v_q->>'type','') not in ('text','textarea','number','date','dropdown','file') then
        return jsonb_build_object('ok', false, 'code', 'INVALID_SCHEMA');
      end if;
    end loop;
  end loop;

  select coalesce(nullif(u.raw_user_meta_data->>'full_name',''), u.email) into v_who
    from auth.users u where u.id = auth.uid();

  if p ? 'id' and jsonb_typeof(p->'id') = 'string' then
    if lower(p->>'id') !~ c_uuid then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
    v_id := (p->>'id')::uuid;
    update public.vsat_forms
       set name = v_name, schema = v_schema, version = version + 1, updated_at = now()
     where id = v_id and status <> 'archived';
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  else
    insert into public.vsat_forms (name, schema, created_by) values (v_name, v_schema, v_who) returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- ── admin: set a form's status (activating one deactivates the rest) ────────
create or replace function public.vsat_form_set_status(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_id uuid; v_status text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p is null or jsonb_typeof(p) <> 'object' or lower(coalesce(p->>'id','')) !~ c_uuid
     or (p->>'status') not in ('draft','active','archived') then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  v_id := (p->>'id')::uuid; v_status := p->>'status';
  -- serialize activation so two admins can't both activate (one-active index would also stop it)
  perform pg_advisory_xact_lock(hashtext('vsat_form_active'));
  if v_status = 'active' then
    update public.vsat_forms set status = 'draft', updated_at = now() where status = 'active' and id <> v_id;
  end if;
  update public.vsat_forms set status = v_status, updated_at = now() where id = v_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status);
end $fn$;

-- ── admin: list all forms (lightweight) ─────────────────────────────────────
create or replace function public.vsat_forms_admin_list()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'name', f.name, 'status', f.status, 'version', f.version,
           'categories', jsonb_array_length(coalesce(f.schema->'categories','[]'::jsonb)),
           'updatedAt', f.updated_at) order by f.updated_at desc), '[]'::jsonb)
    into v from public.vsat_forms f;
  return jsonb_build_object('ok', true, 'forms', v);
end $fn$;

-- ── admin: full form (schema) for the builder ──────────────────────────────
create or replace function public.vsat_form_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare f public.vsat_forms;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into f from public.vsat_forms where id = p_id;
  if f.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'form', jsonb_build_object(
    'id', f.id, 'name', f.name, 'status', f.status, 'version', f.version, 'schema', f.schema));
end $fn$;

-- ── student: the active form to fill + my answers so far ────────────────────
-- Gate: must be a paid applicant (vsat_payments row) OR an admin (preview).
create or replace function public.vsat_form_active_for_fill()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare u uuid := auth.uid(); f public.vsat_forms; v_data jsonb; v_paid boolean;
begin
  if u is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  v_paid := exists (select 1 from public.vsat_payments vp where vp.lead_id = u);
  if not v_paid and not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'NOT_PAID'); end if;

  select * into f from public.vsat_forms where status = 'active' limit 1;
  if f.id is null then return jsonb_build_object('ok', true, 'form', null, 'code', 'NO_ACTIVE_FORM'); end if;

  select coalesce(am.form_data, '{}'::jsonb) into v_data
    from public.application_manager am where am.lead_id = u limit 1;
  v_data := coalesce(v_data, '{}'::jsonb);

  return jsonb_build_object('ok', true,
    'form', jsonb_build_object('id', f.id, 'name', f.name, 'schema', f.schema),
    'answers', v_data - '_meta',
    'progress', coalesce(v_data->'_meta', jsonb_build_object('completed', '[]'::jsonb, 'submitted', false)));
end $fn$;

-- ── student: save one category (save-and-next) ─────────────────────────────
-- p = { formId, category, answers:{key:value}, exceptions:[questionKey,…] }
-- Validates mandatory questions (an exception clears "required"), merges answers
-- into application_manager.form_data, advances form_stage/percentage, and on the
-- last category marks the form submitted. auth.uid() only.
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

  -- must be a paid applicant
  select * into v_app from public.application_manager where lead_id = u limit 1;
  if v_app.application_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_AN_APPLICANT'); end if;
  if not exists (select 1 from public.vsat_payments vp where vp.lead_id = u) then
    return jsonb_build_object('ok', false, 'code', 'NOT_PAID');
  end if;

  -- the active form must match the one the client is filling (guards against a stale form)
  select * into f from public.vsat_forms where status = 'active' limit 1;
  if f.id is null then return jsonb_build_object('ok', false, 'code', 'NO_ACTIVE_FORM'); end if;
  if f.id <> (p->>'formId')::uuid then return jsonb_build_object('ok', false, 'code', 'FORM_CHANGED'); end if;

  -- locate the category in the schema
  select c into v_cat from jsonb_array_elements(f.schema->'categories') c where c->>'key' = v_cat_key;
  if v_cat is null then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CATEGORY'); end if;

  -- validate required questions (an exception key clears required for that question)
  for v_q in select * from jsonb_array_elements(v_cat->'questions') loop
    if coalesce((v_q->>'required')::boolean, false) then
      v_qkey := v_q->>'key';
      v_exc_key := v_q->'exception'->>'key';
      if v_exc_key is not null and v_exc ? v_exc_key then
        continue;  -- student invoked this question's exception (e.g. "12th results not out")
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

  -- merge answers for this category + record progress in _meta
  v_meta := coalesce(v_app.form_data->'_meta', jsonb_build_object('completed', '[]'::jsonb, 'submitted', false));
  v_completed := coalesce(v_meta->'completed', '[]'::jsonb);
  if not (v_completed ? v_cat_key) then v_completed := v_completed || to_jsonb(v_cat_key); end if;

  v_total := jsonb_array_length(coalesce(f.schema->'categories', '[]'::jsonb));
  v_done  := jsonb_array_length(v_completed);
  v_submitted := v_done >= v_total;

  v_meta := jsonb_build_object('completed', v_completed, 'submitted', v_submitted, 'formId', f.id);

  -- form_stage: use the enum value when the category key is one of the canonical
  -- stages, else keep it at form_initiated; the last category => form_submitted.
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

-- ── admin flatten view: answers as columns for admin reads ──────────────────
-- Keeps the "form fields show up as columns" behaviour at the read layer
-- (no physical DDL). One row per applicant; each (category.question) is a key.
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

-- ── grants: rpcs callable by logged-in users; checks live inside ────────────
revoke all on function public.vsat_form_upsert(jsonb)          from public, anon, authenticated, service_role;
revoke all on function public.vsat_form_set_status(jsonb)      from public, anon, authenticated, service_role;
revoke all on function public.vsat_forms_admin_list()          from public, anon, authenticated, service_role;
revoke all on function public.vsat_form_get(uuid)              from public, anon, authenticated, service_role;
revoke all on function public.vsat_form_active_for_fill()      from public, anon, authenticated, service_role;
revoke all on function public.vsat_form_save_category(jsonb)   from public, anon, authenticated, service_role;

grant execute on function public.vsat_form_upsert(jsonb)        to authenticated;
grant execute on function public.vsat_form_set_status(jsonb)    to authenticated;
grant execute on function public.vsat_forms_admin_list()        to authenticated;
grant execute on function public.vsat_form_get(uuid)            to authenticated;
grant execute on function public.vsat_form_active_for_fill()    to authenticated;
grant execute on function public.vsat_form_save_category(jsonb) to authenticated;
