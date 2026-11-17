-- 0102 · VSAT form — write mapped answers into application_manager columns.
--
-- Schema-driven: a question may carry  "column": <application_manager column>  and an
-- optional  "cast": text|number|year|bool|date  (default text). On a stage save,
-- vsat_form_save_category now ALSO writes each mapped answer into its column, so the
-- Applications panel / dashboards / CRM sync can use real columns instead of the
-- form_data JSON blob. form_data is still written and remains the source of truth.
--
-- Safety: only an allowlist of profile/academic/parent/document-choice columns can be
-- written (never payment / stage / scholarship / exam / system columns), identifiers are
-- quoted with %I and values with %L, bad values are skipped, and the whole sync is
-- wrapped so it can never break the form save. Rollback restores the 0099 version.
-- Shared lines are byte-identical to 0099; the only addition is the column-sync block.

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

  -- ── sync mapped answers into real columns (schema-driven, allowlisted, best-effort) ──
  declare
    v_mq jsonb; v_col text; v_cast text; v_raw jsonb; v_txt text; v_sets text[] := '{}'; v_iso text;
    c_allow constant text[] := array[
      'gender','date_of_birth','guardian_mobile_number','residing_city','country','state','city',
      'class_12_stream','preferred_engineering_specialization',
      'class10_school','class10_board','class10_year','class10_marking_scheme','class10_score','class10_percentage','class10_maths_score','class10_maths_percentage',
      'class12_school','class12_board','class12_year','class12_marking_scheme','class12_score','class12_percentage','class12_maths_score','class12_maths_percentage',
      'marks_physics_12','marks_chemistry_12','marks_maths_12','studied_pcm','studied_cs','cs_experience',
      'jee_registered','jee_appeared_when','jee_score','jee_percentile','jee_main_maths_percentile',
      'participated_olympiad','olympiad1_name','olympiad1_marks','olympiad1_intl_rank','olympiad1_year',
      'taken_coding_exam','coding1_name','coding1_year','coding1_percentile','coding1_rank',
      'father_title','father_name','father_mobile','father_email','father_occupation',
      'mother_title','mother_name','mother_mobile','mother_email','mother_occupation','family_income',
      'selected_id_type','declaration_accepted'];
  begin
    for v_mq in
      select q from jsonb_array_elements(v_cat->'questions') q
      union all
      select q from jsonb_array_elements(coalesce(v_cat->'subcategories','[]'::jsonb)) s, jsonb_array_elements(s->'questions') q
    loop
      v_col := v_mq->>'column';
      if v_col is null or not (v_col = any(c_allow)) then continue; end if;
      v_raw := v_answers->(v_mq->>'key');
      if v_raw is null or jsonb_typeof(v_raw) = 'null' then continue; end if;
      v_txt := case
        when jsonb_typeof(v_raw) = 'string' then v_raw #>> '{}'
        when jsonb_typeof(v_raw) = 'array' then (select string_agg(e #>> '{}', ', ') from jsonb_array_elements(v_raw) e)
        else v_raw::text end;
      if v_txt is null or btrim(v_txt) = '' then continue; end if;
      v_cast := coalesce(v_mq->>'cast', 'text');
      if v_cast = 'number' then
        if v_txt ~ '^-?[0-9]+(\.[0-9]+)?$' then v_sets := v_sets || format('%I = %s', v_col, v_txt); end if;
      elsif v_cast = 'year' then
        if v_txt ~ '^[0-9]{4}$' then v_sets := v_sets || format('%I = %s', v_col, v_txt); end if;
      elsif v_cast = 'bool' then
        v_sets := v_sets || format('%I = %L', v_col, (lower(btrim(v_txt)) in ('yes','true','agree','i agree','y','1')));
      elsif v_cast = 'date' then
        if v_txt ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then
          v_iso := split_part(v_txt,'/',3) || '-' || split_part(v_txt,'/',2) || '-' || split_part(v_txt,'/',1);
          begin perform v_iso::date; v_sets := v_sets || format('%I = %L', v_col, v_iso); exception when others then null; end;
        end if;
      else
        v_sets := v_sets || format('%I = %L', v_col, v_txt);
      end if;
    end loop;
    if array_length(v_sets, 1) is not null then
      execute format('update public.application_manager set %s where lead_id = %L', array_to_string(v_sets, ', '), u);
    end if;
  exception when others then null;  -- column sync is best-effort; form_data stays source of truth
  end;
  insert into public.crm_activity_log (entity_type, application_id, lead_id, action, stage_type, to_value, metadata, actor, path)
  values ('application', v_app.application_id, u, 'stage_change', 'form',
          v_stage::text, jsonb_build_object('category', v_cat_key, 'submitted', v_submitted, 'form_id', f.id, 'next', v_next),
          'applicant', '/vsat/dashboard');
  return jsonb_build_object('ok', true, 'submitted', v_submitted, 'next', v_next,
    'progress', v_meta, 'percentage', case when v_submitted then 100 when v_total > 0 then round(v_done * 100.0 / v_total) else 0 end);
end $fn$;

