-- 0069 · Communication Manager, Slice 6 — WhatsApp Flow drafts on live data.
--
-- Flows are SAVED AS DRAFTS ONLY. Nothing here sends a message or talks to Meta / WhatsApp, and no flow
-- is published. The two "Recommended" flows stay in the app's code and never reach this table.
--
-- What this adds (nothing existing is changed; audit_trigger(), comm__guard() and is_admin() are only called):
--   table   comm_flows                    – RLS on, no policies, every table privilege revoked; audit trigger;
--                                           soft delete (deleted_at)
--   helper  comm__flow_screens_check(jsonb) – private: the shape and text rules for screens (also a CHECK)
--   page functions (SECURITY DEFINER, set search_path to '', admin check first via comm__guard):
--       comm_flow_list()                – live flows without screens, newest first, + the categories in use
--       comm_flow_get(id)               – one live flow with its screens (P0002 if missing / deleted)
--       comm_flow_create(name, description, module, category, screens) – always a Draft
--       comm_flow_duplicate(id)         – "Copy of …" as a Draft (P0002 if missing / deleted)
--       comm_flow_delete(id)            – soft delete (P0002 if missing / already deleted)
--   Limits: at most 200 live flows (22023 too_many_flows); names are unique among live flows, ignoring case
--   (23505 name_taken → the route answers 409). owner_id is kept for the record only and never returned.
--
-- Text rules (the same numbers are in src/lib/comm/flow-rules.ts): name 1–80, description 0–300 (one line
-- break allowed), category 1–40, screens 1–10, fields per screen 0–12, kind text/select/date/checkbox,
-- screen keys exactly id,title,fields,cta; field keys label,kind[,placeholder]; title 1–60, label 1–80,
-- placeholder 0–60, cta 1–30, screen id ^[a-z][a-z0-9_]{0,39}$ and unique; no "<", ">" or control
-- characters anywhere; screens jsonb at most 20 KB (as jsonb text).
--
-- Rollback: supabase/rollback/0069_comm_slice6_flows_down.sql
-- Tests:    supabase/tests/comm_slice6_flows.test.sql (staging only, rolls itself back)

-- ── private helper: screens shape + text rules (immutable, used by the CHECK and the functions) ─────────
create or replace function public.comm__flow_screens_check(p jsonb)
returns boolean
language plpgsql immutable
set search_path to ''
as $$
declare
  s jsonb; f jsonb; v_ids text[] := '{}'; v_keys text[];
  c_bad constant text := '[<>\x01-\x1f\x7f-\x9f]';
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception 'screens_invalid' using errcode = '22023'; end if;
  if jsonb_array_length(p) < 1 or jsonb_array_length(p) > 10 then raise exception 'screens_count' using errcode = '22023'; end if;
  if octet_length(p::text) > 20480 then raise exception 'screens_too_big' using errcode = '22023'; end if;
  for s in select e from jsonb_array_elements(p) e loop
    if jsonb_typeof(s) <> 'object' then raise exception 'screen_invalid' using errcode = '22023'; end if;
    select array_agg(k order by k) into v_keys from jsonb_object_keys(s) k;
    if v_keys is distinct from array['cta', 'fields', 'id', 'title'] then raise exception 'screen_keys' using errcode = '22023'; end if;
    if jsonb_typeof(s->'id') <> 'string' or (s->>'id') !~ '^[a-z][a-z0-9_]{0,39}$' or (s->>'id') = any (v_ids) then
      raise exception 'screen_id' using errcode = '22023';
    end if;
    v_ids := v_ids || (s->>'id');
    if jsonb_typeof(s->'title') <> 'string' or char_length(btrim(s->>'title')) < 1 or char_length(s->>'title') > 60 or (s->>'title') ~ c_bad then
      raise exception 'screen_title' using errcode = '22023';
    end if;
    if jsonb_typeof(s->'cta') <> 'string' or char_length(btrim(s->>'cta')) < 1 or char_length(s->>'cta') > 30 or (s->>'cta') ~ c_bad then
      raise exception 'screen_cta' using errcode = '22023';
    end if;
    if jsonb_typeof(s->'fields') <> 'array' or jsonb_array_length(s->'fields') > 12 then raise exception 'screen_fields' using errcode = '22023'; end if;
    for f in select e from jsonb_array_elements(s->'fields') e loop
      if jsonb_typeof(f) <> 'object' then raise exception 'field_invalid' using errcode = '22023'; end if;
      select array_agg(k order by k) into v_keys from jsonb_object_keys(f) k;
      if not (v_keys = array['kind', 'label'] or v_keys = array['kind', 'label', 'placeholder']) then
        raise exception 'field_keys' using errcode = '22023';
      end if;
      if jsonb_typeof(f->'kind') <> 'string' or (f->>'kind') not in ('text', 'select', 'date', 'checkbox') then
        raise exception 'field_kind' using errcode = '22023';
      end if;
      if jsonb_typeof(f->'label') <> 'string' or char_length(btrim(f->>'label')) < 1 or char_length(f->>'label') > 80 or (f->>'label') ~ c_bad then
        raise exception 'field_label' using errcode = '22023';
      end if;
      if f ? 'placeholder' and (jsonb_typeof(f->'placeholder') <> 'string' or char_length(f->>'placeholder') > 60 or (f->>'placeholder') ~ c_bad) then
        raise exception 'field_placeholder' using errcode = '22023';
      end if;
    end loop;
  end loop;
  return true;
end $$;

-- ── table ───────────────────────────────────────────────────────────────────────
create table if not exists public.comm_flows (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[<>\x01-\x1f\x7f-\x9f]'),
  description  text not null default '' check (char_length(description) <= 300 and description !~ '[<>\x01-\x09\x0b-\x1f\x7f-\x9f]'),
  module       text not null check (module in ('Leads', 'Raw Data')),
  category     text not null check (char_length(category) between 1 and 40 and category = btrim(category) and category !~ '[<>\x01-\x1f\x7f-\x9f]'),
  screens      jsonb not null check (public.comm__flow_screens_check(screens)),
  status       text not null default 'Draft' check (status in ('Draft', 'Inactive')),
  owner_id     uuid not null,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create unique index if not exists comm_flows_live_name_uq on public.comm_flows (lower(name)) where deleted_at is null;
create index if not exists comm_flows_live_created_idx on public.comm_flows (created_at desc) where deleted_at is null;

alter table public.comm_flows enable row level security;
revoke all on table public.comm_flows from public, anon, authenticated;

create trigger trg_audit_comm_flows
  after insert or update or delete on public.comm_flows
  for each row execute function public.audit_trigger();

-- the summary every function returns (no screens, no owner)
-- (inline in each function: id, name, description, module, category, status, created_at, screen_count)

-- ── list (+ categories in use) ───────────────────────────────────────────────────
create or replace function public.comm_flow_list()
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare v_rows jsonb; v_cats jsonb;
begin
  perform public.comm__guard(null, null, null, null);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'name', f.name, 'description', f.description, 'module', f.module, 'category', f.category,
           'status', f.status, 'created_at', f.created_at, 'screen_count', jsonb_array_length(f.screens)
         ) order by f.created_at desc, f.id), '[]'::jsonb)
    into v_rows
    from public.comm_flows f where f.deleted_at is null;
  select coalesce(jsonb_agg(c order by c), '[]'::jsonb) into v_cats
    from (select distinct f.category c from public.comm_flows f where f.deleted_at is null) x;
  return jsonb_build_object('total', jsonb_array_length(v_rows), 'rows', v_rows, 'categories', v_cats);
end $$;

-- ── one flow with its screens ────────────────────────────────────────────────────
create or replace function public.comm_flow_get(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare v public.comm_flows;
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  select * into v from public.comm_flows f where f.id = p_id and f.deleted_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', v.id, 'name', v.name, 'description', v.description, 'module', v.module, 'category', v.category,
                            'status', v.status, 'created_at', v.created_at, 'screen_count', jsonb_array_length(v.screens), 'screens', v.screens);
end $$;

-- ── create (always a Draft) ──────────────────────────────────────────────────────
create or replace function public.comm_flow_create(p_name text, p_description text, p_module text, p_category text, p_screens jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
declare v public.comm_flows; v_name text := btrim(p_name); v_cat text := btrim(p_category);
begin
  perform public.comm__guard(null, null, null, null);
  if v_name is null or char_length(v_name) not between 1 and 80 or v_name ~ '[<>\x01-\x1f\x7f-\x9f]' then
    raise exception 'name_invalid' using errcode = '22023';
  end if;
  if char_length(coalesce(p_description, '')) > 300 or coalesce(p_description, '') ~ '[<>\x01-\x09\x0b-\x1f\x7f-\x9f]' then
    raise exception 'description_invalid' using errcode = '22023';
  end if;
  if p_module is null or p_module not in ('Leads', 'Raw Data') then raise exception 'module_invalid' using errcode = '22023'; end if;
  if v_cat is null or char_length(v_cat) not between 1 and 40 or v_cat ~ '[<>\x01-\x1f\x7f-\x9f]' then
    raise exception 'category_invalid' using errcode = '22023';
  end if;
  perform public.comm__flow_screens_check(p_screens);
  -- one at a time, so the 200 cap and the name check cannot race
  perform pg_advisory_xact_lock(hashtext('public.comm_flows'));
  if (select count(*) from public.comm_flows f where f.deleted_at is null) >= 200 then
    raise exception 'too_many_flows' using errcode = '22023';
  end if;
  if exists (select 1 from public.comm_flows f where f.deleted_at is null and lower(f.name) = lower(v_name)) then
    raise exception 'name_taken' using errcode = '23505';
  end if;
  insert into public.comm_flows (name, description, module, category, screens, status, owner_id)
  values (v_name, coalesce(p_description, ''), p_module, v_cat, p_screens, 'Draft', auth.uid())
  returning * into v;
  return jsonb_build_object('id', v.id, 'name', v.name, 'description', v.description, 'module', v.module, 'category', v.category,
                            'status', v.status, 'created_at', v.created_at, 'screen_count', jsonb_array_length(v.screens));
end $$;

-- ── duplicate ("Copy of …", Draft) ───────────────────────────────────────────────
create or replace function public.comm_flow_duplicate(p_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
declare v public.comm_flows; v_src public.comm_flows; v_name text; n int := 1;
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('public.comm_flows'));
  select * into v_src from public.comm_flows f where f.id = p_id and f.deleted_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (select count(*) from public.comm_flows f where f.deleted_at is null) >= 200 then
    raise exception 'too_many_flows' using errcode = '22023';
  end if;
  loop
    v_name := btrim(left(case when n = 1 then 'Copy of ' else 'Copy ' || n || ' of ' end || v_src.name, 80));
    exit when not exists (select 1 from public.comm_flows f where f.deleted_at is null and lower(f.name) = lower(v_name));
    n := n + 1;
    if n > 50 then raise exception 'name_taken' using errcode = '23505'; end if;
  end loop;
  insert into public.comm_flows (name, description, module, category, screens, status, owner_id)
  values (v_name, v_src.description, v_src.module, v_src.category, v_src.screens, 'Draft', auth.uid())
  returning * into v;
  return jsonb_build_object('id', v.id, 'name', v.name, 'description', v.description, 'module', v.module, 'category', v.category,
                            'status', v.status, 'created_at', v.created_at, 'screen_count', jsonb_array_length(v.screens));
end $$;

-- ── soft delete ─────────────────────────────────────────────────────────────────
create or replace function public.comm_flow_delete(p_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  update public.comm_flows f set deleted_at = now() where f.id = p_id and f.deleted_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', p_id, 'deleted', true);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────────
revoke all on function public.comm__flow_screens_check(jsonb) from public, anon, authenticated;

revoke all on function public.comm_flow_list() from public, anon;
revoke all on function public.comm_flow_get(uuid) from public, anon;
revoke all on function public.comm_flow_create(text, text, text, text, jsonb) from public, anon;
revoke all on function public.comm_flow_duplicate(uuid) from public, anon;
revoke all on function public.comm_flow_delete(uuid) from public, anon;

grant execute on function public.comm_flow_list() to authenticated;
grant execute on function public.comm_flow_get(uuid) to authenticated;
grant execute on function public.comm_flow_create(text, text, text, text, jsonb) to authenticated;
grant execute on function public.comm_flow_duplicate(uuid) to authenticated;
grant execute on function public.comm_flow_delete(uuid) to authenticated;
