-- 0065 · Communication Manager, Slice 3b — Static lists from a CSV upload (MATCH-ONLY).
--
-- Each CSV row (phone and/or e-mail) is matched against the existing VSAT users (profiles). Only the matched
-- user ids are saved. Unmatched, invalid and duplicate rows are only COUNTED: never stored, never logged.
-- A static list stores no phone or e-mail at all; counts and consent are always read live from profiles,
-- so an old list still shows today's consent.
--
-- What this changes / adds:
--   * comm_lists (our own table from 0061): the kind check now allows 'static' as well as 'dynamic'.
--     Nothing else in comm_lists changes. No existing function is replaced: comm_lists_list already returns
--     `kind`, and the other comm_list_* functions keep their exact behaviour.
--   * table comm_list_members(list_id, user_id): RLS on, no policies, no access for anon/authenticated.
--     NO per-row audit trigger (a 5000-member list would add 10,000 audit rows); the import writes one summary
--     audit row and comm_lists keeps its audit trigger. list_id → comm_lists ON DELETE CASCADE (hard delete); a soft delete
--     (comm_list_delete sets deleted_at) removes the members too, through the trigger below.
--     user_id has no FK on purpose (existing tables stay untouched); counts join profiles live, so a user who
--     no longer exists simply drops out of the counts.
--   * comm__list_members_on_delete(): trigger helper (not callable by anon/authenticated).
--   * comm_list_import(name, identifiers, dry_run): admin only (comm__guard first), one transaction,
--     1–5000 rows, name 1–80 chars, the 500-list cap from 0061. Returns counts + 10 masked sample rows
--     (0061 masks). dry_run = true is the preview: same matching, nothing written.
--   * comm_list_count(id): live counts + masked sample for one saved list (dynamic: its filters,
--     static: its members joined to profiles). Same answer shape as comm_audience_preview.
--
-- Matching rules (same normalising as 0061):
--   phone  → public.comm__phone91(x)         (91XXXXXXXXXX; anything else is not a phone)
--   e-mail → lower(btrim(x)), must look like an e-mail
--   invalid   = a row with neither a usable phone nor a usable e-mail
--   duplicate = a valid row whose phone or e-mail already appeared in an EARLIER valid row
--   matched   = a remaining row that finds at least one profile (by phone OR e-mail); unmatched = the rest
--   members   = the distinct matched user ids (two rows can point at the same person)
--
-- Rollback: supabase/rollback/0065_comm_slice3b_static_lists_down.sql
-- Tests:    supabase/tests/comm_slice3b_static_lists.test.sql (staging only, rolls itself back)

-- ── comm_lists: allow static lists ────────────────────────────────────────────────
alter table public.comm_lists drop constraint comm_lists_kind_check;
alter table public.comm_lists add constraint comm_lists_kind_check check (kind in ('dynamic', 'static'));

-- ── members (user ids only) ────────────────────────────────────────────────────────
create table if not exists public.comm_list_members (
  list_id  uuid not null references public.comm_lists(id) on delete cascade,
  user_id  uuid not null,
  primary key (list_id, user_id)
);

alter table public.comm_list_members enable row level security;
revoke all on table public.comm_list_members from public, anon, authenticated;

-- soft delete of a list (deleted_at set) → its members go too
create or replace function public.comm__list_members_on_delete()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    delete from public.comm_list_members m where m.list_id = new.id;
  end if;
  return new;
end $$;

create trigger trg_comm_lists_members_on_delete
  after update of deleted_at on public.comm_lists
  for each row execute function public.comm__list_members_on_delete();

-- ── import ────────────────────────────────────────────────────────────────────────
-- p_identifiers: JSON array of 1–5000 objects, each with only the keys "p" (phone) and/or "e" (e-mail),
-- string or null values (phone ≤ 64 chars, e-mail ≤ 254 chars). The browser sends nothing else.
create or replace function public.comm_list_import(p_name text, p_identifiers jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
declare
  v_rows int; v_valid int; v_dup int; v_matched int; v_ids uuid[]; v_id uuid; v_list public.comm_lists;
  v_counts jsonb; v_sample jsonb;
begin
  perform public.comm__guard(null, null, null, null);

  if not coalesce(p_dry_run, false) then
    if p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]' then
      raise exception 'name_invalid' using errcode = '22023';
    end if;
  end if;
  if p_identifiers is null or jsonb_typeof(p_identifiers) <> 'array' then
    raise exception 'identifiers_invalid' using errcode = '22023';
  end if;
  v_rows := jsonb_array_length(p_identifiers);
  if v_rows < 1 or v_rows > 5000 then raise exception 'rows_out_of_range' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_identifiers) x
     where jsonb_typeof(x) <> 'object'
        or exists (select 1 from jsonb_object_keys(x) k where k not in ('p', 'e'))
        or (x ? 'p' and jsonb_typeof(x->'p') not in ('string', 'null'))
        or (x ? 'e' and jsonb_typeof(x->'e') not in ('string', 'null'))
        or char_length(coalesce(x->>'p', '')) > 64
        or char_length(coalesce(x->>'e', '')) > 254) then
    raise exception 'identifiers_invalid' using errcode = '22023';
  end if;
  if not coalesce(p_dry_run, false) and (select count(*) from public.comm_lists l where l.deleted_at is null) >= 500 then
    raise exception 'too_many_lists' using errcode = '22023';
  end if;

  with r as (
    select t.ord,
           public.comm__phone91(t.x->>'p') as ph,
           case when lower(btrim(t.x->>'e')) ~ '^[^@[:space:],;]+@[^@[:space:],;]+\.[^@[:space:],;.]{2,}$' then lower(btrim(t.x->>'e')) end as em
      from jsonb_array_elements(p_identifiers) with ordinality as t(x, ord)
  ), v as (
    select r.*,
           (r.ph is not null and r.ord > min(r.ord) over (partition by r.ph))
           or (r.em is not null and r.ord > min(r.ord) over (partition by r.em)) as dup
      from r
     where r.ph is not null or r.em is not null
  ), u as (
    select v.ord, v.ph, v.em from v where not v.dup
  ), pn as materialized (
    select p.id, public.comm__phone91(p.phone) as ph, nullif(lower(btrim(p.email)), '') as em
      from public.profiles p
     where p.phone is not null or p.email is not null
  ), m as (
    select u.ord, pn.id from u join pn on pn.ph = u.ph
    union
    select u.ord, pn.id from u join pn on pn.em = u.em
  )
  select (select count(*) from v),
         (select count(*) from v where v.dup),
         (select count(distinct m.ord) from m),
         (select array_agg(distinct m.id) from m)
    into v_valid, v_dup, v_matched, v_ids;

  v_ids := coalesce(v_ids, '{}');

  if not coalesce(p_dry_run, false) then
    if cardinality(v_ids) = 0 then raise exception 'no_matches' using errcode = '22023'; end if;
    insert into public.comm_lists (name, kind, conditions, owner_id)
    values (btrim(p_name), 'static', '{}'::jsonb, auth.uid())
    returning * into v_list;
    v_id := v_list.id;
    insert into public.comm_list_members (list_id, user_id) select v_id, x from unnest(v_ids) as x;
  end if;

  -- live counts + 10 masked rows for the matched people (never a full phone or e-mail)
  select jsonb_build_object(
           'with_phone', count(*) filter (where public.comm__phone91(p.phone) is not null),
           'with_email', count(*) filter (where nullif(btrim(p.email), '') is not null),
           'consented', count(*) filter (where coalesce(p.consent_given, false)))
    into v_counts
    from public.profiles p where p.id = any (v_ids);
  select coalesce(jsonb_agg(jsonb_build_object('phone', public.comm__mask_phone(public.comm__phone91(s.phone)),
                                               'email', public.comm__mask_email(nullif(btrim(s.email), '')),
                                               'consent', coalesce(s.consent_given, false)) order by s.created_at desc, s.id), '[]'::jsonb)
    into v_sample
    from (select p.id, p.phone, p.email, p.consent_given, p.created_at from public.profiles p
           where p.id = any (v_ids) order by p.created_at desc, p.id limit 10) s;

  if not coalesce(p_dry_run, false) then
    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    values (auth.uid(), 'comm_list_import', 'comm_lists', v_id::text,
            jsonb_build_object('rows', v_rows, 'invalid', v_rows - v_valid, 'duplicate', v_dup, 'matched', v_matched,
                               'unmatched', v_valid - v_dup - v_matched, 'members', cardinality(v_ids)));
  end if;

  return jsonb_build_object(
    'id', v_id, 'name', case when v_id is null then null else v_list.name end, 'kind', 'static', 'dry_run', coalesce(p_dry_run, false),
    'rows', v_rows, 'invalid', v_rows - v_valid, 'duplicate', v_dup, 'matched', v_matched,
    'unmatched', v_valid - v_dup - v_matched, 'members', cardinality(v_ids),
    'with_phone', (v_counts->>'with_phone')::int, 'with_email', (v_counts->>'with_email')::int,
    'consented', (v_counts->>'consented')::int, 'sample', v_sample);
end $$;

-- ── live count of one saved list ────────────────────────────────────────────────────
create or replace function public.comm_list_count(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare v_list public.comm_lists; v jsonb;
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  select * into v_list from public.comm_lists l where l.id = p_id and l.deleted_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  if v_list.kind = 'static' then
    with a as (
      select p.id as uid, public.comm__phone91(p.phone) as phone91, nullif(btrim(p.email), '') as email,
             coalesce(p.consent_given, false) as consent, p.created_at
        from public.comm_list_members mb join public.profiles p on p.id = mb.user_id
       where mb.list_id = v_list.id
    )
    select jsonb_build_object(
             'kind', 'static', 'total', count(*),
             'with_phone', count(*) filter (where a.phone91 is not null),
             'with_email', count(*) filter (where a.email is not null),
             'consented', count(*) filter (where a.consent),
             'sample', coalesce((select jsonb_agg(jsonb_build_object('phone', public.comm__mask_phone(s.phone91), 'email', public.comm__mask_email(s.email),
                                                                      'consent', s.consent) order by s.created_at desc, s.uid)
                                   from (select * from a order by a.created_at desc, a.uid limit 10) s), '[]'::jsonb))
      into v from a;
  else
    with a as (select * from public.comm__audience(v_list.conditions))
    select jsonb_build_object(
             'kind', 'dynamic', 'total', count(*),
             'with_phone', count(*) filter (where a.phone91 is not null),
             'with_email', count(*) filter (where a.email is not null),
             'consented', count(*) filter (where a.consent),
             'sample', coalesce((select jsonb_agg(jsonb_build_object('phone', public.comm__mask_phone(s.phone91), 'email', public.comm__mask_email(s.email),
                                                                      'consent', s.consent) order by s.created_at desc, s.uid)
                                   from (select * from a order by a.created_at desc, a.uid limit 10) s), '[]'::jsonb))
      into v from a;
  end if;
  return v;
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────────
revoke all on function public.comm__list_members_on_delete() from public, anon, authenticated;
revoke all on function public.comm_list_import(text, jsonb, boolean) from public, anon;
revoke all on function public.comm_list_count(uuid) from public, anon;
grant execute on function public.comm_list_import(text, jsonb, boolean) to authenticated;
grant execute on function public.comm_list_count(uuid) to authenticated;
