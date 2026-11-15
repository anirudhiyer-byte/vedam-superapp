-- Rollback for 0042_vsat_school_search.sql
-- Drops the school search function + trigram index, and restores vsat_form_upsert
-- to its 0039 definition (type whitelist without school/state/city).
-- NOTE: pg_trgm is intentionally left installed — it is a shared extension and
-- dropping it could break anything else that relies on it.

drop function if exists public.vsat_school_search(jsonb);
drop index if exists public.school_database_schname_trgm;

-- restore 0039's vsat_form_upsert (body byte-identical to 0039)
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
