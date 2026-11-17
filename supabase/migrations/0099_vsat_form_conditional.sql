-- 0099 · VSAT Form builder — conditional logic (section branching + show/hide).
--
-- Adds Google-Forms-style logic WITHOUT changing storage. New optional schema
-- fields (all pass through vsat_form_upsert unchanged — it never enforced a closed
-- key set):
--   • question.showIf = { q:<questionKey>, op:'eq'|'neq'|'includes', value:<text> }
--       → the question is shown only when the condition holds. A hidden question is
--         never required.
--   • question.routes = [ { value:<option>, to:<catKey>|'__submit__'|'__next__' } ]
--       on a dropdown/radio → the chosen answer routes to another section / submit.
--   • category.next = <catKey>|'__submit__'|'__next__'  (default after this section)
--
-- Only vsat_form_save_category changes: required-check skips hidden questions, and
-- submission + the next section are computed branch-aware, server-side (the client
-- mirrors this only for UX). Rollback restores the 0095 version.

-- ── helper: does an answer satisfy a condition? (private) ──
create or replace function public.vsat__ans_match(ans jsonb, op text, val text)
returns boolean language sql immutable set search_path to '' as $fn$
  select case
    when ans is null or jsonb_typeof(ans) = 'null' then false
    when jsonb_typeof(ans) = 'string' and btrim(ans #>> '{}') = '' then false
    when op = 'neq'      then not (jsonb_typeof(ans) = 'string' and ans #>> '{}' = val)
    when op = 'includes' then (jsonb_typeof(ans) = 'array' and ans ? val)
                              or (jsonb_typeof(ans) = 'string' and ans #>> '{}' = val)
    else /* eq */             (jsonb_typeof(ans) = 'string' and ans #>> '{}' = val)
  end
$fn$;
revoke all on function public.vsat__ans_match(jsonb, text, text) from public, anon, authenticated;

-- ── helper: is a question visible given the flattened answers? (private) ──
create or replace function public.vsat__q_visible(q jsonb, flat jsonb)
returns boolean language sql immutable set search_path to '' as $fn$
  select case
    when q ? 'showIf' and jsonb_typeof(q->'showIf') = 'object'
      then public.vsat__ans_match(flat -> (q->'showIf'->>'q'),
                                  coalesce(q->'showIf'->>'op', 'eq'),
                                  coalesce(q->'showIf'->>'value', ''))
    else true
  end
$fn$;
revoke all on function public.vsat__q_visible(jsonb, jsonb) from public, anon, authenticated;

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
  v_flat jsonb := '{}'::jsonb; v_route text; v_next text; v_cats jsonb; v_idx int; v_rt jsonb;
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
  v_cats := coalesce(f.schema->'categories', '[]'::jsonb);
  select c into v_cat from jsonb_array_elements(v_cats) c where c->>'key' = v_cat_key;
  if v_cat is null then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CATEGORY'); end if;

  -- flatten every answer (prior categories from form_data + this category's answers) → qkey:answer
  for k in select jsonb_object_keys(coalesce(v_app.form_data, '{}'::jsonb)) loop
    if k <> '_meta' and jsonb_typeof(v_app.form_data->k) = 'object' then v_flat := v_flat || (v_app.form_data->k); end if;
  end loop;
  v_flat := v_flat || v_answers;

  -- required questions (category + subcategories), skipping HIDDEN ones and ticked exceptions
  for v_q in
    select q from jsonb_array_elements(v_cat->'questions') q
    union all
    select q from jsonb_array_elements(coalesce(v_cat->'subcategories','[]'::jsonb)) s, jsonb_array_elements(s->'questions') q
  loop
    if coalesce((v_q->>'required')::boolean, false) and public.vsat__q_visible(v_q, v_flat) then
      v_qkey := v_q->>'key';
      v_exc_key := v_q->'exception'->>'key';
      if v_exc_key is not null and v_exc ? v_exc_key then continue; end if;
      v_val := v_answers->v_qkey;
      if v_val is null or jsonb_typeof(v_val) = 'null'
         or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '')
         or (jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) = 0) then
        v_missing := array_append(v_missing, v_qkey);
      end if;
    end if;
  end loop;
  if array_length(v_missing, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'MISSING_REQUIRED', 'fields', to_jsonb(v_missing));
  end if;

  -- ── branch-aware next: last routing question with a matching answer wins, else category.next ──
  v_route := null;
  for v_q in
    select q from jsonb_array_elements(v_cat->'questions') q
    union all
    select q from jsonb_array_elements(coalesce(v_cat->'subcategories','[]'::jsonb)) s, jsonb_array_elements(s->'questions') q
  loop
    if v_q->>'type' in ('dropdown','radio') and jsonb_typeof(v_q->'routes') = 'array'
       and jsonb_typeof(v_answers->(v_q->>'key')) = 'string' then
      for v_rt in select r from jsonb_array_elements(v_q->'routes') r loop
        if v_rt->>'value' = (v_answers->>(v_q->>'key')) then v_route := v_rt->>'to'; end if;
      end loop;
    end if;
  end loop;
  if v_route is null then v_route := v_cat->>'next'; end if;

  -- resolve the route to a concrete next category key (v_next) or submit (v_next is null + v_submitted)
  if v_route = '__submit__' then
    v_next := null; v_submitted := true;
  elsif v_route is not null and v_route <> '__next__'
        and exists (select 1 from jsonb_array_elements(v_cats) c where c->>'key' = v_route) then
    v_next := v_route; v_submitted := false;
  else
    -- __next__ / unset / dangling ref → the next category in document order
    select ord into v_idx from (
      select c->>'key' as key, row_number() over () - 1 as ord from jsonb_array_elements(v_cats) c
    ) t where t.key = v_cat_key;
    if v_idx is not null and v_idx + 1 < jsonb_array_length(v_cats) then
      v_next := v_cats->(v_idx + 1)->>'key'; v_submitted := false;
    else
      v_next := null; v_submitted := true;
    end if;
  end if;

  v_meta := coalesce(v_app.form_data->'_meta', jsonb_build_object('completed', '[]'::jsonb, 'submitted', false));
  v_completed := coalesce(v_meta->'completed', '[]'::jsonb);
  if not (v_completed ? v_cat_key) then v_completed := v_completed || to_jsonb(v_cat_key); end if;
  v_total := jsonb_array_length(v_cats);
  v_done  := jsonb_array_length(v_completed);
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
    form_completion_percentage = case when v_submitted then 100 when v_total > 0 then round(v_done * 100.0 / v_total) else 0 end,
    form_start_date = coalesce(am.form_start_date, now()),
    last_updated_date = now()
  where am.lead_id = u;
  insert into public.crm_activity_log (entity_type, application_id, lead_id, action, stage_type, to_value, metadata, actor, path)
  values ('application', v_app.application_id, u, 'stage_change', 'form',
          v_stage::text, jsonb_build_object('category', v_cat_key, 'submitted', v_submitted, 'form_id', f.id, 'next', v_next),
          'applicant', '/vsat/dashboard');
  return jsonb_build_object('ok', true, 'submitted', v_submitted, 'next', v_next,
    'progress', v_meta, 'percentage', case when v_submitted then 100 when v_total > 0 then round(v_done * 100.0 / v_total) else 0 end);
end $fn$;
