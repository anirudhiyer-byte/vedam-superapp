-- 0061 · Communication Manager, Slice 3a — Manage List on VSAT data (dynamic lists = saved filters).
--        COUNTS + MASKED SAMPLE ONLY. No sending, no upload, no contact data stored.
--
-- What this adds (nothing existing is changed):
--   * table comm_lists (saved filters). RLS on, no policies, no table access for anon/authenticated.
--     The existing audit_trigger() is attached so every create/update/delete lands in audit_log.
--   * page functions (SECURITY DEFINER, search_path '', admin check first via comm__guard from 0060,
--     execute revoked from public/anon, granted to authenticated):
--       comm_list_create, comm_list_update, comm_list_delete (soft), comm_lists_list,
--       comm_audience_preview (counts + 10 masked rows: phone ********01, e-mail z***@***.com), comm_list_options (filter values)
--   * private helpers comm__conditions_check / comm__audience / comm__phone91 / comm__mask_phone /
--     comm__mask_email (no execute for anon/authenticated).
--
-- Data read (never written), named columns only, joined only by user id:
--   profiles(id, phone, email, consent_given, grad_year, state, city, utm_source, utm_campaign, created_at)
--   vsat_registrations(user_id, registered, campus_preference)
--   lead_manager(lead_id, lead_stage, lead_source)
--   application_manager(lead_id, application_stage_1, application_stage_2, exam_assigned, exam_given, campus_applied)
--   vsat_payments(lead_id)            -- "paid" means a row here, and nothing else
--   vsat_payment_orders(lead_id)      -- "started, not paid" = an order but no vsat_payments row
--   Never read: names, DOB, Aadhaar/PAN/passport, marksheets, scores, scholarship, parent contacts.
--
-- Conditions (one JSON object; keys AND-ed, values inside one key OR-ed). Only these keys:
--   lead_stage[], application_stage[]                  (values must be the database enum labels;
--                                                       application_stage matches attempt 1 OR attempt 2)
--   lead_source[], utm_source[], utm_campaign[], campus[], state[], city[]   (1–20 strings, 1–100 chars, no control chars)
--   grad_year[]                                         (1–20 integers 2000–2100)
--   signup {from, to}                                   (India days YYYY-MM-DD, from <= to)
--   vsat_registered, exam_assigned, exam_given, consent_given   (true / false)
--   payment                                             ('paid' | 'not_paid' | 'started_not_paid')
--   Whole object at most 4096 bytes. No dynamic SQL anywhere: values are only ever compared as data.
--
-- Rollback: supabase/rollback/0061_comm_slice3a_lists_down.sql
-- Tests:    supabase/tests/comm_slice3a_lists.test.sql (staging only, rolls itself back)

-- ── table ───────────────────────────────────────────────────────────────────────
create table if not exists public.comm_lists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]'),
  kind        text not null default 'dynamic' check (kind in ('dynamic')),
  conditions  jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object' and octet_length(conditions::text) <= 4096),
  owner_id    uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists comm_lists_live_created_idx on public.comm_lists (created_at desc) where deleted_at is null;
create index if not exists comm_lists_owner_idx on public.comm_lists (owner_id);

alter table public.comm_lists enable row level security;
revoke all on table public.comm_lists from public, anon, authenticated;

create trigger trg_audit_comm_lists
  after insert or update or delete on public.comm_lists
  for each row execute function public.audit_trigger();

-- ── private helpers ─────────────────────────────────────────────────────────────

-- phone → 91XXXXXXXXXX (the format comms_optouts / whatsapp_sends use), or null when it is not an Indian mobile
create or replace function public.comm__phone91(p text)
returns text
language sql immutable
set search_path to ''
as $$
  select case
           when d ~ '^[6-9][0-9]{9}$' then '91' || d
           when d ~ '^91[6-9][0-9]{9}$' then d
           when d ~ '^0[6-9][0-9]{9}$' then '91' || substr(d, 2)
         end
    from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

-- 919000000101 → ********01 (only the last 2 digits are shown)
create or replace function public.comm__mask_phone(p91 text)
returns text
language sql immutable
set search_path to ''
as $$
  select case when p91 ~ '^91[0-9]{10}$' then '********' || right(p91, 2) end
$$;

-- someone@example.com → s***@***.com (first letter + domain extension only)
create or replace function public.comm__mask_email(e text)
returns text
language sql immutable
set search_path to ''
as $$
  select case
           when e ~ '^[^@[:space:]]+@[^@[:space:]]+$' then
             left(split_part(e, '@', 1), 1) || '***@***'
             || coalesce(substring(split_part(e, '@', 2) from '\.[^.]+$'), '')
         end
$$;

-- the filter whitelist: anything not listed, or of the wrong type/shape, is refused (22023)
create or replace function public.comm__conditions_check(c jsonb)
returns void
language plpgsql stable
set search_path to ''
as $$
declare
  k text; v jsonb; e jsonb; s text;
  str_keys constant text[] := array['lead_source', 'utm_source', 'utm_campaign', 'campus', 'state', 'city'];
  enum_keys constant text[] := array['lead_stage', 'application_stage'];
  bool_keys constant text[] := array['vsat_registered', 'exam_assigned', 'exam_given', 'consent_given'];
  d_from date; d_to date;
begin
  if c is null or jsonb_typeof(c) <> 'object' then
    raise exception 'conditions_invalid' using errcode = '22023';
  end if;
  if octet_length(c::text) > 4096 then
    raise exception 'conditions_too_large' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(c) loop
    if k = any (str_keys) or k = any (enum_keys) then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) < 1 or jsonb_array_length(v) > 20 then
        raise exception 'conditions_invalid:%', k using errcode = '22023';
      end if;
      for e in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(e) <> 'string' then raise exception 'conditions_invalid:%', k using errcode = '22023'; end if;
        s := e #>> '{}';
        if char_length(s) < 1 or char_length(s) > 100 or s ~ '[[:cntrl:]]' then
          raise exception 'conditions_invalid:%', k using errcode = '22023';
        end if;
        if k = 'lead_stage' and not (s = any (enum_range(null::public.vm_lead_stage)::text[])) then
          raise exception 'conditions_invalid:%', k using errcode = '22023';
        end if;
        if k = 'application_stage' and not (s = any (enum_range(null::public.vm_app_stage)::text[])) then
          raise exception 'conditions_invalid:%', k using errcode = '22023';
        end if;
      end loop;
    elsif k = 'grad_year' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) < 1 or jsonb_array_length(v) > 20 then
        raise exception 'conditions_invalid:%', k using errcode = '22023';
      end if;
      for e in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^[0-9]{4}$' or (e #>> '{}')::int not between 2000 and 2100 then
          raise exception 'conditions_invalid:%', k using errcode = '22023';
        end if;
      end loop;
    elsif k = any (bool_keys) then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'conditions_invalid:%', k using errcode = '22023'; end if;
    elsif k = 'payment' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('paid', 'not_paid', 'started_not_paid') then
        raise exception 'conditions_invalid:%', k using errcode = '22023';
      end if;
    elsif k = 'signup' then
      if jsonb_typeof(v) <> 'object' or (select count(*) from jsonb_object_keys(v)) <> 2
         or jsonb_typeof(v->'from') is distinct from 'string' or jsonb_typeof(v->'to') is distinct from 'string'
         or (v->>'from') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (v->>'to') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'conditions_invalid:%', k using errcode = '22023';
      end if;
      begin
        d_from := (v->>'from')::date; d_to := (v->>'to')::date;
      exception when others then
        raise exception 'conditions_invalid:%', k using errcode = '22023';
      end;
      -- the date must round-trip (no 2026-02-30 sliding into March)
      if to_char(d_from, 'YYYY-MM-DD') <> v->>'from' or to_char(d_to, 'YYYY-MM-DD') <> v->>'to'
         or d_from > d_to or d_from < date '2020-01-01' or d_to > date '2100-12-31' then
        raise exception 'conditions_invalid:%', k using errcode = '22023';
      end if;
    else
      raise exception 'conditions_unknown_key' using errcode = '22023';
    end if;
  end loop;
end $$;

-- the people a (checked) condition set selects: user id + normalised contact flags only
create or replace function public.comm__audience(c jsonb)
returns table (uid uuid, phone91 text, email text, consent boolean, created_at timestamptz)
language sql stable
set search_path to ''
as $$
  select p.id, public.comm__phone91(p.phone), nullif(btrim(p.email), ''), coalesce(p.consent_given, false), p.created_at
    from public.profiles p
   where (not (c ? 'utm_source')   or p.utm_source   = any (array(select jsonb_array_elements_text(c->'utm_source'))))
     and (not (c ? 'utm_campaign') or p.utm_campaign = any (array(select jsonb_array_elements_text(c->'utm_campaign'))))
     and (not (c ? 'state')        or p.state        = any (array(select jsonb_array_elements_text(c->'state'))))
     and (not (c ? 'city')         or p.city         = any (array(select jsonb_array_elements_text(c->'city'))))
     and (not (c ? 'grad_year')    or p.grad_year    = any (array(select (jsonb_array_elements_text(c->'grad_year'))::int)))
     and (not (c ? 'consent_given') or coalesce(p.consent_given, false) = (c->>'consent_given')::boolean)
     and (not (c ? 'signup')
          or (p.created_at >= ((c->'signup'->>'from')::date)::timestamp at time zone 'Asia/Kolkata'
              and p.created_at < (((c->'signup'->>'to')::date) + 1)::timestamp at time zone 'Asia/Kolkata'))
     and (not (c ? 'lead_stage')
          or exists (select 1 from public.lead_manager lm
                      where lm.lead_id = p.id and lm.lead_stage::text = any (array(select jsonb_array_elements_text(c->'lead_stage')))))
     and (not (c ? 'lead_source')
          or exists (select 1 from public.lead_manager lm
                      where lm.lead_id = p.id and lm.lead_source = any (array(select jsonb_array_elements_text(c->'lead_source')))))
     and (not (c ? 'campus')
          or exists (select 1 from public.application_manager am
                      where am.lead_id = p.id and am.campus_applied = any (array(select jsonb_array_elements_text(c->'campus'))))
          or exists (select 1 from public.vsat_registrations r
                      where r.user_id = p.id and r.campus_preference = any (array(select jsonb_array_elements_text(c->'campus')))))
     -- stage of EITHER attempt: application_stage_2 is not reset/cleared when attempt 2 is not open, so
     -- coalesce(stage_2, stage_1) could hide attempt 1; matching either keeps everyone who is at that stage
     and (not (c ? 'application_stage')
          or exists (select 1 from public.application_manager am
                      where am.lead_id = p.id
                        and (am.application_stage_1::text = any (array(select jsonb_array_elements_text(c->'application_stage')))
                             or am.application_stage_2::text = any (array(select jsonb_array_elements_text(c->'application_stage'))))))
     and (not (c ? 'vsat_registered')
          or (c->>'vsat_registered')::boolean
             = exists (select 1 from public.vsat_registrations r where r.user_id = p.id and r.registered is true))
     and (not (c ? 'exam_assigned')
          or (c->>'exam_assigned')::boolean
             = exists (select 1 from public.application_manager am where am.lead_id = p.id and am.exam_assigned))
     and (not (c ? 'exam_given')
          or (c->>'exam_given')::boolean
             = exists (select 1 from public.application_manager am where am.lead_id = p.id and am.exam_given))
     and (not (c ? 'payment')
          or case c->>'payment'
               when 'paid' then exists (select 1 from public.vsat_payments vp where vp.lead_id = p.id)
               when 'not_paid' then not exists (select 1 from public.vsat_payments vp where vp.lead_id = p.id)
               when 'started_not_paid' then exists (select 1 from public.vsat_payment_orders o where o.lead_id = p.id)
                                        and not exists (select 1 from public.vsat_payments vp where vp.lead_id = p.id)
               else false
             end)
$$;

-- ── page functions ──────────────────────────────────────────────────────────────

-- counts + 10 masked rows (no ids, no names, never a full phone or e-mail)
create or replace function public.comm_audience_preview(p_conditions jsonb)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare v jsonb;
begin
  perform public.comm__guard(null, null, null, null);
  perform public.comm__conditions_check(p_conditions);
  with a as (select * from public.comm__audience(p_conditions))
  select jsonb_build_object(
           'total', count(*),
           'with_phone', count(*) filter (where a.phone91 is not null),
           'with_email', count(*) filter (where a.email is not null),
           'consented', count(*) filter (where a.consent),
           'sample', coalesce((select jsonb_agg(jsonb_build_object('phone', public.comm__mask_phone(s.phone91),
                                                                    'email', public.comm__mask_email(s.email),
                                                                    'consent', s.consent) order by s.created_at desc, s.uid)
                                 from (select * from a order by a.created_at desc, a.uid limit 10) s), '[]'::jsonb))
    into v
    from a;
  return v;
end $$;

-- values for the filter dropdowns (no contact data)
create or replace function public.comm_list_options()
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
begin
  perform public.comm__guard(null, null, null, null);
  return jsonb_build_object(
    'lead_stage', to_jsonb(enum_range(null::public.vm_lead_stage)::text[]),
    'application_stage', to_jsonb(enum_range(null::public.vm_app_stage)::text[]),
    'lead_source', coalesce((select jsonb_agg(x.v order by x.v) from (select distinct lm.lead_source as v from public.lead_manager lm
                              where nullif(btrim(lm.lead_source), '') is not null order by 1 limit 100) x), '[]'::jsonb),
    'utm_source', coalesce((select jsonb_agg(x.v order by x.v) from (select distinct p.utm_source as v from public.profiles p
                              where nullif(btrim(p.utm_source), '') is not null order by 1 limit 100) x), '[]'::jsonb),
    'utm_campaign', coalesce((select jsonb_agg(x.v order by x.v) from (select distinct p.utm_campaign as v from public.profiles p
                              where nullif(btrim(p.utm_campaign), '') is not null order by 1 limit 100) x), '[]'::jsonb),
    'campus', coalesce((select jsonb_agg(x.v order by x.v) from (
                          select am.campus_applied as v from public.application_manager am where nullif(btrim(am.campus_applied), '') is not null
                          union
                          select r.campus_preference from public.vsat_registrations r where nullif(btrim(r.campus_preference), '') is not null
                          order by 1 limit 50) x), '[]'::jsonb),
    'state', coalesce((select jsonb_agg(x.v order by x.v) from (select distinct p.state as v from public.profiles p
                         where nullif(btrim(p.state), '') is not null order by 1 limit 200) x), '[]'::jsonb),
    'city', coalesce((select jsonb_agg(x.v order by x.v) from (select distinct p.city as v from public.profiles p
                        where nullif(btrim(p.city), '') is not null order by 1 limit 200) x), '[]'::jsonb),
    'grad_year', coalesce((select jsonb_agg(x.v order by x.v) from (select distinct p.grad_year as v from public.profiles p
                             where p.grad_year between 2000 and 2100 order by 1 limit 50) x), '[]'::jsonb));
end $$;

-- saved lists, newest first, paged
create or replace function public.comm_lists_list(p_search text, p_page int, p_size int)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare v_like text; v_page int := coalesce(p_page, 1); v_size int := coalesce(p_size, 10); v_total bigint; v_rows jsonb;
begin
  perform public.comm__guard(null, null, v_page, v_size);
  v_like := public.comm__like(p_search);
  select count(*) into v_total from public.comm_lists l where l.deleted_at is null and (v_like is null or l.name ilike v_like);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind, 'conditions', x.conditions,
                                               'owner_is_me', x.owner_id = auth.uid(), 'created_at', x.created_at,
                                               'updated_at', x.updated_at) order by x.created_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (select l.id, l.name, l.kind, l.conditions, l.owner_id, l.created_at, l.updated_at
            from public.comm_lists l
           where l.deleted_at is null and (v_like is null or l.name ilike v_like)
           order by l.created_at desc, l.id
           limit v_size offset (v_page - 1) * v_size) x;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- name: 1–80 chars after trimming, no control characters
create or replace function public.comm_list_create(p_name text, p_conditions jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
declare v public.comm_lists;
begin
  perform public.comm__guard(null, null, null, null);
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]' then
    raise exception 'name_invalid' using errcode = '22023';
  end if;
  perform public.comm__conditions_check(p_conditions);
  if (select count(*) from public.comm_lists l where l.deleted_at is null) >= 500 then
    raise exception 'too_many_lists' using errcode = '22023';
  end if;
  insert into public.comm_lists (name, kind, conditions, owner_id)
  values (btrim(p_name), 'dynamic', p_conditions, auth.uid())
  returning * into v;
  return jsonb_build_object('id', v.id, 'name', v.name, 'kind', v.kind, 'conditions', v.conditions,
                            'owner_is_me', true, 'created_at', v.created_at, 'updated_at', v.updated_at);
end $$;

-- null name / null conditions = keep as is. Owner or admin only. Deleted or unknown → P0002.
create or replace function public.comm_list_update(p_id uuid, p_name text, p_conditions jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
declare v public.comm_lists;
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  if p_name is not null and (char_length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]') then
    raise exception 'name_invalid' using errcode = '22023';
  end if;
  if p_conditions is not null then perform public.comm__conditions_check(p_conditions); end if;
  select * into v from public.comm_lists l where l.id = p_id and l.deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not (v.owner_id = auth.uid() or public.is_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.comm_lists l
     set name = coalesce(btrim(p_name), l.name), conditions = coalesce(p_conditions, l.conditions), updated_at = now()
   where l.id = p_id
  returning * into v;
  return jsonb_build_object('id', v.id, 'name', v.name, 'kind', v.kind, 'conditions', v.conditions,
                            'owner_is_me', v.owner_id = auth.uid(), 'created_at', v.created_at, 'updated_at', v.updated_at);
end $$;

-- soft delete. Owner or admin only. Deleted or unknown → P0002.
create or replace function public.comm_list_delete(p_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
declare v public.comm_lists;
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  select * into v from public.comm_lists l where l.id = p_id and l.deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not (v.owner_id = auth.uid() or public.is_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.comm_lists l set deleted_at = now(), updated_at = now() where l.id = p_id;
  return jsonb_build_object('id', p_id, 'deleted', true);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────────
revoke all on function public.comm__phone91(text) from public, anon, authenticated;
revoke all on function public.comm__mask_phone(text) from public, anon, authenticated;
revoke all on function public.comm__mask_email(text) from public, anon, authenticated;
revoke all on function public.comm__conditions_check(jsonb) from public, anon, authenticated;
revoke all on function public.comm__audience(jsonb) from public, anon, authenticated;

revoke all on function public.comm_audience_preview(jsonb) from public, anon;
revoke all on function public.comm_list_options() from public, anon;
revoke all on function public.comm_lists_list(text, int, int) from public, anon;
revoke all on function public.comm_list_create(text, jsonb) from public, anon;
revoke all on function public.comm_list_update(uuid, text, jsonb) from public, anon;
revoke all on function public.comm_list_delete(uuid) from public, anon;

grant execute on function public.comm_audience_preview(jsonb) to authenticated;
grant execute on function public.comm_list_options() to authenticated;
grant execute on function public.comm_lists_list(text, int, int) to authenticated;
grant execute on function public.comm_list_create(text, jsonb) to authenticated;
grant execute on function public.comm_list_update(uuid, text, jsonb) to authenticated;
grant execute on function public.comm_list_delete(uuid) to authenticated;
