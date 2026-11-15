-- 0042_vsat_school_search.sql
-- Dataset-backed searchable School dropdown for the VSAT form, plus three new
-- builder question types (school / state / city).
--
-- `school_database` holds ~lakhs of UDISE schools; browsers never touch it
-- directly. Search goes through a SECURITY DEFINER function with a trigram index
-- so an authenticated applicant can type-ahead without table access.
--
-- Also extends vsat_form_upsert's allowed question types to include the three new
-- dataset-backed types. The answer save-path (vsat_application_save_category) only
-- checks required-presence, so it needs no change. The vsat_form_upsert body below
-- is byte-identical to 0039's except the type whitelist.

-- ── trigram search index on school names ───────────────────────────────────
create extension if not exists pg_trgm;
create index if not exists school_database_schname_trgm
  on public.school_database using gin (schname gin_trgm_ops);

-- ── authenticated: search schools by name (type-ahead) ─────────────────────
-- Returns the top matches as a compact array: { code, name, district, state }.
-- Requires a logged-in user (applicant/admin); min 2 chars; capped result set.
create or replace function public.vsat_school_search(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  v_q text; v_lim int; v_rows jsonb; k text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('q','limit') then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  end loop;
  v_q := btrim(coalesce(p->>'q',''));
  if char_length(v_q) < 2 then return jsonb_build_object('ok', true, 'schools', '[]'::jsonb); end if;
  v_lim := least(greatest(coalesce((p->>'limit')::int, 20), 1), 30);

  select coalesce(jsonb_agg(r order by r->>'name'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'code', s.schcd,
             'name', s.schname,
             'district', coalesce(nullif(s.dtname,''), s.dtname_1),
             'state', coalesce(nullif(s.stname,''), s.stname_1)) as r
    from public.school_database s
    where s.schname is not null and s.schname ilike '%' || v_q || '%'
    order by (s.schname ilike v_q || '%') desc, length(s.schname), s.schname
    limit v_lim
  ) q;

  return jsonb_build_object('ok', true, 'schools', v_rows);
end $fn$;

revoke all on function public.vsat_school_search(jsonb) from public, anon;
grant execute on function public.vsat_school_search(jsonb) to authenticated;

-- ── extend allowed question types in the form builder ──────────────────────
-- CREATE OR REPLACE — never edits the 0039 migration. Body is 0039's verbatim
-- except the type whitelist now also allows 'school','state','city'.
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
    update public.vsat_forms
       set name = v_name, schema = v_schema, version = version + 1, updated_at = now()
     where id = v_id and status <> 'archived';
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  else
    insert into public.vsat_forms (name, schema, created_by) values (v_name, v_schema, v_who) returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;
