-- 0136 · Growth → Marketing channels → Vedantu Channel → Vedantu Listing (admin only)
--
-- Ports the vedamcrm360 "Vedantu Listing" page into Vedam One, on Vedam One's own data. New objects only, except
-- growth_campaign_delete (0132), which now also refuses to delete a VSAT campaign whose dates hold a Vedantu video.
-- Nothing of Ads / Influencers / Consultants / Telegram is changed; their helpers are called, not redefined.
--
-- One row = one Vedantu video (channel, live link, UTM link, live date, views, spend). Same rules as the CRM:
--   Campaign                = the VSAT campaign whose dates (campaign_start..campaign_end) hold the Live Date. Worked out live,
--                             never typed (the CRM's Refresh does the same). Latest start wins if two campaigns overlap; none → empty.
--   Leads (in window)       = leads whose primary (first-touch) UTM equals the row's UTM key (growth__leads, staff @vedam.org
--                             left out) and who registered (IST day) between that campaign's start and end.
--   Payments / Enrollments  = those leads with a vsat_payments row / an approved enrolment (in window = of the in-window leads;
--                             all time = of all the leads with that UTM).
--   Total CPA   = CPA × Payments (ALL TIME)       Total Spend = Video Spend + Total CPA      (worked out on screen)
--   Serial No   = a counter in Live Date order (worked out on screen), hidden by default as on the CRM.
-- The same UTM twice in the same VSAT (by Live Date) is refused: a second row would count the same leads twice.
-- No YouTube call is made: Actual Views is typed or uploaded (the CRM's "Sync YouTube views" is not ported).
--
-- Columns: the CRM columns are rows of growth_vd_columns (is_standard): rename / hide / reorder, not delete.
-- "Add Column" adds a custom column (Text / Number / Date / URL) whose values live in the row's `extra` jsonb.
-- Trash: rows in the trash for more than 30 days are deleted by the daily pg_cron job growth-vd-trash-purge.
--
-- Speed (lesson of 0133): the UTM key is kept on the row (trigger) and indexed.
-- Security: admin only (growth__admin). Tables: RLS on, no policies, no grants. Public RPCs: SECURITY DEFINER,
-- search_path '', unknown request keys refused (growth__keys), revoked from public/anon, granted to authenticated.
-- Private helpers (growth__vd_*) are not callable by browsers. Audit history through public.audit_trigger().
--
-- Rollback: supabase/rollback/0136_growth_vedantu_listing_down.sql
-- Tests:    supabase/tests/growth_vedantu_listing.test.sql

-- ═══════════════════════════════ tables ═══════════════════════════════

create table if not exists public.growth_vd_rows (
  id             uuid primary key default gen_random_uuid(),
  channel        text not null check (char_length(channel) between 1 and 120),
  live_link      text check (live_link is null or char_length(live_link) <= 2000),
  utm_link       text not null check (char_length(utm_link) between 1 and 2000),
  live_date      date not null,
  expected_views bigint check (expected_views is null or expected_views >= 0),
  actual_views   bigint check (actual_views is null or actual_views >= 0),
  video_spend    numeric(14,2) not null default 0 check (video_spend >= 0),
  cpa            numeric(14,2) not null default 0 check (cpa >= 0),
  notes          text check (notes is null or char_length(notes) <= 500),
  extra          jsonb not null default '{}'::jsonb,
  utm_key        text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists growth_vd_rows_key  on public.growth_vd_rows (utm_key) where deleted_at is null;
create index if not exists growth_vd_rows_text on public.growth_vd_rows (lower(btrim(utm_link))) where deleted_at is null;
create index if not exists growth_vd_rows_date on public.growth_vd_rows (live_date);

create table if not exists public.growth_vd_columns (
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
create unique index if not exists growth_vd_columns_key on public.growth_vd_columns (col_key) where deleted_at is null;

alter table public.growth_vd_rows    enable row level security;
alter table public.growth_vd_columns enable row level security;
revoke all on table public.growth_vd_rows, public.growth_vd_columns from public, anon, authenticated;

create trigger trg_audit_growth_vd_rows
  after insert or update or delete on public.growth_vd_rows
  for each row execute function public.audit_trigger();
create trigger trg_audit_growth_vd_columns
  after insert or update or delete on public.growth_vd_columns
  for each row execute function public.audit_trigger();

-- the UTM key of a row, set whenever the link is written
create or replace function public.growth__vd_key_trg()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  new.utm_key := public.growth__utm_key(new.utm_link);
  return new;
end $fn$;
revoke all on function public.growth__vd_key_trg() from public, anon, authenticated;
create trigger trg_growth_vd_rows_key before insert or update of utm_link on public.growth_vd_rows
  for each row execute function public.growth__vd_key_trg();

-- the CRM columns, in the CRM's order (Serial No is hidden by default, as on the CRM)
insert into public.growth_vd_columns (col_key, label, col_type, required, is_standard, is_hidden, display_order)
select v.k, v.l, v.t, v.r, true, v.h, v.o
  from (values
    ('serial_no',       'Serial No',             'computed', false, true,   1),
    ('channel',         'Channel',               'text',     true,  false,  2),
    ('live_link',       'Live Link',             'url',      false, false,  3),
    ('utm_link',        'UTM Link',              'url',      true,  false,  4),
    ('live_date',       'Live Date',             'date',     true,  false,  5),
    ('campaign',        'Campaign',              'computed', false, false,  6),
    ('expected_views',  'Expected Views',        'number',   false, false,  7),
    ('actual_views',    'Actual Views',          'number',   false, false,  8),
    ('video_spend',     'Video Spend',           'number',   false, false,  9),
    ('cpa',             'CPA',                   'number',   false, false, 10),
    ('total_cpa',       'Total CPA',             'computed', false, false, 11),
    ('total_spend',     'Total Spend',           'computed', false, false, 12),
    ('leads',           'Leads (In Window)',     'computed', false, false, 13),
    ('payments',        'Payments (In Window)',  'computed', false, false, 14),
    ('leads_all',       'Leads (All Time)',      'computed', false, false, 15),
    ('payments_all',    'Payments (All Time)',   'computed', false, false, 16),
    ('enrollments',     'Enrollments',           'computed', false, false, 17),
    ('notes',           'Notes',                 'text',     false, false, 18)
  ) as v(k, l, t, r, h, o)
 where not exists (select 1 from public.growth_vd_columns c where c.col_key = v.k and c.deleted_at is null);

-- ═══════════════════════════════ private helpers ═══════════════════════════════

-- uuid list from a request ({ids: [...]}, 1..2000)
create or replace function public.growth__vd_ids(p jsonb)
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

-- the VSAT campaign whose dates hold a day (latest start wins when two overlap; none → null)
create or replace function public.growth__vd_campaign(p_d date)
returns uuid language sql stable security definer set search_path to '' as $fn$
  select c.id from public.vsat_campaigns c
   where p_d is not null and c.campaign_start is not null and c.campaign_end is not null
     and p_d between c.campaign_start and c.campaign_end
   order by c.campaign_start desc, c.id limit 1;
$fn$;

-- custom values of a row: only live custom columns, each value checked; required ones present
create or replace function public.growth__vd_extra(p_extra jsonb, p_old jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare out jsonb := coalesce(p_old, '{}'::jsonb); c record; k text; v text;
begin
  if p_extra is not null and jsonb_typeof(p_extra) not in ('object', 'null') then raise exception 'BAD_VALUE: extra' using errcode = '22023'; end if;
  if jsonb_typeof(p_extra) = 'object' then
    for k in select jsonb_object_keys(p_extra) loop
      if not exists (select 1 from public.growth_vd_columns where col_key = k and not is_standard and deleted_at is null) then
        raise exception 'UNKNOWN_KEY: %', k using errcode = '22023';
      end if;
    end loop;
  end if;
  for c in select * from public.growth_vd_columns where not is_standard and deleted_at is null loop
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
create or replace function public.growth__vd_obj(p_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $fn$
  select jsonb_build_object('id', r.id, 'channel', r.channel, 'live_link', r.live_link, 'utm_link', r.utm_link,
           'live_date', r.live_date::text, 'expected_views', r.expected_views::text, 'actual_views', r.actual_views::text,
           'video_spend', r.video_spend::text, 'cpa', r.cpa::text, 'notes', r.notes)
    from public.growth_vd_rows r where r.id = p_id and r.deleted_at is null;
$fn$;

-- the live row (other than p_id) that already uses this UTM link in the VSAT of this Live Date
-- (same text, or same source/medium/campaign); returns its Channel
create or replace function public.growth__vd_utm_owner(p_link text, p_date date, p_id uuid)
returns text language plpgsql stable security definer set search_path to '' as $fn$
declare v_k text := public.growth__utm_key(p_link); v_l text := lower(btrim(p_link)); v_c uuid := public.growth__vd_campaign(p_date); v_name text;
begin
  select r.channel into v_name from public.growth_vd_rows r
   where r.deleted_at is null and r.id is distinct from p_id
     and (lower(btrim(r.utm_link)) = v_l or (v_k is not null and r.utm_key = v_k))
     and public.growth__vd_campaign(r.live_date) is not distinct from v_c
   order by r.created_at, r.id limit 1;
  return v_name;
end $fn$;

-- add or edit one live row; returns its id. Every value is checked here.
create or replace function public.growth__vd_save(p jsonb)
returns uuid language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid := null; v_old jsonb; v_extra jsonb; v_channel text; v_link text; v_utm text; v_date date; v_dup text;
        v_exp numeric; v_act numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  perform public.growth__keys(p, array['id', 'channel', 'live_link', 'utm_link', 'live_date', 'expected_views', 'actual_views',
                                       'video_spend', 'cpa', 'notes', 'extra']);
  if p ? 'id' and jsonb_typeof(p->'id') <> 'null' then
    begin v_id := (p->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
    select extra into v_old from public.growth_vd_rows where id = v_id and deleted_at is null;
    if not found then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  end if;

  v_channel := public.growth__txt(p, 'channel', 120);
  if v_channel is null then raise exception 'REQUIRED: channel' using errcode = '22023'; end if;
  v_link := public.growth__url(p, 'live_link');
  v_utm := public.growth__url(p, 'utm_link');
  if v_utm is null then raise exception 'REQUIRED: utm_link' using errcode = '22023'; end if;
  v_date := public.growth__date(p, 'live_date');
  if v_date is null then raise exception 'REQUIRED: live_date' using errcode = '22023'; end if;
  v_exp := public.growth__num(p, 'expected_views', 0, 1e12);
  v_act := public.growth__num(p, 'actual_views', 0, 1e12);
  v_extra := public.growth__vd_extra(p->'extra', v_old);

  -- two saves of the same UTM at once must not both pass the duplicate check
  perform pg_advisory_xact_lock(hashtextextended(coalesce(public.growth__utm_key(v_utm), lower(btrim(v_utm))), 0));
  v_dup := public.growth__vd_utm_owner(v_utm, v_date, v_id);
  if v_dup is not null then raise exception 'DUPLICATE_UTM' using errcode = '22023', detail = v_dup; end if;

  if v_id is null then
    insert into public.growth_vd_rows (channel, live_link, utm_link, live_date, expected_views, actual_views, video_spend, cpa, notes, extra, created_by)
    values (v_channel, v_link, v_utm, v_date, round(v_exp)::bigint, round(v_act)::bigint,
            coalesce(public.growth__num(p, 'video_spend', 0, 1e9), 0), coalesce(public.growth__num(p, 'cpa', 0, 1e9), 0),
            public.growth__txt(p, 'notes', 500), v_extra, auth.uid())
    returning id into v_id;
  else
    update public.growth_vd_rows set
      channel = v_channel, live_link = v_link, utm_link = v_utm, live_date = v_date,
      expected_views = round(v_exp)::bigint, actual_views = round(v_act)::bigint,
      video_spend = coalesce(public.growth__num(p, 'video_spend', 0, 1e9), 0), cpa = coalesce(public.growth__num(p, 'cpa', 0, 1e9), 0),
      notes = public.growth__txt(p, 'notes', 500), extra = v_extra, updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $fn$;

-- per row of a view: the VSAT of the Live Date + in-window and all-time attribution (see header)
create or replace function public.growth__vd_attr(p_trash boolean)
returns table (id uuid, utm_key text, campaign_id uuid, campaign text, leads int, payments int, enrollments int,
               leads_all int, payments_all int, enrollments_all int)
language sql stable security definer set search_path to '' as $fn$
  with r as materialized (
    select a.id, a.utm_key k, c.id cid, c.name cname, c.campaign_start s, c.campaign_end e
      from public.growth_vd_rows a
      left join lateral (select v.id, v.name, v.campaign_start, v.campaign_end from public.vsat_campaigns v
                          where v.campaign_start is not null and v.campaign_end is not null and a.live_date between v.campaign_start and v.campaign_end
                          order by v.campaign_start desc, v.id limit 1) c on true
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
  select r.id, r.k, r.cid, r.cname, coalesce(win.n, 0), coalesce(win.p, 0), coalesce(win.en, 0),
         coalesce(allt.n, 0), coalesce(allt.p, 0), coalesce(allt.en, 0)
    from r left join allt on allt.k = r.k left join win on win.id = r.id;
$fn$;

-- daily: rows in the trash for more than 30 days are deleted
create or replace function public.growth__vd_purge_old()
returns int language plpgsql security definer set search_path to '' as $fn$
declare n int;
begin
  delete from public.growth_vd_rows where deleted_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $fn$;

-- ═══════════════════════════════ public RPCs ═══════════════════════════════

-- { view: 'active' | 'trash' } → { rows, counts, columns }
create or replace function public.growth_vd_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v_trash boolean; v_rows jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['view']);
  if coalesce(p->>'view', 'active') not in ('active', 'trash') then raise exception 'BAD_VALUE: view' using errcode = '22023'; end if;
  v_trash := coalesce(p->>'view', 'active') = 'trash';
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'channel', r.channel, 'live_link', r.live_link, 'utm_link', r.utm_link, 'live_date', r.live_date,
      'campaign_id', t.campaign_id, 'campaign', t.campaign, 'expected_views', r.expected_views, 'actual_views', r.actual_views,
      'video_spend', r.video_spend, 'cpa', r.cpa, 'notes', r.notes, 'extra', r.extra,
      'created_at', r.created_at, 'updated_at', r.updated_at, 'deleted_at', r.deleted_at,
      'utm_key', t.utm_key, 'leads', t.leads, 'payments', t.payments, 'enrollments', t.enrollments,
      'leads_all', t.leads_all, 'payments_all', t.payments_all, 'enrollments_all', t.enrollments_all)
      order by r.live_date desc, r.created_at, r.id), '[]'::jsonb)
    into v_rows
    from public.growth_vd_rows r
    join public.growth__vd_attr(v_trash) t on t.id = r.id;
  return jsonb_build_object(
    'rows', v_rows,
    'counts', jsonb_build_object('active', (select count(*) from public.growth_vd_rows where deleted_at is null),
                                 'trash',  (select count(*) from public.growth_vd_rows where deleted_at is not null)),
    'columns', coalesce((select jsonb_agg(jsonb_build_object('key', c.col_key, 'label', c.label, 'type', c.col_type,
        'required', c.required, 'standard', c.is_standard, 'hidden', c.is_hidden) order by c.display_order, c.created_at)
        from public.growth_vd_columns c where c.deleted_at is null), '[]'::jsonb));
end $fn$;

-- { row: {...} } → { id }   (add when row.id is missing)
create or replace function public.growth_vd_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['row']);
  if jsonb_typeof(p->'row') is distinct from 'object' then raise exception 'BAD_VALUE: row' using errcode = '22023'; end if;
  return jsonb_build_object('id', public.growth__vd_save(p->'row'));
end $fn$;

-- { ids, key, value } → { changed }   one column for several live rows.
-- Not for the UTM link (one per row), computed columns or unknown keys.
create or replace function public.growth_vd_bulk_update(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_ids uuid[]; k text; v_id uuid; o jsonb; n int := 0; v_custom boolean;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['ids', 'key', 'value']);
  v_ids := public.growth__vd_ids(p);
  if jsonb_typeof(p->'key') is distinct from 'string' then raise exception 'BAD_VALUE: key' using errcode = '22023'; end if;
  k := p->>'key';
  if p ? 'value' and jsonb_typeof(p->'value') not in ('string', 'number', 'null') then raise exception 'BAD_VALUE: value' using errcode = '22023'; end if;
  if k in ('channel', 'live_link', 'live_date', 'expected_views', 'actual_views', 'video_spend', 'cpa', 'notes') then
    v_custom := false;
  elsif exists (select 1 from public.growth_vd_columns where col_key = k and not is_standard and deleted_at is null) then
    v_custom := true;
  else
    raise exception 'BAD_VALUE: key' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.growth_vd_rows r where r.id = x and r.deleted_at is null)) then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  foreach v_id in array v_ids loop
    o := public.growth__vd_obj(v_id);
    if v_custom then o := o || jsonb_build_object('extra', jsonb_build_object(k, coalesce(p->'value', 'null'::jsonb)));
    else o := o || jsonb_build_object(k, coalesce(p->'value', 'null'::jsonb)); end if;
    perform public.growth__vd_save(o);
    n := n + 1;
  end loop;
  return jsonb_build_object('changed', n);
end $fn$;

-- { ids, trash: true|false } → { changed }   move to trash / restore (restore refuses a UTM that is live again in that VSAT)
create or replace function public.growth_vd_trash(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_ids uuid[]; n int; v_dup text;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['ids', 'trash']);
  v_ids := public.growth__vd_ids(p);
  if jsonb_typeof(p->'trash') is distinct from 'boolean' then raise exception 'BAD_VALUE: trash' using errcode = '22023'; end if;
  if (p->>'trash')::boolean then
    update public.growth_vd_rows set deleted_at = now(), updated_at = now() where id = any (v_ids) and deleted_at is null;
    get diagnostics n = row_count;
  else
    update public.growth_vd_rows set deleted_at = null, updated_at = now() where id = any (v_ids) and deleted_at is not null;
    get diagnostics n = row_count;
    select a.channel into v_dup
      from public.growth_vd_rows a join public.growth_vd_rows b on a.id < b.id
     where a.deleted_at is null and b.deleted_at is null and (a.id = any (v_ids) or b.id = any (v_ids))
       and (lower(btrim(a.utm_link)) = lower(btrim(b.utm_link)) or (a.utm_key is not null and a.utm_key = b.utm_key))
       and public.growth__vd_campaign(a.live_date) is not distinct from public.growth__vd_campaign(b.live_date)
     limit 1;
    if v_dup is not null then raise exception 'DUPLICATE_UTM' using errcode = '22023', detail = v_dup; end if;
  end if;
  return jsonb_build_object('changed', n);
end $fn$;

-- { ids } → { deleted }   delete for good (trash only)
create or replace function public.growth_vd_purge(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_ids uuid[]; n int;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['ids']);
  v_ids := public.growth__vd_ids(p);
  delete from public.growth_vd_rows where id = any (v_ids) and deleted_at is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('deleted', n);
end $fn$;

-- CSV upload, all or nothing: { rows: [{...}], mode: 'add' | 'upsert' } → { added, updated }
-- upsert: a row whose UTM link (and, when the file has one, the VSAT of its Live Date) matches a live row updates the values
-- given in the file and keeps the others
create or replace function public.growth_vd_import(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare r jsonb; i int := 0; errs jsonb := '[]'::jsonb; v_mode text; v_id uuid; v_k text; v_c uuid; v_d date; o jsonb; v_add int := 0; v_upd int := 0;
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
      if v_mode = 'upsert' and jsonb_typeof(r->'utm_link') = 'string' then
        v_k := public.growth__utm_key(r->>'utm_link');
        v_d := public.growth__date(r, 'live_date');
        v_c := public.growth__vd_campaign(v_d);
        select x.id into v_id from public.growth_vd_rows x
         where x.deleted_at is null
           and (lower(btrim(x.utm_link)) = lower(btrim(r->>'utm_link')) or (v_k is not null and x.utm_key = v_k))
           and (v_d is null or public.growth__vd_campaign(x.live_date) is not distinct from v_c)
         order by x.created_at, x.id limit 1;
      end if;
      if v_id is null then
        perform public.growth__vd_save(r); v_add := v_add + 1;
      else
        o := public.growth__vd_obj(v_id) || (r - 'utm_link');
        perform public.growth__vd_save(o); v_upd := v_upd + 1;
      end if;
    exception when sqlstate '22023' then
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_object('row', i, 'error', sqlerrm); end if;
    end;
  end loop;
  if jsonb_array_length(errs) > 0 then raise exception 'IMPORT_FAILED' using errcode = 'P0001', detail = errs::text; end if;
  return jsonb_build_object('added', v_add, 'updated', v_upd);
end $fn$;

-- { label, type: text|number|date|url, required? } → { key }   (a removed column's name reuses its key)
create or replace function public.growth_vd_col_add(p jsonb)
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
  if exists (select 1 from public.growth_vd_columns where deleted_at is null and lower(label) = lower(v_label)) then
    raise exception 'DUPLICATE' using errcode = '22023';
  end if;
  if (select count(*) from public.growth_vd_columns where not is_standard and deleted_at is null) >= 30 then
    raise exception 'TOO_MANY_COLUMNS' using errcode = '22023';
  end if;
  v_base := 'x_' || coalesce(nullif(left(trim(both '_' from regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g')), 32), ''), 'col');
  v_key := v_base;
  while exists (select 1 from public.growth_vd_columns where col_key = v_key and deleted_at is null) loop
    v_n := v_n + 1; v_key := v_base || '_' || v_n;
  end loop;
  insert into public.growth_vd_columns (col_key, label, col_type, required, is_standard, display_order, created_by)
  values (v_key, v_label, v_type, coalesce((p->>'required')::boolean, false), false,
          (select coalesce(max(display_order), 0) + 1 from public.growth_vd_columns where deleted_at is null), auth.uid());
  return jsonb_build_object('key', v_key);
end $fn$;

-- { key, label?, hidden? } → { ok }   rename / hide / unhide any column
create or replace function public.growth_vd_col_update(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_label text;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['key', 'label', 'hidden']);
  if not exists (select 1 from public.growth_vd_columns where col_key = p->>'key' and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  if p ? 'label' then
    v_label := public.growth__txt(p, 'label', 60);
    if v_label is null then raise exception 'REQUIRED: label' using errcode = '22023'; end if;
    if exists (select 1 from public.growth_vd_columns where deleted_at is null and lower(label) = lower(v_label) and col_key <> p->>'key') then
      raise exception 'DUPLICATE' using errcode = '22023';
    end if;
    update public.growth_vd_columns set label = v_label where col_key = p->>'key' and deleted_at is null;
  end if;
  if p ? 'hidden' then
    if jsonb_typeof(p->'hidden') <> 'boolean' then raise exception 'BAD_VALUE: hidden' using errcode = '22023'; end if;
    update public.growth_vd_columns set is_hidden = (p->>'hidden')::boolean where col_key = p->>'key' and deleted_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

-- {} → { changed }
create or replace function public.growth_vd_col_unhide_all(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare n int;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array[]::text[]);
  update public.growth_vd_columns set is_hidden = false where is_hidden and deleted_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('changed', n);
end $fn$;

-- { keys: [every live column key, in the new order] } → { ok }
create or replace function public.growth_vd_col_order(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_keys text[];
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['keys']);
  if jsonb_typeof(p->'keys') is distinct from 'array' or jsonb_array_length(p->'keys') > 100 then raise exception 'BAD_VALUE: keys' using errcode = '22023'; end if;
  select array_agg(x order by o) into v_keys from jsonb_array_elements_text(p->'keys') with ordinality t(x, o);
  if cardinality(v_keys) <> (select count(distinct x) from unnest(v_keys) x)
     or (select array_agg(x order by x) from unnest(v_keys) x)
        is distinct from (select array_agg(col_key order by col_key) from public.growth_vd_columns where deleted_at is null) then
    raise exception 'BAD_VALUE: keys' using errcode = '22023';
  end if;
  update public.growth_vd_columns c set display_order = t.o
    from unnest(v_keys) with ordinality t(k, o) where c.col_key = t.k and c.deleted_at is null;
  return jsonb_build_object('ok', true);
end $fn$;

-- { key } → { ok }   remove an added column (the CRM columns can only be renamed or hidden)
create or replace function public.growth_vd_col_remove(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_std boolean;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['key']);
  select is_standard into v_std from public.growth_vd_columns where col_key = p->>'key' and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  if v_std then raise exception 'SYSTEM_COLUMN' using errcode = '22023'; end if;
  update public.growth_vd_columns set deleted_at = now() where col_key = p->>'key' and deleted_at is null;
  return jsonb_build_object('ok', true);
end $fn$;

-- ═══════════════════════════════ campaigns: a campaign whose dates hold a Vedantu video cannot be deleted ═══════════════════════════════
-- Body of 0132 plus one check (Campaign of a Vedantu row is worked out from its Live Date, so deleting the VSAT would silently
-- change that row's Campaign and in-window numbers). Trashed rows count too (they can be restored).

create or replace function public.growth_campaign_delete(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['id']);
  begin v_id := (p->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  if v_id is null or not exists (select 1 from public.vsat_campaigns where id = v_id) then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  if exists (select 1 from public.growth_ad_rows where campaign_id = v_id) or exists (select 1 from public.growth_infl_posts where campaign_id = v_id)
     or exists (select 1 from public.growth_tg_rows where campaign_id = v_id)   -- 0132: Telegram rows too
     or exists (select 1 from public.growth_vd_rows r join public.vsat_campaigns c on c.id = v_id
                 where c.campaign_start is not null and c.campaign_end is not null
                   and r.live_date between c.campaign_start and c.campaign_end) then   -- 0136: Vedantu rows too
    raise exception 'IN_USE' using errcode = '22023';
  end if;
  delete from public.vsat_campaigns where id = v_id;
  return jsonb_build_object('ok', true);
end $fn$;

-- ═══════════════════════════════ grants ═══════════════════════════════

revoke all on function public.growth__vd_ids(jsonb)                  from public, anon, authenticated;
revoke all on function public.growth__vd_campaign(date)              from public, anon, authenticated;
revoke all on function public.growth__vd_extra(jsonb, jsonb)         from public, anon, authenticated;
revoke all on function public.growth__vd_obj(uuid)                   from public, anon, authenticated;
revoke all on function public.growth__vd_utm_owner(text, date, uuid) from public, anon, authenticated;
revoke all on function public.growth__vd_save(jsonb)                 from public, anon, authenticated;
revoke all on function public.growth__vd_attr(boolean)               from public, anon, authenticated;
revoke all on function public.growth__vd_purge_old()                 from public, anon, authenticated;

revoke all on function public.growth_vd_list(jsonb)            from public, anon;
revoke all on function public.growth_vd_save(jsonb)            from public, anon;
revoke all on function public.growth_vd_bulk_update(jsonb)     from public, anon;
revoke all on function public.growth_vd_trash(jsonb)           from public, anon;
revoke all on function public.growth_vd_purge(jsonb)           from public, anon;
revoke all on function public.growth_vd_import(jsonb)          from public, anon;
revoke all on function public.growth_vd_col_add(jsonb)         from public, anon;
revoke all on function public.growth_vd_col_update(jsonb)      from public, anon;
revoke all on function public.growth_vd_col_unhide_all(jsonb)  from public, anon;
revoke all on function public.growth_vd_col_order(jsonb)       from public, anon;
revoke all on function public.growth_vd_col_remove(jsonb)      from public, anon;
revoke all on function public.growth_campaign_delete(jsonb)    from public, anon;
grant execute on function public.growth_vd_list(jsonb)           to authenticated;
grant execute on function public.growth_vd_save(jsonb)           to authenticated;
grant execute on function public.growth_vd_bulk_update(jsonb)    to authenticated;
grant execute on function public.growth_vd_trash(jsonb)          to authenticated;
grant execute on function public.growth_vd_purge(jsonb)          to authenticated;
grant execute on function public.growth_vd_import(jsonb)         to authenticated;
grant execute on function public.growth_vd_col_add(jsonb)        to authenticated;
grant execute on function public.growth_vd_col_update(jsonb)     to authenticated;
grant execute on function public.growth_vd_col_unhide_all(jsonb) to authenticated;
grant execute on function public.growth_vd_col_order(jsonb)      to authenticated;
grant execute on function public.growth_vd_col_remove(jsonb)     to authenticated;
grant execute on function public.growth_campaign_delete(jsonb)   to authenticated;

-- ═══════════════════════════════ trash clean-up ═══════════════════════════════

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('growth-vd-trash-purge', '47 3 * * *', 'select public.growth__vd_purge_old()');
  else
    raise notice 'pg_cron is not installed: run select public.growth__vd_purge_old() daily some other way';
  end if;
end $$;
