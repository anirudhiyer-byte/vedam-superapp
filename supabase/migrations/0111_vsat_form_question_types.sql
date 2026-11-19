-- 0111 · VSAT form builder — accept the question types the builder already offers.
--
-- vsat_form_upsert's type whitelist was missing 'board' and 'dob' (the builder has
-- offered both for a while, but saving a form that used them failed INVALID_SCHEMA —
-- which is why the Class 12 board ends up a free-text field that accepts junk like "80").
-- This adds 'board' and 'dob', plus the two new validated types 'email' and 'phone'.
-- Only the whitelist line changes; the rest of the function is byte-identical to its
-- current definition, so the rollback restores it exactly (md5 of pg_get_functiondef).
--
-- Rollback: supabase/rollback/0111_vsat_form_question_types_down.sql

create or replace function public.vsat_form_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  k text; v_id uuid; v_name text; v_schema jsonb; v_cat jsonb; v_sub jsonb; v_q jsonb; v_who text;
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
    if v_cat ? 'subcategories' then
      if jsonb_typeof(v_cat->'subcategories') is distinct from 'array' then
        return jsonb_build_object('ok', false, 'code', 'INVALID_SCHEMA');
      end if;
      for v_sub in select * from jsonb_array_elements(v_cat->'subcategories') loop
        if jsonb_typeof(v_sub->'key') is distinct from 'string' or jsonb_typeof(v_sub->'title') is distinct from 'string'
           or jsonb_typeof(v_sub->'questions') is distinct from 'array' then
          return jsonb_build_object('ok', false, 'code', 'INVALID_SCHEMA');
        end if;
      end loop;
    end if;
    for v_q in
      select q from jsonb_array_elements(v_cat->'questions') q
      union all
      select q from jsonb_array_elements(coalesce(v_cat->'subcategories','[]'::jsonb)) s, jsonb_array_elements(s->'questions') q
    loop
      if jsonb_typeof(v_q->'key') is distinct from 'string' or jsonb_typeof(v_q->'label') is distinct from 'string'
         or coalesce(v_q->>'type','') not in
            ('text','textarea','number','date','dob','dropdown','file','school','state','city','board','checkbox','radio','email','phone') then
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
end $function$;

revoke all on function public.vsat_form_upsert(jsonb) from public, anon;
grant execute on function public.vsat_form_upsert(jsonb) to authenticated;
