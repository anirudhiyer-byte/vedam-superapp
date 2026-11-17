-- 0100 · VSAT Form — mid-stage autosave.
--
-- vsat_form_save_category validates required fields and advances; it only persists
-- when a whole stage is valid. This adds a lightweight partial save so a half-filled
-- stage survives an abandon/refresh: it merges the stage's answers into form_data
-- WITHOUT the required-check, WITHOUT marking the category completed, and WITHOUT
-- touching submission. The fill UI debounce-calls it as the applicant types; on
-- reload, vsat_form_active_for_fill already returns these answers so the stage
-- resumes exactly where it was left.
--
-- Same identity + eligibility gate as save_category (auth.uid only; paid applicant
-- or admin; active form must match formId; category must exist). No-op once the
-- application is already submitted.

create or replace function public.vsat_form_autosave_category(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  u uuid := auth.uid();
  f public.vsat_forms;
  v_cat_key text; v_answers jsonb; v_app public.application_manager; k text;
begin
  if u is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 200000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('formId','category','answers') then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  end loop;
  if lower(coalesce(p->>'formId','')) !~ c_uuid or jsonb_typeof(p->'category') <> 'string'
     or jsonb_typeof(p->'answers') <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  v_cat_key := p->>'category';
  v_answers := p->'answers';

  select * into v_app from public.application_manager where lead_id = u limit 1;
  if v_app.application_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_AN_APPLICANT'); end if;
  if not exists (select 1 from public.vsat_payments vp where vp.lead_id = u) and not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_PAID');
  end if;
  select * into f from public.vsat_forms where status = 'active' limit 1;
  if f.id is null then return jsonb_build_object('ok', false, 'code', 'NO_ACTIVE_FORM'); end if;
  if f.id <> (p->>'formId')::uuid then return jsonb_build_object('ok', false, 'code', 'FORM_CHANGED'); end if;
  if not exists (select 1 from jsonb_array_elements(f.schema->'categories') c where c->>'key' = v_cat_key) then
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CATEGORY');
  end if;

  -- once submitted, don't let a stray autosave re-open / mutate the application
  if coalesce((v_app.form_data->'_meta'->>'submitted')::boolean, false) then
    return jsonb_build_object('ok', true, 'noop', 'submitted');
  end if;

  -- merge this stage's answers (client sends the full current stage object); never
  -- touch _meta.completed / _meta.submitted, so completion status is unchanged.
  update public.application_manager am set
    form_data      = coalesce(am.form_data, '{}'::jsonb) || jsonb_build_object(v_cat_key, v_answers),
    active_form_id = f.id,
    form_name      = f.name,
    form_status    = case when am.form_status = 'completed' then am.form_status else 'in_progress' end,
    form_stage_1   = coalesce(am.form_stage_1, 'form_initiated'::public.vm_form_stage),
    form_start_date = coalesce(am.form_start_date, now()),
    last_updated_date = now()
  where am.lead_id = u;

  return jsonb_build_object('ok', true, 'saved', true);
end $fn$;

revoke all on function public.vsat_form_autosave_category(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.vsat_form_autosave_category(jsonb) to authenticated;
