-- 0132 · Growth → Marketing channels → Telegram Channel → Telegram Listing (admin only)
--
-- Ports the vedamcrm360 "Telegram Listing" page into Vedam One, on Vedam One's own data. New objects only, except
-- growth_campaign_delete (0105), which now also refuses to delete a VSAT campaign that a Telegram row uses.
-- Nothing of Ads / Influencers / Consultants is changed; their helpers are called, not redefined.
--
-- One row = one Telegram influencer UTM link used in one VSAT campaign ("Used In" → vsat_campaigns, as Ads / Influencers).
-- The same UTM may be listed once per VSAT; the same UTM twice in the same VSAT is refused (it would count twice).
-- Numbers are worked out live by growth_tg_list (nothing stored), so "Refresh attribution" simply reloads.
-- Same rules as Ads / Influencers (growth__row_attr, 0105 + 0122):
--   Leads (all-time)        = lead_manager rows whose primary (first-touch) UTM equals the row's UTM key (growth__leads);
--                             staff (@vedam.org) left out.
--   Leads (in-window)       = those leads that registered (IST day) between the campaign's start and end.
--   Payments / Enrollments  = those leads with a vsat_payments row / an approved enrolment (in-window = of the in-window
--                             leads, whenever they paid / enrolled; all-time = of all the leads).
--   CPL, CPA                = typed in by the team (₹ per lead / per payment).
--   CPL Spend = CPL × Leads (in-window) · CPA Spend = CPA × Payments (in-window) · Total Spend = CPL Spend + CPA Spend
--                             (worked out on screen, as the CRM's refresh does).
--
-- Columns: the 12 CRM columns are rows of growth_tg_columns (is_standard): rename / hide / reorder, not delete.
-- "Add Column" adds a custom column (Text / Number / Date / URL) whose values live in the row's `extra` jsonb.
-- Trash: rows in the trash for more than 30 days are deleted by the daily pg_cron job growth-tg-trash-purge.
--
-- Security: admin only (growth__admin). Tables: RLS on, no policies, no grants. Public RPCs: SECURITY DEFINER,
-- search_path '', unknown request keys refused (growth__keys), revoked from public/anon, granted to authenticated.
-- Private helpers (growth__tg_*) are not callable by browsers. Audit history through public.audit_trigger().
--
-- Rollback: supabase/rollback/0132_growth_telegram_listing_down.sql
-- Tests:    supabase/tests/growth_telegram_listing.test.sql

-- ═══════════════════════════════ tables ═══════════════════════════════

create table if not exists public.growth_tg_rows (
  id              uuid primary key default gen_random_uuid(),
  influencer_name text not null check (char_length(influencer_name) between 1 and 120),
  utm_link        text not null check (char_length(utm_link) between 1 and 2000),
  campaign_id     uuid not null references public.vsat_campaigns(id),
  cpl             numeric(14,2) not null default 0 check (cpl >= 0),
  cpa             numeric(14,2) not null default 0 check (cpa >= 0),
  extra           jsonb not null default '{}'::jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
-- one live row per UTM link per VSAT (the save / restore functions also compare the normalised source/medium/campaign)
create unique index if not exists growth_tg_rows_utm on public.growth_tg_rows (lower(btrim(utm_link)), campaign_id) where deleted_at is null;
create index if not exists growth_tg_rows_campaign on public.growth_tg_rows (campaign_id);

create table if not exists public.growth_tg_columns (
  id            uuid primary key default gen_random_uuid(),
  col_key       text not null check (col_key ~ '^[a-z][a-z0-9_]{1,42}$'),
  label         text not null check (char_length(label) between 1 and 60),
  col_type      text not null check (col_type in ('text', 'number', 'date', 'url', 'select', 'computed')),
  required      boolean not null default false,
  is_standard   boolean not null default false,
  is_hidden     boolean not null default false,
  display_order int not null default 0,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  check (is_standard or (col_key ~ '^x_' and col_type in ('text', 'number', 'date', 'url')))
);
create unique index if not exists growth_tg_columns_key on public.growth_tg_columns (col_key) where deleted_at is null;

alter table public.growth_tg_rows    enable row level security;
alter table public.growth_tg_columns enable row level security;
revoke all on table public.growth_tg_rows, public.growth_tg_columns from public, anon, authenticated;

create trigger trg_audit_growth_tg_rows
  after insert or update or delete on public.growth_tg_rows
  for each row execute function public.audit_trigger();
create trigger trg_audit_growth_tg_columns
  after insert or update or delete on public.growth_tg_columns
  for each row execute function public.audit_trigger();

-- the 12 CRM columns, in the CRM's order
insert into public.growth_tg_columns (col_key, label, col_type, required, is_standard, display_order)
select v.k, v.l, v.t, v.r, true, v.o
  from (values
    ('serial_no',       'Serial No',       'computed', false,  1),
    ('influencer_name', 'Influencer Name', 'text',     true,   2),
    ('utm_link',        'UTM Link',        'url',      true,   3),
    ('used_in',         'Used In',         'select',   true,   4),
    ('cpl',             'CPL',             'number',   false,  5),
    ('cpa',             'CPA',             'number',   false,  6),
    ('cpl_spend',       'CPL Spend',       'computed', false,  7),
    ('cpa_spend',       'CPA Spend',       'computed', false,  8),
    ('total_spend',     'Total Spend',     'computed', false,  9),
    ('leads',           'Leads',           'computed', false, 10),
    ('payments',        'Payments',        'computed', false, 11),
    ('enrollments',     'Enrollments',     'computed', false, 12)
  ) as v(k, l, t, r, o)
 where not exists (select 1 from public.growth_tg_columns c where c.col_key = v.k and c.deleted_at is null);

-- ═══════════════════════════════ private helpers ═══════════════════════════════

-- uuid list from a request ({ids: [...]}, 1..2000)
create or replace function public.growth__tg_ids(p jsonb)
returns uuid[] language plpgsql immutable set search_path to '' as $fn$
declare v uuid[];
begin
  if jsonb_typeof(p->'ids') is distinct from 'array' or jsonb_array_length(p->'ids') = 0 or jsonb_array_length(p->'ids') > 2000 then
    raise exception 'BAD_VALUE: ids' using errcode = '22023';
  end if;
  begin select array_agg(distinct x::uuid) into v from jsonb_array_elements_text(p->'ids') x;
  exception when others then raise exception 'BAD_VALUE: ids' using errcode = '22023'; end;
  return v;
end $fn$;

-- custom values of a row: only live custom columns, each value checked; required ones present
create or replace function public.growth__tg_extra(p_extra jsonb, p_old jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare out jsonb := coalesce(p_old, '{}'::jsonb); c record; k text; v text;
begin
  if p_extra is not null and jsonb_typeof(p_extra) not in ('object', 'null') then raise exception 'BAD_VALUE: extra' using errcode = '22023'; end if;
  if jsonb_typeof(p_extra) = 'object' then
    for k in select jsonb_object_keys(p_extra) loop
      if not exists (select 1 from public.growth_tg_columns where col_key = k and not is_standard and deleted_at is null) then
        raise exception 'UNKNOWN_KEY: %', k using errcode = '22023';
      end if;
    end loop;
  end if;
  for c in select * from public.growth_tg_columns where not is_standard and deleted_at is null loop
    if jsonb_typeof(p_extra) = 'object' and p_extra ? c.col_key then
      if c.col_type = 'number' then v := public.growth__num(p_extra, c.col_key, -1e12, 1e12)::text;
      elsif c.col_type = 'date' then v := public.growth__date(p_extra, c.col_key)::text;
      elsif c.col_type = 'url' then v := public.growth__url(p_extra, c.col_key);
      else v := public.growth__txt(p_extra, c.col_key, 500);
      end if;
      out := case when v is null then out - c.col_key else out || jsonb_build_object(c.col_key, v) end;
    end if;
    if c.required and nullif(out->>c.col_key, '') is null then
      raise exception 'REQUIRED: %', c.col_key using errcode = '22023';
    end if;
  end loop;
  return out;
end $fn$;

-- a live row as a save request (used by bulk update and CSV upsert)
create or replace function public.growth__tg_obj(p_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $fn$
  select jsonb_build_object('id', r.id, 'influencer_name', r.influencer_name, 'utm_link', r.utm_link, 'used_in', r.campaign_id::text,
           'cpl', r.cpl::text, 'cpa', r.cpa::text)
    from public.growth_tg_rows r where r.id = p_id and r.deleted_at is null;
$fn$;

-- the live row (other than p_id) that already uses this UTM link in this VSAT (same text, or same source/medium/campaign)
create or replace function public.growth__tg_utm_owner(p_link text, p_campaign uuid, p_id uuid)
returns text language sql stable security definer set search_path to '' as $fn$
  select r.influencer_name from public.growth_tg_rows r
   where r.deleted_at is null and r.id is distinct from p_id and r.campaign_id = p_campaign
     and (lower(btrim(r.utm_link)) = lower(btrim(p_link))
          or (public.growth__utm_key(p_link) is not null and public.growth__utm_key(r.utm_link) = public.growth__utm_key(p_link)))
   order by r.created_at, r.id limit 1;
$fn$;

-- add or edit one live row; returns its id. Every value is checked here.
create or replace function public.growth__tg_save(p jsonb)
returns uuid language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid := null; v_old jsonb; v_extra jsonb; v_name text; v_utm text; v_camp uuid; v_dup text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  perform public.growth__keys(p, array['id', 'influencer_name', 'utm_link', 'used_in', 'cpl', 'cpa', 'extra']);
  if p ? 'id' and jsonb_typeof(p->'id') <> 'null' then
    begin v_id := (p->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
    select extra into v_old from public.growth_tg_rows where id = v_id and deleted_at is null;
    if not found then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  end if;

  v_name := public.growth__txt(p, 'influencer_name', 120);
  if v_name is null then raise exception 'REQUIRED: influencer_name' using errcode = '22023'; end if;
  v_utm := public.growth__url(p, 'utm_link');
  if v_utm is null then raise exception 'REQUIRED: utm_link' using errcode = '22023'; end if;
  v_camp := public.growth__campaign_id(p, 'used_in');   -- campaign id or name; unknown → BAD_VALUE: used_in
  if v_camp is null then raise exception 'REQUIRED: used_in' using errcode = '22023'; end if;
  v_extra := public.growth__tg_extra(p->'extra', v_old);

  v_dup := public.growth__tg_utm_owner(v_utm, v_camp, v_id);
  if v_dup is not null then raise exception 'DUPLICATE_UTM' using errcode = '22023', detail = v_dup; end if;

  begin
    if v_id is null then
      insert into public.growth_tg_rows (influencer_name, utm_link, campaign_id, cpl, cpa, extra, created_by)
      values (v_name, v_utm, v_camp, coalesce(public.growth__num(p, 'cpl', 0, 1e9), 0), coalesce(public.growth__num(p, 'cpa', 0, 1e9), 0),
              v_extra, auth.uid())
      returning id into v_id;
    else
      update public.growth_tg_rows set
        influencer_name = v_name, utm_link = v_utm, campaign_id = v_camp,
        cpl = coalesce(public.growth__num(p, 'cpl', 0, 1e9), 0), cpa = coalesce(public.growth__num(p, 'cpa', 0, 1e9), 0),
        extra = v_extra, updated_at = now()
      where id = v_id;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_UTM' using errcode = '22023';
  end;
  return v_id;
end $fn$;

-- per row of a view: in-window + all-time attribution (see header; same rule as growth__row_attr)
create or replace function public.growth__tg_attr(p_trash boolean)
returns table (id uuid, utm_key text, leads int, payments int, enrollments int, leads_all int, payments_all int, enrollments_all int)
language sql stable security definer set search_path to '' as $fn$
  with r as materialized (
    select a.id, public.growth__utm_key(a.utm_link) k, c.campaign_start s, c.campaign_end e
      from public.growth_tg_rows a left join public.vsat_campaigns c on c.id = a.campaign_id
     where (a.deleted_at is not null) = p_trash
  ), l as materialized (
    select * from public.growth__leads(array(select distinct r.k from r where r.k is not null))
  ), allt as (
    select l.k, count(*)::int n, count(l.paid_d)::int p, count(l.enrolled_d)::int en from l group by l.k
  ), win as (
    select r.id, count(l.lead_id)::int n, count(l.paid_d)::int p, count(l.enrolled_d)::int en
      from r join l on l.k = r.k and r.s is not null and r.e is not null and l.created_d between r.s and r.e
     group by r.id
  )
  select r.id, r.k, coalesce(win.n, 0), coalesce(win.p, 0), coalesce(win.en, 0),
         coalesce(allt.n, 0), coalesce(allt.p, 0), coalesce(allt.en, 0)
    from r left join allt on allt.k = r.k left join win on win.id = r.id;
$fn$;

-- daily: rows in the trash for more than 30 days are deleted
create or replace function public.growth__tg_purge_old()
returns int language plpgsql security definer set search_path to '' as $fn$
declare n int;
begin
  delete from public.growth_tg_rows where deleted_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $fn$;

-- ═══════════════════════════════ public RPCs ═══════════════════════════════

-- { view: 'active' | 'trash' } → { rows, counts, columns, campaigns }
create or replace function public.growth_tg_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v_trash boolean; v_rows jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['view']);
  if coalesce(p->>'view', 'active') not in ('active', 'trash') then raise exception 'BAD_VALUE: view' using errcode = '22023'; end if;
  v_trash := coalesce(p->>'view', 'active') = 'trash';
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'influencer_name', r.influencer_name, 'utm_link', r.utm_link, 'campaign_id', r.campaign_id, 'used_in', c.name,
      'cpl', r.cpl, 'cpa', r.cpa, 'extra', r.extra, 'created_at', r.created_at, 'updated_at', r.updated_at, 'deleted_at', r.deleted_at,
      'utm_key', t.utm_key, 'leads', t.leads, 'payments', t.payments, 'enrollments', t.enrollments,
      'leads_all', t.leads_all, 'payments_all', t.payments_all, 'enrollments_all', t.enrollments_all)
      order by r.updated_at desc, r.id), '[]'::jsonb)
    into v_rows
    from public.growth_tg_rows r
    join public.growth__tg_attr(v_trash) t on t.id = r.id
    left join public.vsat_campaigns c on c.id = r.campaign_id;
  return jsonb_build_object(
    'rows', v_rows,
    'counts', jsonb_build_object('active', (select count(*) from public.growth_tg_rows where deleted_at is null),
                                 'trash',  (select count(*) from public.growth_tg_rows where deleted_at is not null)),
    'columns', coalesce((select jsonb_agg(jsonb_build_object('key', c.col_key, 'label', c.label, 'type', c.col_type,
        'required', c.required, 'standard', c.is_standard, 'hidden', c.is_hidden) order by c.display_order, c.created_at)
        from public.growth_tg_columns c where c.deleted_at is null), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'campaign_start', c.campaign_start,
        'campaign_end', c.campaign_end) order by c.campaign_start desc nulls last, c.name)
        from public.vsat_campaigns c), '[]'::jsonb));
end $fn$;

-- { row: {...} } → { id }   (add when row.id is missing)
create or replace function public.growth_tg_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['row']);
  if jsonb_typeof(p->'row') is distinct from 'object' then raise exception 'BAD_VALUE: row' using errcode = '22023'; end if;
  return jsonb_build_object('id', public.growth__tg_save(p->'row'));
end $fn$;

-- { ids, key, value } → { changed }   one column for several live rows (also the inline Used In dropdown).
-- Not for the UTM link (one per row), computed columns or unknown keys.
create or replace function public.growth_tg_bulk_update(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_ids uuid[]; k text; v_id uuid; o jsonb; n int := 0; v_custom boolean;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['ids', 'key', 'value']);
  v_ids := public.growth__tg_ids(p);
  if jsonb_typeof(p->'key') is distinct from 'string' then raise exception 'BAD_VALUE: key' using errcode = '22023'; end if;
  k := p->>'key';
  if p ? 'value' and jsonb_typeof(p->'value') not in ('string', 'number', 'null') then raise exception 'BAD_VALUE: value' using errcode = '22023'; end if;
  if k in ('influencer_name', 'used_in', 'cpl', 'cpa') then
    v_custom := false;
  elsif exists (select 1 from public.growth_tg_columns where col_key = k and not is_standard and deleted_at is null) then
    v_custom := true;
  else
    raise exception 'BAD_VALUE: key' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.growth_tg_rows r where r.id = x and r.deleted_at is null)) then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  foreach v_id in array v_ids loop
    o := public.growth__tg_obj(v_id);
    if v_custom then o := o || jsonb_build_object('extra', jsonb_build_object(k, coalesce(p->'value', 'null'::jsonb)));
    else o := o || jsonb_build_object(k, coalesce(p->'value', 'null'::jsonb)); end if;
    perform public.growth__tg_save(o);
    n := n + 1;
  end loop;
  return jsonb_build_object('changed', n);
end $fn$;

-- { ids, trash: true|false } → { changed }   move to trash / restore (restore refuses a UTM that is live again in that VSAT)
create or replace function public.growth_tg_trash(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_ids uuid[]; n int; v_dup text;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['ids', 'trash']);
  v_ids := public.growth__tg_ids(p);
  if jsonb_typeof(p->'trash') is distinct from 'boolean' then raise exception 'BAD_VALUE: trash' using errcode = '22023'; end if;
  if (p->>'trash')::boolean then
    update public.growth_tg_rows set deleted_at = now(), updated_at = now() where id = any (v_ids) and deleted_at is null;
    get diagnostics n = row_count;
  else
    begin
      update public.growth_tg_rows set deleted_at = null, updated_at = now() where id = any (v_ids) and deleted_at is not null;
      get diagnostics n = row_count;
    exception when unique_violation then
      raise exception 'DUPLICATE_UTM' using errcode = '22023';
    end;
    select a.influencer_name into v_dup
      from public.growth_tg_rows a join public.growth_tg_rows b on a.id < b.id and a.campaign_id = b.campaign_id
     where a.deleted_at is null and b.deleted_at is null and (a.id = any (v_ids) or b.id = any (v_ids))
       and public.growth__utm_key(a.utm_link) is not null and public.growth__utm_key(a.utm_link) = public.growth__utm_key(b.utm_link)
     limit 1;
    if v_dup is not null then raise exception 'DUPLICATE_UTM' using errcode = '22023', detail = v_dup; end if;
  end if;
  return jsonb_build_object('changed', n);
end $fn$;

-- { ids } → { deleted }   delete for good (trash only)
create or replace function public.growth_tg_purge(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_ids uuid[]; n int;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['ids']);
  v_ids := public.growth__tg_ids(p);
  delete from public.growth_tg_rows where id = any (v_ids) and deleted_at is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('deleted', n);
end $fn$;

-- CSV upload, all or nothing: { rows: [{...}], mode: 'add' | 'upsert' } → { added, updated }
-- upsert: a row whose UTM link and Used In match a live row updates the values given in the file and keeps the others
create or replace function public.growth_tg_import(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare r jsonb; i int := 0; errs jsonb := '[]'::jsonb; v_mode text; v_id uuid; v_camp uuid; o jsonb; v_add int := 0; v_upd int := 0;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['rows', 'mode']);
  v_mode := coalesce(p->>'mode', 'upsert');
  if v_mode not in ('add', 'upsert') then raise exception 'BAD_VALUE: mode' using errcode = '22023'; end if;
  if jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows') = 0 then raise exception 'BAD_VALUE: rows' using errcode = '22023'; end if;
  if jsonb_array_length(p->'rows') > 2000 then raise exception 'TOO_MANY_ROWS' using errcode = '22023'; end if;
  for r in select x from jsonb_array_elements(p->'rows') x loop
    i := i + 1;
    begin
      if jsonb_typeof(r) <> 'object' or r ? 'id' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
      v_id := null;
      if v_mode = 'upsert' and jsonb_typeof(r->'utm_link') = 'string' and jsonb_typeof(r->'used_in') = 'string' then
        v_camp := public.growth__campaign_id(r, 'used_in');
        select x.id into v_id from public.growth_tg_rows x
         where x.deleted_at is null and x.campaign_id = v_camp
           and (lower(btrim(x.utm_link)) = lower(btrim(r->>'utm_link'))
                or (public.growth__utm_key(r->>'utm_link') is not null and public.growth__utm_key(x.utm_link) = public.growth__utm_key(r->>'utm_link')))
         order by x.created_at, x.id limit 1;
      end if;
      if v_id is null then
        perform public.growth__tg_save(r); v_add := v_add + 1;
      else
        o := public.growth__tg_obj(v_id) || (r - 'utm_link' - 'used_in');
        perform public.growth__tg_save(o); v_upd := v_upd + 1;
      end if;
    exception when sqlstate '22023' then
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_object('row', i, 'error', sqlerrm); end if;
    end;
  end loop;
  if jsonb_array_length(errs) > 0 then raise exception 'IMPORT_FAILED' using errcode = 'P0001', detail = errs::text; end if;
  return jsonb_build_object('added', v_add, 'updated', v_upd);
end $fn$;

-- { label, type: text|number|date|url, required? } → { key }   (a removed column's name reuses its key)
create or replace function public.growth_tg_col_add(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_label text; v_type text; v_base text; v_key text; v_n int := 1;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['label', 'type', 'required']);
  v_label := public.growth__txt(p, 'label', 60);
  if v_label is null then raise exception 'REQUIRED: label' using errcode = '22023'; end if;
  v_type := coalesce(p->>'type', '');
  if v_type not in ('text', 'number', 'date', 'url') then raise exception 'BAD_VALUE: type' using errcode = '22023'; end if;
  if p ? 'required' and jsonb_typeof(p->'required') <> 'boolean' then raise exception 'BAD_VALUE: required' using errcode = '22023'; end if;
  if exists (select 1 from public.growth_tg_columns where deleted_at is null and lower(label) = lower(v_label)) then
    raise exception 'DUPLICATE' using errcode = '22023';
  end if;
  if (select count(*) from public.growth_tg_columns where not is_standard and deleted_at is null) >= 30 then
    raise exception 'TOO_MANY_COLUMNS' using errcode = '22023';
  end if;
  v_base := 'x_' || coalesce(nullif(left(trim(both '_' from regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g')), 32), ''), 'col');
  v_key := v_base;
  while exists (select 1 from public.growth_tg_columns where col_key = v_key and deleted_at is null) loop
    v_n := v_n + 1; v_key := v_base || '_' || v_n;
  end loop;
  insert into public.growth_tg_columns (col_key, label, col_type, required, is_standard, display_order, created_by)
  values (v_key, v_label, v_type, coalesce((p->>'required')::boolean, false), false,
          (select coalesce(max(display_order), 0) + 1 from public.growth_tg_columns where deleted_at is null), auth.uid());
  return jsonb_build_object('key', v_key);
end $fn$;

-- { key, label?, hidden? } → { ok }   rename / hide / unhide any column
create or replace function public.growth_tg_col_update(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_label text;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['key', 'label', 'hidden']);
  if not exists (select 1 from public.growth_tg_columns where col_key = p->>'key' and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  if p ? 'label' then
    v_label := public.growth__txt(p, 'label', 60);
    if v_label is null then raise exception 'REQUIRED: label' using errcode = '22023'; end if;
    if exists (select 1 from public.growth_tg_columns where deleted_at is null and lower(label) = lower(v_label) and col_key <> p->>'key') then
      raise exception 'DUPLICATE' using errcode = '22023';
    end if;
    update public.growth_tg_columns set label = v_label where col_key = p->>'key' and deleted_at is null;
  end if;
  if p ? 'hidden' then
    if jsonb_typeof(p->'hidden') <> 'boolean' then raise exception 'BAD_VALUE: hidden' using errcode = '22023'; end if;
    update public.growth_tg_columns set is_hidden = (p->>'hidden')::boolean where col_key = p->>'key' and deleted_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

-- {} → { changed }
create or replace function public.growth_tg_col_unhide_all(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare n int;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array[]::text[]);
  update public.growth_tg_columns set is_hidden = false where is_hidden and deleted_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('changed', n);
end $fn$;

-- { keys: [every live column key, in the new order] } → { ok }
create or replace function public.growth_tg_col_order(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_keys text[];
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['keys']);
  if jsonb_typeof(p->'keys') is distinct from 'array' or jsonb_array_length(p->'keys') > 100 then raise exception 'BAD_VALUE: keys' using errcode = '22023'; end if;
  select array_agg(x order by o) into v_keys from jsonb_array_elements_text(p->'keys') with ordinality t(x, o);
  if cardinality(v_keys) <> (select count(distinct x) from unnest(v_keys) x)
     or (select array_agg(x order by x) from unnest(v_keys) x)
        is distinct from (select array_agg(col_key order by col_key) from public.growth_tg_columns where deleted_at is null) then
    raise exception 'BAD_VALUE: keys' using errcode = '22023';
  end if;
  update public.growth_tg_columns c set display_order = t.o
    from unnest(v_keys) with ordinality t(k, o) where c.col_key = t.k and c.deleted_at is null;
  return jsonb_build_object('ok', true);
end $fn$;

-- { key } → { ok }   remove an added column (the 12 CRM columns can only be renamed or hidden)
create or replace function public.growth_tg_col_remove(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_std boolean;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['key']);
  select is_standard into v_std from public.growth_tg_columns where col_key = p->>'key' and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  if v_std then raise exception 'SYSTEM_COLUMN' using errcode = '22023'; end if;
  update public.growth_tg_columns set deleted_at = now() where col_key = p->>'key' and deleted_at is null;
  return jsonb_build_object('ok', true);
end $fn$;

-- ═══════════════════════════════ campaigns: a campaign used by a Telegram row cannot be deleted ═══════════════════════════════

create or replace function public.growth_campaign_delete(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['id']);
  begin v_id := (p->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  if v_id is null or not exists (select 1 from public.vsat_campaigns where id = v_id) then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  if exists (select 1 from public.growth_ad_rows where campaign_id = v_id) or exists (select 1 from public.growth_infl_posts where campaign_id = v_id)
     or exists (select 1 from public.growth_tg_rows where campaign_id = v_id) then   -- 0132: Telegram rows too
    raise exception 'IN_USE' using errcode = '22023';
  end if;
  delete from public.vsat_campaigns where id = v_id;
  return jsonb_build_object('ok', true);
end $fn$;

-- ═══════════════════════════════ grants ═══════════════════════════════

revoke all on function public.growth__tg_ids(jsonb)                  from public, anon, authenticated;
revoke all on function public.growth__tg_extra(jsonb, jsonb)         from public, anon, authenticated;
revoke all on function public.growth__tg_obj(uuid)                   from public, anon, authenticated;
revoke all on function public.growth__tg_utm_owner(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.growth__tg_save(jsonb)                 from public, anon, authenticated;
revoke all on function public.growth__tg_attr(boolean)               from public, anon, authenticated;
revoke all on function public.growth__tg_purge_old()                 from public, anon, authenticated;

revoke all on function public.growth_tg_list(jsonb)            from public, anon;
revoke all on function public.growth_tg_save(jsonb)            from public, anon;
revoke all on function public.growth_tg_bulk_update(jsonb)     from public, anon;
revoke all on function public.growth_tg_trash(jsonb)           from public, anon;
revoke all on function public.growth_tg_purge(jsonb)           from public, anon;
revoke all on function public.growth_tg_import(jsonb)          from public, anon;
revoke all on function public.growth_tg_col_add(jsonb)         from public, anon;
revoke all on function public.growth_tg_col_update(jsonb)      from public, anon;
revoke all on function public.growth_tg_col_unhide_all(jsonb)  from public, anon;
revoke all on function public.growth_tg_col_order(jsonb)       from public, anon;
revoke all on function public.growth_tg_col_remove(jsonb)      from public, anon;
revoke all on function public.growth_campaign_delete(jsonb)    from public, anon;
grant execute on function public.growth_tg_list(jsonb)           to authenticated;
grant execute on function public.growth_tg_save(jsonb)           to authenticated;
grant execute on function public.growth_tg_bulk_update(jsonb)    to authenticated;
grant execute on function public.growth_tg_trash(jsonb)          to authenticated;
grant execute on function public.growth_tg_purge(jsonb)          to authenticated;
grant execute on function public.growth_tg_import(jsonb)         to authenticated;
grant execute on function public.growth_tg_col_add(jsonb)        to authenticated;
grant execute on function public.growth_tg_col_update(jsonb)     to authenticated;
grant execute on function public.growth_tg_col_unhide_all(jsonb) to authenticated;
grant execute on function public.growth_tg_col_order(jsonb)      to authenticated;
grant execute on function public.growth_tg_col_remove(jsonb)     to authenticated;
grant execute on function public.growth_campaign_delete(jsonb)   to authenticated;

-- ═══════════════════════════════ trash clean-up ═══════════════════════════════

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('growth-tg-trash-purge', '43 3 * * *', 'select public.growth__tg_purge_old()');
  else
    raise notice 'pg_cron is not installed: run select public.growth__tg_purge_old() daily some other way';
  end if;
end $$;
