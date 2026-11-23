-- 0146 · Growth → Marketing channels → School Connect Channel (listing + performance, admin only)
--
-- A managed channel modelled on the Vedantu channel (0136/0137), but its funnel starts at Vedam One
-- SIGN-UPS, not leads: one row = one School Connect touchpoint (a tracked UTM link for a session /
-- school / drive). For each row we count the people whose PRIMARY (first-touch) campaign is that
-- row's UTM and then how far they got:
--   Sign-ups     = Vedam One profiles attributed to the row's UTM (primary first-touch)
--   VSAT Leads   = those who became a VSAT lead (a lead_manager row)
--   Applications = those with an application_manager row
--   Payments     = those with a vsat_payments row
--   Enrolments   = those with an approved enrolment
-- In-window = sign-ups whose sign-up day (IST) falls in the VSAT campaign that the row's Live Date sits
-- in (worked out from the date, as the Vedantu Campaign column); All-time = every sign-up with the UTM.
--
-- Columns are rows of growth_sc_columns (rename / hide / reorder standard ones, add custom Text/Number/
-- Date/URL columns in `extra`). Trash: rows trashed > 30 days are purged daily (growth-sc-trash-purge).
-- Generic growth helpers are reused (growth__admin/keys/txt/url/date/num, growth__utm_key,
-- growth__vd_campaign, growth__vd_ids, growth__cons_stage); only School-Connect objects are new.
-- Test data (zz_dummy_campaign / medium 'dummy') and internal @vedam emails are excluded, as elsewhere.
--
-- Security: admin only (growth__admin). Tables RLS on, no policies, no grants. Public RPCs SECURITY
-- DEFINER, search_path '', unknown keys refused, revoked from public/anon, granted to authenticated.
-- Rollback: supabase/rollback/0146_growth_schoolconnect_down.sql   Tests: supabase/tests/growth_schoolconnect.test.sql

-- ═══════════════════════════════ tables ═══════════════════════════════
create table if not exists public.growth_sc_rows (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null check (char_length(channel) between 1 and 120),
  live_link   text check (live_link is null or char_length(live_link) <= 2000),
  utm_link    text not null check (char_length(utm_link) between 1 and 2000),
  live_date   date not null,
  notes       text check (notes is null or char_length(notes) <= 500),
  extra       jsonb not null default '{}'::jsonb,
  utm_key     text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists growth_sc_rows_key  on public.growth_sc_rows (utm_key) where deleted_at is null;
create index if not exists growth_sc_rows_text on public.growth_sc_rows (lower(btrim(utm_link))) where deleted_at is null;
create index if not exists growth_sc_rows_date on public.growth_sc_rows (live_date);

create table if not exists public.growth_sc_columns (
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
create unique index if not exists growth_sc_columns_key on public.growth_sc_columns (col_key) where deleted_at is null;

alter table public.growth_sc_rows    enable row level security;
alter table public.growth_sc_columns enable row level security;
revoke all on table public.growth_sc_rows, public.growth_sc_columns from public, anon, authenticated;

create trigger trg_audit_growth_sc_rows
  after insert or update or delete on public.growth_sc_rows
  for each row execute function public.audit_trigger();
create trigger trg_audit_growth_sc_columns
  after insert or update or delete on public.growth_sc_columns
  for each row execute function public.audit_trigger();

create or replace function public.growth__sc_key_trg()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  new.utm_key := public.growth__utm_key(new.utm_link);
  return new;
end $fn$;
revoke all on function public.growth__sc_key_trg() from public, anon, authenticated;
create trigger trg_growth_sc_rows_key before insert or update of utm_link on public.growth_sc_rows
  for each row execute function public.growth__sc_key_trg();

insert into public.growth_sc_columns (col_key, label, col_type, required, is_standard, is_hidden, display_order)
select v.k, v.l, v.t, v.r, true, v.h, v.o
  from (values
    ('serial_no',        'Serial No',              'computed', false, true,   1),
    ('channel',          'Channel',                'text',     true,  false,  2),
    ('live_link',        'Live Link',              'url',      false, false,  3),
    ('utm_link',         'UTM Link',               'url',      true,  false,  4),
    ('live_date',        'Live Date',              'date',     true,  false,  5),
    ('campaign',         'Campaign',               'computed', false, false,  6),
    ('signups',          'Sign-ups (In Window)',   'computed', false, false,  7),
    ('leads',            'VSAT Leads (In Window)', 'computed', false, false,  8),
    ('applications',     'Applications (In Window)','computed',false, false,  9),
    ('payments',         'Payments (In Window)',   'computed', false, false, 10),
    ('enrollments',      'Enrolments (In Window)', 'computed', false, false, 11),
    ('signups_all',      'Sign-ups (All Time)',    'computed', false, false, 12),
    ('leads_all',        'VSAT Leads (All Time)',  'computed', false, false, 13),
    ('applications_all', 'Applications (All Time)','computed', false, false, 14),
    ('payments_all',     'Payments (All Time)',    'computed', false, false, 15),
    ('enrollments_all',  'Enrolments (All Time)',  'computed', false, false, 16),
    ('notes',            'Notes',                  'text',     false, false, 17)
  ) as v(k, l, t, r, h, o)
 where not exists (select 1 from public.growth_sc_columns c where c.col_key = v.k and c.deleted_at is null);

-- ═══════════════════════════════ private helpers ═══════════════════════════════

-- custom values of a row: only live custom columns, each value checked; required ones present
create or replace function public.growth__sc_extra(p_extra jsonb, p_old jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare out jsonb := coalesce(p_old, '{}'::jsonb); c record; k text; v text;
begin
  if p_extra is not null and jsonb_typeof(p_extra) not in ('object', 'null') then raise exception 'BAD_VALUE: extra' using errcode = '22023'; end if;
  if jsonb_typeof(p_extra) = 'object' then
    for k in select jsonb_object_keys(p_extra) loop
      if not exists (select 1 from public.growth_sc_columns where col_key = k and not is_standard and deleted_at is null) then
        raise exception 'UNKNOWN_KEY: %', k using errcode = '22023';
      end if;
    end loop;
  end if;
  for c in select * from public.growth_sc_columns where not is_standard and deleted_at is null loop
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
create or replace function public.growth__sc_obj(p_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $fn$
  select jsonb_build_object('id', r.id, 'channel', r.channel, 'live_link', r.live_link, 'utm_link', r.utm_link,
           'live_date', r.live_date::text, 'notes', r.notes)
    from public.growth_sc_rows r where r.id = p_id and r.deleted_at is null;
$fn$;

-- the live row (other than p_id) that already uses this UTM link in the VSAT of this Live Date; returns its Channel
create or replace function public.growth__sc_utm_owner(p_link text, p_date date, p_id uuid)
returns text language plpgsql stable security definer set search_path to '' as $fn$
declare v_k text := public.growth__utm_key(p_link); v_l text := lower(btrim(p_link)); v_c uuid := public.growth__vd_campaign(p_date); v_name text;
begin
  select r.channel into v_name from public.growth_sc_rows r
   where r.deleted_at is null and r.id is distinct from p_id
     and (lower(btrim(r.utm_link)) = v_l or (v_k is not null and r.utm_key = v_k))
     and public.growth__vd_campaign(r.live_date) is not distinct from v_c
   order by r.created_at, r.id limit 1;
  return v_name;
end $fn$;

-- add or edit one live row; returns its id. Every value is checked here.
create or replace function public.growth__sc_save(p jsonb)
returns uuid language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid := null; v_old jsonb; v_extra jsonb; v_channel text; v_link text; v_utm text; v_date date; v_dup text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  perform public.growth__keys(p, array['id', 'channel', 'live_link', 'utm_link', 'live_date', 'notes', 'extra']);
  if p ? 'id' and jsonb_typeof(p->'id') <> 'null' then
    begin v_id := (p->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
    select extra into v_old from public.growth_sc_rows where id = v_id and deleted_at is null;
    if not found then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  end if;

  v_channel := public.growth__txt(p, 'channel', 120);
  if v_channel is null then raise exception 'REQUIRED: channel' using errcode = '22023'; end if;
  v_link := public.growth__url(p, 'live_link');
  v_utm := public.growth__url(p, 'utm_link');
  if v_utm is null then raise exception 'REQUIRED: utm_link' using errcode = '22023'; end if;
  v_date := public.growth__date(p, 'live_date');
  if v_date is null then raise exception 'REQUIRED: live_date' using errcode = '22023'; end if;
  v_extra := public.growth__sc_extra(p->'extra', v_old);

  perform pg_advisory_xact_lock(hashtextextended(coalesce(public.growth__utm_key(v_utm), lower(btrim(v_utm))), 0));
  v_dup := public.growth__sc_utm_owner(v_utm, v_date, v_id);
  if v_dup is not null then raise exception 'DUPLICATE_UTM' using errcode = '22023', detail = v_dup; end if;

  if v_id is null then
    insert into public.growth_sc_rows (channel, live_link, utm_link, live_date, notes, extra, created_by)
    values (v_channel, v_link, v_utm, v_date, public.growth__txt(p, 'notes', 500), v_extra, auth.uid())
    returning id into v_id;
  else
    update public.growth_sc_rows set
      channel = v_channel, live_link = v_link, utm_link = v_utm, live_date = v_date,
      notes = public.growth__txt(p, 'notes', 500), extra = v_extra, updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $fn$;

-- one line per Vedam One SIGN-UP whose primary UTM is one of p_keys, with how far they got (IST dates)
create or replace function public.growth__sc_signups(p_keys text[])
returns table (user_id uuid, k text, signup_d date, is_lead boolean, applied_d date, paid_d date, enrolled_d date)
language sql stable security definer set search_path to '' as $fn$
  select p.id,
         public.vsat__norm_utm(p.utm_primary) as k,
         (p.created_at at time zone 'Asia/Kolkata')::date as signup_d,
         exists (select 1 from public.lead_manager lm where lm.lead_id = p.id) as is_lead,
         (select (min(a.created_at) at time zone 'Asia/Kolkata')::date
            from public.application_manager a where a.lead_id = p.id) as applied_d,
         (select (min(vp.paid_at) at time zone 'Asia/Kolkata')::date
            from public.vsat_payments vp where vp.lead_id = p.id) as paid_d,
         (select (min(coalesce(a.enrollment_paid_at, a.last_updated_date)) at time zone 'Asia/Kolkata')::date
            from public.application_manager a where a.lead_id = p.id and a.enrollment_stage = 'approved') as enrolled_d
    from public.profiles p
   where public.vsat__norm_utm(p.utm_primary) = any (p_keys)
     and not public.app__is_internal_email(p.email)
     and coalesce(p.utm_campaign, '') <> 'zz_dummy_campaign'
     and lower(coalesce(p.utm_medium, '')) <> 'dummy';
$fn$;

-- per row of a view: the VSAT of the Live Date + in-window and all-time funnel (see header)
create or replace function public.growth__sc_attr(p_trash boolean)
returns table (id uuid, utm_key text, campaign_id uuid, campaign text,
               signups int, leads int, applications int, payments int, enrollments int,
               signups_all int, leads_all int, applications_all int, payments_all int, enrollments_all int)
language sql stable security definer set search_path to '' as $fn$
  with r as materialized (
    select a.id, a.utm_key k, c.id cid, c.name cname, c.campaign_start s, c.campaign_end e
      from public.growth_sc_rows a
      left join public.vsat_campaigns c on c.id = public.growth__vd_campaign(a.live_date)
     where (a.deleted_at is not null) = p_trash
  ), g as materialized (
    select * from public.growth__sc_signups(array(select distinct r.k from r where r.k is not null))
  ), allt as (
    select g.k,
           count(*)::int n,
           count(*) filter (where g.is_lead)::int ld,
           count(g.applied_d)::int ap, count(g.paid_d)::int pm, count(g.enrolled_d)::int en
      from g group by g.k
  ), win as (
    select r.id,
           count(*)::int n,
           count(*) filter (where g.is_lead)::int ld,
           count(g.applied_d)::int ap, count(g.paid_d)::int pm, count(g.enrolled_d)::int en
      from r join g on g.k = r.k and r.s is not null and r.e is not null and g.signup_d between r.s and r.e
     group by r.id
  )
  select r.id, r.k, r.cid, r.cname,
         coalesce(win.n, 0), coalesce(win.ld, 0), coalesce(win.ap, 0), coalesce(win.pm, 0), coalesce(win.en, 0),
         coalesce(allt.n, 0), coalesce(allt.ld, 0), coalesce(allt.ap, 0), coalesce(allt.pm, 0), coalesce(allt.en, 0)
    from r left join allt on allt.k = r.k left join win on win.id = r.id;
$fn$;

-- daily: rows in the trash for more than 30 days are deleted
create or replace function public.growth__sc_purge_old()
returns int language plpgsql security definer set search_path to '' as $fn$
declare n int;
begin
  delete from public.growth_sc_rows where deleted_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $fn$;

-- ═══════════════════════════════ public RPCs ═══════════════════════════════

create or replace function public.growth_sc_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v_trash boolean; v_rows jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['view']);
  if coalesce(p->>'view', 'active') not in ('active', 'trash') then raise exception 'BAD_VALUE: view' using errcode = '22023'; end if;
  v_trash := coalesce(p->>'view', 'active') = 'trash';
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'channel', r.channel, 'live_link', r.live_link, 'utm_link', r.utm_link, 'live_date', r.live_date,
      'campaign_id', t.campaign_id, 'campaign', t.campaign, 'notes', r.notes, 'extra', r.extra,
      'created_at', r.created_at, 'updated_at', r.updated_at, 'deleted_at', r.deleted_at, 'utm_key', t.utm_key,
      'signups', t.signups, 'leads', t.leads, 'applications', t.applications, 'payments', t.payments, 'enrollments', t.enrollments,
      'signups_all', t.signups_all, 'leads_all', t.leads_all, 'applications_all', t.applications_all,
      'payments_all', t.payments_all, 'enrollments_all', t.enrollments_all)
      order by r.live_date desc, r.created_at, r.id), '[]'::jsonb)
    into v_rows
    from public.growth_sc_rows r
    join public.growth__sc_attr(v_trash) t on t.id = r.id;
  return jsonb_build_object(
    'rows', v_rows,
    'counts', jsonb_build_object('active', (select count(*) from public.growth_sc_rows where deleted_at is null),
                                 'trash',  (select count(*) from public.growth_sc_rows where deleted_at is not null)),
    'columns', coalesce((select jsonb_agg(jsonb_build_object('key', c.col_key, 'label', c.label, 'type', c.col_type,
        'required', c.required, 'standard', c.is_standard, 'hidden', c.is_hidden) order by c.display_order, c.created_at)
        from public.growth_sc_columns c where c.deleted_at is null), '[]'::jsonb));
end $fn$;

create or replace function public.growth_sc_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['row']);
  if jsonb_typeof(p->'row') is distinct from 'object' then raise exception 'BAD_VALUE: row' using errcode = '22023'; end if;
  return jsonb_build_object('id', public.growth__sc_save(p->'row'));
end $fn$;

create or replace function public.growth_sc_bulk_update(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_ids uuid[]; k text; v_id uuid; o jsonb; n int := 0; v_custom boolean;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['ids', 'key', 'value']);
  v_ids := public.growth__vd_ids(p);
  if jsonb_typeof(p->'key') is distinct from 'string' then raise exception 'BAD_VALUE: key' using errcode = '22023'; end if;
  k := p->>'key';
  if p ? 'value' and jsonb_typeof(p->'value') not in ('string', 'number', 'null') then raise exception 'BAD_VALUE: value' using errcode = '22023'; end if;
  if k in ('channel', 'live_link', 'live_date', 'notes') then
    v_custom := false;
  elsif exists (select 1 from public.growth_sc_columns where col_key = k and not is_standard and deleted_at is null) then
    v_custom := true;
  else
    raise exception 'BAD_VALUE: key' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.growth_sc_rows r where r.id = x and r.deleted_at is null)) then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  foreach v_id in array v_ids loop
    o := public.growth__sc_obj(v_id);
    if v_custom then o := o || jsonb_build_object('extra', jsonb_build_object(k, coalesce(p->'value', 'null'::jsonb)));
    else o := o || jsonb_build_object(k, coalesce(p->'value', 'null'::jsonb)); end if;
    perform public.growth__sc_save(o);
    n := n + 1;
  end loop;
  return jsonb_build_object('changed', n);
end $fn$;

create or replace function public.growth_sc_trash(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_ids uuid[]; n int; v_dup text;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['ids', 'trash']);
  v_ids := public.growth__vd_ids(p);
  if jsonb_typeof(p->'trash') is distinct from 'boolean' then raise exception 'BAD_VALUE: trash' using errcode = '22023'; end if;
  if (p->>'trash')::boolean then
    update public.growth_sc_rows set deleted_at = now(), updated_at = now() where id = any (v_ids) and deleted_at is null;
    get diagnostics n = row_count;
  else
    update public.growth_sc_rows set deleted_at = null, updated_at = now() where id = any (v_ids) and deleted_at is not null;
    get diagnostics n = row_count;
    select a.channel into v_dup
      from public.growth_sc_rows a join public.growth_sc_rows b on a.id < b.id
     where a.deleted_at is null and b.deleted_at is null and (a.id = any (v_ids) or b.id = any (v_ids))
       and (lower(btrim(a.utm_link)) = lower(btrim(b.utm_link)) or (a.utm_key is not null and a.utm_key = b.utm_key))
       and public.growth__vd_campaign(a.live_date) is not distinct from public.growth__vd_campaign(b.live_date)
     limit 1;
    if v_dup is not null then raise exception 'DUPLICATE_UTM' using errcode = '22023', detail = v_dup; end if;
  end if;
  return jsonb_build_object('changed', n);
end $fn$;

create or replace function public.growth_sc_purge(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_ids uuid[]; n int;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['ids']);
  v_ids := public.growth__vd_ids(p);
  delete from public.growth_sc_rows where id = any (v_ids) and deleted_at is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('deleted', n);
end $fn$;

create or replace function public.growth_sc_import(p jsonb)
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
        select x.id into v_id from public.growth_sc_rows x
         where x.deleted_at is null
           and (lower(btrim(x.utm_link)) = lower(btrim(r->>'utm_link')) or (v_k is not null and x.utm_key = v_k))
           and (v_d is null or public.growth__vd_campaign(x.live_date) is not distinct from v_c)
         order by x.created_at, x.id limit 1;
      end if;
      if v_id is null then
        perform public.growth__sc_save(r); v_add := v_add + 1;
      else
        o := public.growth__sc_obj(v_id) || (r - 'utm_link');
        perform public.growth__sc_save(o); v_upd := v_upd + 1;
      end if;
    exception when sqlstate '22023' then
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_object('row', i, 'error', sqlerrm); end if;
    end;
  end loop;
  if jsonb_array_length(errs) > 0 then raise exception 'IMPORT_FAILED' using errcode = 'P0001', detail = errs::text; end if;
  return jsonb_build_object('added', v_add, 'updated', v_upd);
end $fn$;

create or replace function public.growth_sc_col_add(p jsonb)
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
  if exists (select 1 from public.growth_sc_columns where deleted_at is null and lower(label) = lower(v_label)) then
    raise exception 'DUPLICATE' using errcode = '22023';
  end if;
  if (select count(*) from public.growth_sc_columns where not is_standard and deleted_at is null) >= 30 then
    raise exception 'TOO_MANY_COLUMNS' using errcode = '22023';
  end if;
  v_base := 'x_' || coalesce(nullif(left(trim(both '_' from regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g')), 32), ''), 'col');
  v_key := v_base;
  while exists (select 1 from public.growth_sc_columns where col_key = v_key and deleted_at is null) loop
    v_n := v_n + 1; v_key := v_base || '_' || v_n;
  end loop;
  insert into public.growth_sc_columns (col_key, label, col_type, required, is_standard, display_order, created_by)
  values (v_key, v_label, v_type, coalesce((p->>'required')::boolean, false), false,
          (select coalesce(max(display_order), 0) + 1 from public.growth_sc_columns where deleted_at is null), auth.uid());
  return jsonb_build_object('key', v_key);
end $fn$;

create or replace function public.growth_sc_col_update(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_label text;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['key', 'label', 'hidden']);
  if not exists (select 1 from public.growth_sc_columns where col_key = p->>'key' and deleted_at is null) then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  if p ? 'label' then
    v_label := public.growth__txt(p, 'label', 60);
    if v_label is null then raise exception 'REQUIRED: label' using errcode = '22023'; end if;
    if exists (select 1 from public.growth_sc_columns where deleted_at is null and lower(label) = lower(v_label) and col_key <> p->>'key') then
      raise exception 'DUPLICATE' using errcode = '22023';
    end if;
    update public.growth_sc_columns set label = v_label where col_key = p->>'key' and deleted_at is null;
  end if;
  if p ? 'hidden' then
    if jsonb_typeof(p->'hidden') <> 'boolean' then raise exception 'BAD_VALUE: hidden' using errcode = '22023'; end if;
    update public.growth_sc_columns set is_hidden = (p->>'hidden')::boolean where col_key = p->>'key' and deleted_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.growth_sc_col_unhide_all(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare n int;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array[]::text[]);
  update public.growth_sc_columns set is_hidden = false where is_hidden and deleted_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('changed', n);
end $fn$;

create or replace function public.growth_sc_col_order(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_keys text[];
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['keys']);
  if jsonb_typeof(p->'keys') is distinct from 'array' or jsonb_array_length(p->'keys') > 100 then raise exception 'BAD_VALUE: keys' using errcode = '22023'; end if;
  select array_agg(x order by o) into v_keys from jsonb_array_elements_text(p->'keys') with ordinality t(x, o);
  if cardinality(v_keys) <> (select count(distinct x) from unnest(v_keys) x)
     or (select array_agg(x order by x) from unnest(v_keys) x)
        is distinct from (select array_agg(col_key order by col_key) from public.growth_sc_columns where deleted_at is null) then
    raise exception 'BAD_VALUE: keys' using errcode = '22023';
  end if;
  update public.growth_sc_columns c set display_order = t.o
    from unnest(v_keys) with ordinality t(k, o) where c.col_key = t.k and c.deleted_at is null;
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.growth_sc_col_remove(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_std boolean;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['key']);
  select is_standard into v_std from public.growth_sc_columns where col_key = p->>'key' and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  if v_std then raise exception 'SYSTEM_COLUMN' using errcode = '22023'; end if;
  update public.growth_sc_columns set deleted_at = now() where col_key = p->>'key' and deleted_at is null;
  return jsonb_build_object('ok', true);
end $fn$;

-- ═══════════════════════════════ performance drill ═══════════════════════════════

-- every sign-up of the live rows in view (once), with whether they signed up inside a row's VSAT dates
create or replace function public.growth__scperf_people(p_start date, p_end date, p_campaign text, p_channel text)
returns table (user_id uuid, in_window boolean, signup_d date, is_lead boolean, applied_d date, paid_d date, enrolled_d date)
language sql stable security definer set search_path to '' as $fn$
  with r as materialized (
    select a.utm_key k, c.name cname, c.campaign_start s, c.campaign_end e
      from public.growth_sc_rows a
      left join public.vsat_campaigns c on c.id = public.growth__vd_campaign(a.live_date)
     where a.deleted_at is null
       and (p_start is null or a.live_date >= p_start)
       and (p_end is null or a.live_date <= p_end)
       and (p_channel is null or a.channel = p_channel)
  ), rv as materialized (
    select * from r where p_campaign is null or r.cname = p_campaign
  ), g as materialized (
    select * from public.growth__sc_signups(array(select distinct rv.k from rv where rv.k is not null))
  )
  select g.user_id,
         bool_or(rv.s is not null and rv.e is not null and g.signup_d between rv.s and rv.e),
         min(g.signup_d), bool_or(g.is_lead), min(g.applied_d), min(g.paid_d), min(g.enrolled_d)
    from rv join g on g.k = rv.k
   group by g.user_id;
$fn$;

-- { type: signups|leads|applications|payments|enrollments, scope: in_window|all_time, start?, end?, campaign?, channel? }
create or replace function public.growth_sc_perf_drill(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v_type text; v_scope text; v_s date; v_e date; v_c text; v_ch text; v_total int; v_rows jsonb; v_cols text[];
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['type', 'scope', 'start', 'end', 'campaign', 'channel']);
  v_type := p->>'type';
  v_scope := coalesce(p->>'scope', 'all_time');
  if v_type is null or v_type not in ('signups', 'leads', 'applications', 'payments', 'enrollments') then raise exception 'BAD_VALUE: type' using errcode = '22023'; end if;
  if v_scope not in ('in_window', 'all_time') then raise exception 'BAD_VALUE: scope' using errcode = '22023'; end if;
  v_s := public.growth__date(p, 'start');
  v_e := public.growth__date(p, 'end');
  if v_s is not null and v_e is not null and v_s > v_e then raise exception 'BAD_VALUE: start' using errcode = '22023'; end if;
  v_c := nullif(btrim(public.growth__txt(p, 'campaign', 120)), '');
  v_ch := nullif(btrim(public.growth__txt(p, 'channel', 120)), '');

  v_cols := array['user_id', 'full_name', 'email', 'phone', 'signup_date', 'primary_source', 'primary_campaign',
    'is_vsat_lead', 'application_no', 'lead_stage', 'applied', 'paid', 'enrolled', 'campus_preference'];

  with x as materialized (
    select * from public.growth__scperf_people(v_s, v_e, v_c, v_ch) x
     where (v_scope = 'all_time' or x.in_window)
       and (v_type = 'signups'
            or (v_type = 'leads' and x.is_lead)
            or (v_type = 'applications' and x.applied_d is not null)
            or (v_type = 'payments' and x.paid_d is not null)
            or (v_type = 'enrollments' and x.enrolled_d is not null))
  ), pick as (
    select x.user_id, x.signup_d, x.is_lead, x.applied_d, x.paid_d, x.enrolled_d
      from x order by x.signup_d desc nulls last, x.user_id limit 5000
  ), j as (
    select k.signup_d, k.user_id,
      jsonb_build_object(
        'user_id', pr.public_id, 'full_name', pr.full_name, 'email', pr.email, 'phone', pr.phone,
        'signup_date', k.signup_d, 'primary_source', pr.utm_primary,
        'primary_campaign', lm.primary_registration_campaign,
        'is_vsat_lead', k.is_lead, 'application_no', am.application_no, 'lead_stage', lm.lead_stage,
        'applied', k.applied_d is not null, 'paid', k.paid_d is not null, 'enrolled', k.enrolled_d is not null,
        'campus_preference', coalesce(am.campus_applied, lm.campus_preference)) o
      from pick k
      join public.profiles pr on pr.id = k.user_id
      left join public.lead_manager lm on lm.lead_id = k.user_id
      left join lateral (select a.* from public.application_manager a where a.lead_id = k.user_id
                          order by a.last_updated_date desc nulls last, a.created_at desc limit 1) am on true
  )
  select (select count(*) from x)::int,
         coalesce((select jsonb_agg(j.o order by j.signup_d desc nulls last, j.user_id) from j), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('columns', to_jsonb(v_cols), 'students', v_rows, 'total', v_total, 'truncated', v_total > 5000);
end $fn$;

-- ═══════════════════════════════ grants ═══════════════════════════════
revoke all on function public.growth__sc_extra(jsonb, jsonb)          from public, anon, authenticated;
revoke all on function public.growth__sc_obj(uuid)                    from public, anon, authenticated;
revoke all on function public.growth__sc_utm_owner(text, date, uuid)  from public, anon, authenticated;
revoke all on function public.growth__sc_save(jsonb)                  from public, anon, authenticated;
revoke all on function public.growth__sc_signups(text[])              from public, anon, authenticated;
revoke all on function public.growth__sc_attr(boolean)                from public, anon, authenticated;
revoke all on function public.growth__sc_purge_old()                  from public, anon, authenticated;
revoke all on function public.growth__scperf_people(date, date, text, text) from public, anon, authenticated;

revoke all on function public.growth_sc_list(jsonb)            from public, anon;
revoke all on function public.growth_sc_save(jsonb)            from public, anon;
revoke all on function public.growth_sc_bulk_update(jsonb)     from public, anon;
revoke all on function public.growth_sc_trash(jsonb)           from public, anon;
revoke all on function public.growth_sc_purge(jsonb)           from public, anon;
revoke all on function public.growth_sc_import(jsonb)          from public, anon;
revoke all on function public.growth_sc_col_add(jsonb)         from public, anon;
revoke all on function public.growth_sc_col_update(jsonb)      from public, anon;
revoke all on function public.growth_sc_col_unhide_all(jsonb)  from public, anon;
revoke all on function public.growth_sc_col_order(jsonb)       from public, anon;
revoke all on function public.growth_sc_col_remove(jsonb)      from public, anon;
revoke all on function public.growth_sc_perf_drill(jsonb)      from public, anon;
grant execute on function public.growth_sc_list(jsonb)           to authenticated;
grant execute on function public.growth_sc_save(jsonb)           to authenticated;
grant execute on function public.growth_sc_bulk_update(jsonb)    to authenticated;
grant execute on function public.growth_sc_trash(jsonb)          to authenticated;
grant execute on function public.growth_sc_purge(jsonb)          to authenticated;
grant execute on function public.growth_sc_import(jsonb)         to authenticated;
grant execute on function public.growth_sc_col_add(jsonb)        to authenticated;
grant execute on function public.growth_sc_col_update(jsonb)     to authenticated;
grant execute on function public.growth_sc_col_unhide_all(jsonb) to authenticated;
grant execute on function public.growth_sc_col_order(jsonb)      to authenticated;
grant execute on function public.growth_sc_col_remove(jsonb)     to authenticated;
grant execute on function public.growth_sc_perf_drill(jsonb)     to authenticated;

-- ═══════════════════════════════ trash clean-up ═══════════════════════════════
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('growth-sc-trash-purge', '52 3 * * *', 'select public.growth__sc_purge_old()');
  else
    raise notice 'pg_cron is not installed: run select public.growth__sc_purge_old() daily some other way';
  end if;
end $$;
