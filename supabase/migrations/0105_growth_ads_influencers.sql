-- 0105 · Growth → Ads + Influencers channels (listing + performance), admin only
--
-- Ports the vedamcrm360 "Ads Channel Listing / Ad Performance" and "Influencer Listing /
-- Influencer Performance" pages into Vedam One, on Vedam One's own data:
--
--   leads        = lead_manager rows, matched to an ad / post by the lead's PRIMARY (first-touch)
--                  UTM: utm_source/utm_medium/utm_campaign of the row's UTM link, normalised with
--                  vsat__norm_utm (same rule as the VSAT panels; indexed, migration 0092)
--   payments     = those leads with a vsat_payments row (first paid_at)
--   enrollments  = those leads whose application_manager.enrollment_stage = 'approved'
--                  (enrollment_paid_at)
--   campaign     = vsat_campaigns (name, campaign_start, campaign_end, exam_date, budget, application_target);
--                  until now the table was unused. "Used in" on an ad / post points at it.
--
--   in-window    = leads that arrived (IST date of lead_manager.created_at) between the campaign's
--                  start and end; their payments / enrollments are counted whenever they happen
--                  (the funnel stays a subset: leads ⊇ payments ⊇ enrollments)
--   all-time     = every lead with that UTM. In-window is a subset of all-time.
--   Performance:   a campaign filter = the in-window leads of that campaign's rows (the cohort) and
--                  only their payments / enrollments; with no campaign, a date range counts leads by
--                  arrival date, payments by paid date and enrollments by enrolment date, whatever
--                  VSAT they belong to.
--
-- Numbers are computed live by the RPCs (nothing stored), so "Refresh" always shows the latest.
--
-- "Add column": a column is a row in growth_custom_columns (label, type, required, options). The
-- value lives in the row's `extra` jsonb and the database checks every value (type, required,
-- options) on every save and import: a column can never exist only in the browser, and adding or
-- removing one never changes a table's structure.
--
-- Security: admin only (is_admin()). Tables: RLS on, no policies, no grants. RPCs: SECURITY
-- DEFINER, search_path '', revoked from public/anon, granted to authenticated; private helpers
-- (growth__*) are not callable by browsers. Request objects with unknown keys are refused.
--
-- Rollback: supabase/rollback/0105_growth_ads_influencers_down.sql
-- Tests:    supabase/tests/growth_ads_influencers.test.sql

-- ═══════════════════════════════ tables ═══════════════════════════════

create table if not exists public.growth_custom_columns (
  id            uuid primary key default gen_random_uuid(),
  channel       text not null check (channel in ('ads', 'influencers')),
  col_key       text not null check (col_key ~ '^x_[a-z0-9_]{1,40}$'),
  label         text not null check (char_length(label) between 1 and 60),
  col_type      text not null check (col_type in ('text', 'number', 'date', 'url', 'select')),
  required      boolean not null default false,
  options       jsonb,
  display_order int not null default 0,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create unique index if not exists growth_custom_columns_key on public.growth_custom_columns (channel, col_key) where deleted_at is null;

create table if not exists public.growth_ad_rows (
  id              uuid primary key default gen_random_uuid(),
  serial_no       int,
  ad_name         text not null,
  platform        text not null check (platform in ('Meta', 'Google')),
  campaign_id     uuid references public.vsat_campaigns(id),
  campaign_status text not null default 'Enabled' check (campaign_status in ('Enabled', 'Paused')),
  live_date       date,
  spend           numeric(14,2) not null default 0 check (spend >= 0),
  utm_link        text,
  notes           text,
  extra           jsonb not null default '{}'::jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists growth_ad_rows_campaign on public.growth_ad_rows (campaign_id);

create table if not exists public.growth_influencers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 120),
  channel_link text,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create unique index if not exists growth_influencers_name on public.growth_influencers (lower(btrim(name)));

create table if not exists public.growth_infl_posts (
  id              uuid primary key default gen_random_uuid(),
  serial_no       int,
  influencer_id   uuid not null references public.growth_influencers(id),
  platform        text not null check (platform in ('YouTube - Dedicated', 'YouTube - Integrated', 'YouTube - Semi-Dedicated',
                                                    'YouTube Shorts', 'YouTube - Generic', 'Instagram Reel', 'Instagram Story')),
  live_date       date,
  live_link       text,
  utm_link        text,
  expected_views  bigint check (expected_views >= 0),
  actual_views    bigint check (actual_views >= 0),
  views_synced_at timestamptz,
  cost            numeric(14,2) not null default 0 check (cost >= 0),
  live_status     text not null default 'Planned' check (live_status in ('Planned', 'Live')),
  campaign_id     uuid references public.vsat_campaigns(id),
  notes           text,
  extra           jsonb not null default '{}'::jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists growth_infl_posts_campaign on public.growth_infl_posts (campaign_id);
create index if not exists growth_infl_posts_influencer on public.growth_infl_posts (influencer_id);

alter table public.growth_custom_columns enable row level security;
alter table public.growth_ad_rows        enable row level security;
alter table public.growth_influencers    enable row level security;
alter table public.growth_infl_posts     enable row level security;
revoke all on table public.growth_custom_columns, public.growth_ad_rows, public.growth_influencers, public.growth_infl_posts
  from public, anon, authenticated;

-- ═══════════════════════════════ private helpers ═══════════════════════════════

-- admin gate (raises FORBIDDEN / NOT_SIGNED_IN)
create or replace function public.growth__admin()
returns void language plpgsql stable security definer set search_path to '' as $fn$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
end $fn$;

-- the attribution key of a UTM link: normalised source/medium/campaign (same form as lead_manager.primary_utm)
create or replace function public.growth__utm_key(p_link text)
returns text language sql immutable set search_path to '' as $fn$
  select public.vsat__norm_utm(public.utm_triple(
    replace(public.utm_param(p_link, 'utm_source'), '%20', ' '),
    replace(public.utm_param(p_link, 'utm_medium'), '%20', ' '),
    replace(public.utm_param(p_link, 'utm_campaign'), '%20', ' ')));
$fn$;

-- one line per lead whose primary UTM is one of p_keys: arrival / paid / enrolled dates (IST)
create or replace function public.growth__leads(p_keys text[])
returns table (lead_id uuid, k text, created_d date, paid_d date, enrolled_d date)
language sql stable security definer set search_path to '' as $fn$
  select lm.lead_id,
         public.vsat__norm_utm(lm.primary_utm),
         (lm.created_at at time zone 'Asia/Kolkata')::date,
         (select (min(vp.paid_at) at time zone 'Asia/Kolkata')::date from public.vsat_payments vp where vp.lead_id = lm.lead_id),
         (select (min(coalesce(am.enrollment_paid_at, am.last_updated_date)) at time zone 'Asia/Kolkata')::date
            from public.application_manager am where am.lead_id = lm.lead_id and am.enrollment_stage = 'approved')
    from public.lead_manager lm
   where public.vsat__norm_utm(lm.primary_utm) = any (p_keys);
$fn$;

-- request checks
create or replace function public.growth__keys(p jsonb, p_allowed text[])
returns void language plpgsql immutable set search_path to '' as $fn$
declare k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (p_allowed)) then raise exception 'UNKNOWN_KEY: %', k using errcode = '22023'; end if;
  end loop;
end $fn$;

create or replace function public.growth__channel(p jsonb)
returns text language plpgsql immutable set search_path to '' as $fn$
begin
  if coalesce(p->>'channel', '') not in ('ads', 'influencers') then raise exception 'BAD_VALUE: channel' using errcode = '22023'; end if;
  return p->>'channel';
end $fn$;

-- text value: trimmed, '' -> null, max length
create or replace function public.growth__txt(p jsonb, k text, maxlen int)
returns text language plpgsql immutable set search_path to '' as $fn$
declare v text;
begin
  if not (p ? k) or jsonb_typeof(p->k) = 'null' then return null; end if;
  if jsonb_typeof(p->k) not in ('string', 'number') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  v := nullif(btrim(p->>k), '');
  if v is not null and char_length(v) > maxlen then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  return v;
end $fn$;

create or replace function public.growth__num(p jsonb, k text, lo numeric, hi numeric)
returns numeric language plpgsql immutable set search_path to '' as $fn$
declare s text; v numeric;
begin
  s := public.growth__txt(p, k, 40);
  if s is null then return null; end if;
  s := replace(replace(s, ',', ''), '₹', '');
  begin v := s::numeric; exception when others then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end;
  if v < lo or v > hi then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  return v;
end $fn$;

-- dates: YYYY-MM-DD or DD-MM-YYYY / DD/MM/YYYY
create or replace function public.growth__date(p jsonb, k text)
returns date language plpgsql immutable set search_path to '' as $fn$
declare s text; v date; m text[];
begin
  s := public.growth__txt(p, k, 20);
  if s is null then return null; end if;
  begin
    m := regexp_match(s, '^(\d{4})-(\d{2})-(\d{2})$');
    if m is not null then v := make_date(m[1]::int, m[2]::int, m[3]::int);
    else
      m := regexp_match(s, '^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$');
      if m is null then raise exception 'x'; end if;
      v := make_date(m[3]::int, m[2]::int, m[1]::int);   -- DD-MM-YYYY (make_date refuses 31-02 etc.)
    end if;
    if extract(year from v) not between 2000 and 2100 then raise exception 'x'; end if;
  exception when others then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end;
  return v;
end $fn$;

create or replace function public.growth__url(p jsonb, k text)
returns text language plpgsql immutable set search_path to '' as $fn$
declare v text;
begin
  v := public.growth__txt(p, k, 2000);
  if v is not null and v !~* '^https?://[^\s]+$' then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  return v;
end $fn$;

-- the custom values of a row: only defined columns, each value checked; required ones present
create or replace function public.growth__extra(p_channel text, p_extra jsonb, p_old jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  out jsonb := coalesce(p_old, '{}'::jsonb); c record; k text; v text;
begin
  if p_extra is not null and jsonb_typeof(p_extra) <> 'object' then raise exception 'BAD_VALUE: extra' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(coalesce(p_extra, '{}'::jsonb)) loop
    if not exists (select 1 from public.growth_custom_columns where channel = p_channel and col_key = k and deleted_at is null) then
      raise exception 'UNKNOWN_KEY: %', k using errcode = '22023';
    end if;
  end loop;
  for c in select * from public.growth_custom_columns where channel = p_channel and deleted_at is null loop
    if p_extra ? c.col_key then
      if c.col_type = 'number' then v := public.growth__num(p_extra, c.col_key, -1e12, 1e12)::text;
      elsif c.col_type = 'date' then v := public.growth__date(p_extra, c.col_key)::text;
      elsif c.col_type = 'url' then v := public.growth__url(p_extra, c.col_key);
      else
        v := public.growth__txt(p_extra, c.col_key, 500);
        if c.col_type = 'select' and v is not null and not (c.options ? v) then
          raise exception 'BAD_VALUE: %', c.col_key using errcode = '22023';
        end if;
      end if;
      out := case when v is null then out - c.col_key else out || jsonb_build_object(c.col_key, v) end;
    end if;
    if c.required and nullif(out->>c.col_key, '') is null then
      raise exception 'REQUIRED: %', c.col_key using errcode = '22023';
    end if;
  end loop;
  -- values of removed columns are kept in the row but never shown or required
  return out;
end $fn$;

create or replace function public.growth__campaign_id(p jsonb, k text)
returns uuid language plpgsql stable security definer set search_path to '' as $fn$
declare s text; v uuid;
begin
  s := public.growth__txt(p, k, 120);
  if s is null then return null; end if;
  if s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v from public.vsat_campaigns where id = s::uuid;
  else
    select id into v from public.vsat_campaigns where lower(btrim(name)) = lower(s) order by created_at limit 1;
  end if;
  if v is null then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  return v;
end $fn$;

-- next serial number for a channel
create or replace function public.growth__next_serial(p_channel text)
returns int language sql stable security definer set search_path to '' as $fn$
  select coalesce(max(serial_no), 0) + 1 from (
    select serial_no from public.growth_ad_rows where p_channel = 'ads'
    union all select serial_no from public.growth_infl_posts where p_channel = 'influencers') s;
$fn$;

-- one row (insert or update) from a request object; returns the row id. p_import = names allowed for
-- campaign / influencer and a missing influencer is created.
create or replace function public.growth__save_row(p_channel text, p jsonb, p_import boolean)
returns uuid language plpgsql security definer set search_path to '' as $fn$
declare
  v_id uuid := null; v_old jsonb; v_extra jsonb; v_serial int; v_infl uuid; s text;
begin
  if p ? 'id' and jsonb_typeof(p->'id') <> 'null' then
    begin v_id := (p->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
    if p_channel = 'ads' then select extra into v_old from public.growth_ad_rows where id = v_id;
    else select extra into v_old from public.growth_infl_posts where id = v_id; end if;
    if not found then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  end if;
  if p_channel = 'ads' then
    perform public.growth__keys(p, array['id', 'serial_no', 'ad_name', 'platform', 'campaign', 'campaign_status', 'live_date', 'spend', 'utm_link', 'notes', 'extra']);
  else
    perform public.growth__keys(p, array['id', 'serial_no', 'influencer', 'platform', 'live_date', 'live_link', 'utm_link', 'expected_views',
                                         'actual_views', 'cost', 'live_status', 'campaign', 'notes', 'extra']);
  end if;
  v_extra := public.growth__extra(p_channel, p->'extra', v_old);
  v_serial := public.growth__num(p, 'serial_no', 1, 999999)::int;

  if p_channel = 'ads' then
    if public.growth__txt(p, 'ad_name', 200) is null then raise exception 'REQUIRED: ad_name' using errcode = '22023'; end if;
    s := public.growth__txt(p, 'platform', 20);
    if s is null then raise exception 'REQUIRED: platform' using errcode = '22023'; end if;
    if lower(s) not in ('meta', 'google') then raise exception 'BAD_VALUE: platform' using errcode = '22023'; end if;
    if public.growth__txt(p, 'campaign', 120) is null then raise exception 'REQUIRED: campaign' using errcode = '22023'; end if;
    if coalesce(public.growth__txt(p, 'campaign_status', 20), 'Enabled') not in ('Enabled', 'Paused') then raise exception 'BAD_VALUE: campaign_status' using errcode = '22023'; end if;
    if v_id is null then
      insert into public.growth_ad_rows (serial_no, ad_name, platform, campaign_id, campaign_status, live_date, spend, utm_link, notes, extra, created_by)
      values (coalesce(v_serial, public.growth__next_serial('ads')), public.growth__txt(p, 'ad_name', 200), initcap(s),
              public.growth__campaign_id(p, 'campaign'), coalesce(public.growth__txt(p, 'campaign_status', 20), 'Enabled'),
              public.growth__date(p, 'live_date'), coalesce(public.growth__num(p, 'spend', 0, 1e11), 0), public.growth__url(p, 'utm_link'),
              public.growth__txt(p, 'notes', 1000), v_extra, auth.uid())
      returning id into v_id;
    else
      update public.growth_ad_rows set
        serial_no = coalesce(v_serial, serial_no), ad_name = public.growth__txt(p, 'ad_name', 200), platform = initcap(s),
        campaign_id = public.growth__campaign_id(p, 'campaign'), campaign_status = coalesce(public.growth__txt(p, 'campaign_status', 20), 'Enabled'),
        live_date = public.growth__date(p, 'live_date'), spend = coalesce(public.growth__num(p, 'spend', 0, 1e11), 0),
        utm_link = public.growth__url(p, 'utm_link'), notes = public.growth__txt(p, 'notes', 1000), extra = v_extra, updated_at = now()
      where id = v_id;
    end if;
  else
    s := public.growth__txt(p, 'influencer', 120);
    if s is null then raise exception 'REQUIRED: influencer' using errcode = '22023'; end if;
    if s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select id into v_infl from public.growth_influencers where id = s::uuid;
    else
      select id into v_infl from public.growth_influencers where lower(btrim(name)) = lower(s);
      if v_infl is null and p_import then
        insert into public.growth_influencers (name, created_by) values (s, auth.uid()) returning id into v_infl;
      end if;
    end if;
    if v_infl is null then raise exception 'BAD_VALUE: influencer' using errcode = '22023'; end if;
    s := public.growth__txt(p, 'platform', 40);
    if s is null then raise exception 'REQUIRED: platform' using errcode = '22023'; end if;
    if s not in ('YouTube - Dedicated', 'YouTube - Integrated', 'YouTube - Semi-Dedicated', 'YouTube Shorts', 'YouTube - Generic',
                 'Instagram Reel', 'Instagram Story') then raise exception 'BAD_VALUE: platform' using errcode = '22023'; end if;
    if coalesce(public.growth__txt(p, 'live_status', 20), 'Planned') not in ('Planned', 'Live') then raise exception 'BAD_VALUE: live_status' using errcode = '22023'; end if;
    if v_id is null then
      insert into public.growth_infl_posts (serial_no, influencer_id, platform, live_date, live_link, utm_link, expected_views, actual_views,
                                            cost, live_status, campaign_id, notes, extra, created_by)
      values (coalesce(v_serial, public.growth__next_serial('influencers')), v_infl, s, public.growth__date(p, 'live_date'),
              public.growth__url(p, 'live_link'), public.growth__url(p, 'utm_link'),
              public.growth__num(p, 'expected_views', 0, 1e12)::bigint, public.growth__num(p, 'actual_views', 0, 1e12)::bigint,
              coalesce(public.growth__num(p, 'cost', 0, 1e11), 0), coalesce(public.growth__txt(p, 'live_status', 20), 'Planned'),
              public.growth__campaign_id(p, 'campaign'), public.growth__txt(p, 'notes', 1000), v_extra, auth.uid())
      returning id into v_id;
    else
      update public.growth_infl_posts set
        serial_no = coalesce(v_serial, serial_no), influencer_id = v_infl, platform = s, live_date = public.growth__date(p, 'live_date'),
        live_link = public.growth__url(p, 'live_link'), utm_link = public.growth__url(p, 'utm_link'),
        expected_views = public.growth__num(p, 'expected_views', 0, 1e12)::bigint,
        actual_views = public.growth__num(p, 'actual_views', 0, 1e12)::bigint,
        cost = coalesce(public.growth__num(p, 'cost', 0, 1e11), 0), live_status = coalesce(public.growth__txt(p, 'live_status', 20), 'Planned'),
        campaign_id = public.growth__campaign_id(p, 'campaign'), notes = public.growth__txt(p, 'notes', 1000), extra = v_extra, updated_at = now()
      where id = v_id;
    end if;
  end if;
  return v_id;
end $fn$;

-- per row: in-window + all-time attribution (listing)
create or replace function public.growth__row_attr(p_channel text, p_trash boolean)
returns table (id uuid, utm_key text, leads int, payments int, enrollments int, leads_all int, payments_all int, enrollments_all int)
language sql stable security definer set search_path to '' as $fn$
  with r as (
    select a.id, public.growth__utm_key(a.utm_link) k, c.campaign_start s, c.campaign_end e
      from public.growth_ad_rows a left join public.vsat_campaigns c on c.id = a.campaign_id
     where p_channel = 'ads' and (a.deleted_at is not null) = p_trash
    union all
    select a.id, public.growth__utm_key(a.utm_link), c.campaign_start, c.campaign_end
      from public.growth_infl_posts a left join public.vsat_campaigns c on c.id = a.campaign_id
     where p_channel = 'influencers' and (a.deleted_at is not null) = p_trash
  ), l as materialized (
    select * from public.growth__leads(array(select distinct k from r where k is not null))
  ), allt as (
    select k, count(*)::int n, count(paid_d)::int p, count(enrolled_d)::int en from l group by k
  )
  select r.id, r.k,
         case when r.k is null or r.s is null or r.e is null then null
              else (select count(*)::int from l where l.k = r.k and l.created_d between r.s and r.e) end,
         case when r.k is null or r.s is null or r.e is null then null
              else (select count(*)::int from l where l.k = r.k and l.created_d between r.s and r.e and l.paid_d is not null) end,
         case when r.k is null or r.s is null or r.e is null then null
              else (select count(*)::int from l where l.k = r.k and l.created_d between r.s and r.e and l.enrolled_d is not null) end,
         coalesce(allt.n, 0), coalesce(allt.p, 0), coalesce(allt.en, 0)
    from r left join allt on allt.k = r.k;
$fn$;

-- ═══════════════════════════════ public RPCs ═══════════════════════════════

-- campaigns, custom columns, influencers, platform lists
create or replace function public.growth_mkt_meta()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  perform public.growth__admin();
  return jsonb_build_object(
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'campaign_start', c.campaign_start,
        'campaign_end', c.campaign_end, 'exam_date', c.exam_date, 'budget', c.budget, 'application_target', c.application_target,
        'used', (select count(*) from public.growth_ad_rows a where a.campaign_id = c.id)
              + (select count(*) from public.growth_infl_posts a where a.campaign_id = c.id))
        order by c.campaign_start nulls last, c.name) from public.vsat_campaigns c), '[]'::jsonb),
    'columns', coalesce((select jsonb_agg(jsonb_build_object('channel', x.channel, 'key', x.col_key, 'label', x.label, 'type', x.col_type,
        'required', x.required, 'options', x.options) order by x.channel, x.display_order, x.created_at)
        from public.growth_custom_columns x where x.deleted_at is null), '[]'::jsonb),
    'influencers', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'channel_link', i.channel_link) order by lower(i.name))
        from public.growth_influencers i), '[]'::jsonb),
    'ad_platforms', '["Meta","Google"]'::jsonb,
    'infl_platforms', '["YouTube - Dedicated","YouTube - Integrated","YouTube - Semi-Dedicated","YouTube Shorts","YouTube - Generic","Instagram Reel","Instagram Story"]'::jsonb);
end $fn$;

-- add / edit a campaign (vsat_campaigns): name, window, exam date, budget, application target
create or replace function public.growth_campaign_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid; v_name text; s date; e date;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['id', 'name', 'campaign_start', 'campaign_end', 'exam_date', 'budget', 'application_target']);
  v_name := public.growth__txt(p, 'name', 60);
  if v_name is null then raise exception 'REQUIRED: name' using errcode = '22023'; end if;
  s := public.growth__date(p, 'campaign_start'); e := public.growth__date(p, 'campaign_end');
  if s is null then raise exception 'REQUIRED: campaign_start' using errcode = '22023'; end if;
  if e is null then raise exception 'REQUIRED: campaign_end' using errcode = '22023'; end if;
  if e < s then raise exception 'BAD_VALUE: campaign_end' using errcode = '22023'; end if;
  if public.growth__date(p, 'exam_date') is null then raise exception 'REQUIRED: exam_date' using errcode = '22023'; end if;  -- vsat_campaigns.exam_date is NOT NULL
  if p ? 'id' and jsonb_typeof(p->'id') <> 'null' then
    begin v_id := (p->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
    if not exists (select 1 from public.vsat_campaigns where id = v_id) then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  end if;
  if exists (select 1 from public.vsat_campaigns where lower(btrim(name)) = lower(v_name) and id is distinct from v_id) then
    raise exception 'DUPLICATE' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date, budget, application_target)
    values (v_name, s, e, public.growth__date(p, 'exam_date'), public.growth__num(p, 'budget', 0, 1e11),
            public.growth__num(p, 'application_target', 0, 1e9)::int)
    returning id into v_id;
  else
    update public.vsat_campaigns set name = v_name, campaign_start = s, campaign_end = e, exam_date = public.growth__date(p, 'exam_date'),
      budget = public.growth__num(p, 'budget', 0, 1e11), application_target = public.growth__num(p, 'application_target', 0, 1e9)::int
    where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $fn$;

-- delete a campaign nobody uses
create or replace function public.growth_campaign_delete(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['id']);
  begin v_id := (p->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  if v_id is null or not exists (select 1 from public.vsat_campaigns where id = v_id) then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  if exists (select 1 from public.growth_ad_rows where campaign_id = v_id) or exists (select 1 from public.growth_infl_posts where campaign_id = v_id) then
    raise exception 'IN_USE' using errcode = '22023';
  end if;
  delete from public.vsat_campaigns where id = v_id;
  return jsonb_build_object('ok', true);
end $fn$;

-- listing rows (+ live attribution) for one channel; view = active | trash
create or replace function public.growth_rows_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare ch text; v_trash boolean; v_rows jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['channel', 'view']);
  ch := public.growth__channel(p);
  if coalesce(p->>'view', 'active') not in ('active', 'trash') then raise exception 'BAD_VALUE: view' using errcode = '22023'; end if;
  v_trash := coalesce(p->>'view', 'active') = 'trash';
  if ch = 'ads' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'serial_no', a.serial_no, 'ad_name', a.ad_name, 'platform', a.platform, 'campaign_id', a.campaign_id,
        'campaign', c.name, 'campaign_status', a.campaign_status, 'live_date', a.live_date, 'spend', a.spend, 'utm_link', a.utm_link,
        'notes', a.notes, 'extra', a.extra, 'updated_at', a.updated_at, 'utm_key', t.utm_key,
        'leads', t.leads, 'payments', t.payments, 'enrollments', t.enrollments,
        'leads_all', t.leads_all, 'payments_all', t.payments_all, 'enrollments_all', t.enrollments_all)
        order by a.updated_at desc), '[]'::jsonb)
      into v_rows
      from public.growth_ad_rows a
      left join public.vsat_campaigns c on c.id = a.campaign_id
      join public.growth__row_attr('ads', v_trash) t on t.id = a.id;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'serial_no', a.serial_no, 'influencer_id', a.influencer_id, 'influencer', i.name, 'platform', a.platform,
        'live_date', a.live_date, 'live_link', a.live_link, 'utm_link', a.utm_link, 'expected_views', a.expected_views,
        'actual_views', a.actual_views, 'views_synced_at', a.views_synced_at, 'cost', a.cost, 'live_status', a.live_status,
        'campaign_id', a.campaign_id, 'campaign', c.name, 'notes', a.notes, 'extra', a.extra, 'updated_at', a.updated_at, 'utm_key', t.utm_key,
        'leads', t.leads, 'payments', t.payments, 'enrollments', t.enrollments,
        'leads_all', t.leads_all, 'payments_all', t.payments_all, 'enrollments_all', t.enrollments_all)
        order by a.updated_at desc), '[]'::jsonb)
      into v_rows
      from public.growth_infl_posts a
      join public.growth_influencers i on i.id = a.influencer_id
      left join public.vsat_campaigns c on c.id = a.campaign_id
      join public.growth__row_attr('influencers', v_trash) t on t.id = a.id;
  end if;
  return jsonb_build_object('rows', v_rows, 'counts', jsonb_build_object(
    'active', case when ch = 'ads' then (select count(*) from public.growth_ad_rows where deleted_at is null)
                   else (select count(*) from public.growth_infl_posts where deleted_at is null) end,
    'trash',  case when ch = 'ads' then (select count(*) from public.growth_ad_rows where deleted_at is not null)
                   else (select count(*) from public.growth_infl_posts where deleted_at is not null) end));
end $fn$;

-- add or edit one row: { channel, row: {...} }
create or replace function public.growth_row_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare ch text;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['channel', 'row']);
  ch := public.growth__channel(p);
  if jsonb_typeof(p->'row') is distinct from 'object' then raise exception 'BAD_VALUE: row' using errcode = '22023'; end if;
  return jsonb_build_object('id', public.growth__save_row(ch, p->'row', false));
end $fn$;

-- move rows to trash / restore: { channel, ids: [...], trash: true|false }
create or replace function public.growth_rows_trash(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare ch text; v_ids uuid[]; n int;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['channel', 'ids', 'trash']);
  ch := public.growth__channel(p);
  if jsonb_typeof(p->'ids') is distinct from 'array' or jsonb_array_length(p->'ids') = 0 or jsonb_array_length(p->'ids') > 2000 then
    raise exception 'BAD_VALUE: ids' using errcode = '22023';
  end if;
  if jsonb_typeof(p->'trash') is distinct from 'boolean' then raise exception 'BAD_VALUE: trash' using errcode = '22023'; end if;
  begin select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(p->'ids') x;
  exception when others then raise exception 'BAD_VALUE: ids' using errcode = '22023'; end;
  if ch = 'ads' then
    update public.growth_ad_rows set deleted_at = case when (p->>'trash')::boolean then now() end, updated_at = now() where id = any (v_ids);
  else
    update public.growth_infl_posts set deleted_at = case when (p->>'trash')::boolean then now() end, updated_at = now() where id = any (v_ids);
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('changed', n);
end $fn$;

-- CSV import, all or nothing: { channel, rows: [{...}] } (campaign / influencer by name; new influencers are created)
create or replace function public.growth_rows_import(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare ch text; r jsonb; i int := 0; errs jsonb := '[]'::jsonb; n int;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['channel', 'rows']);
  ch := public.growth__channel(p);
  if jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows') = 0 then raise exception 'BAD_VALUE: rows' using errcode = '22023'; end if;
  n := jsonb_array_length(p->'rows');
  if n > 2000 then raise exception 'TOO_MANY_ROWS' using errcode = '22023'; end if;
  for r in select x from jsonb_array_elements(p->'rows') x loop
    i := i + 1;
    begin
      if jsonb_typeof(r) <> 'object' or r ? 'id' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
      perform public.growth__save_row(ch, r, true);
    exception when sqlstate '22023' then
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_object('row', i, 'error', sqlerrm); end if;
    end;
  end loop;
  if jsonb_array_length(errs) > 0 then
    raise exception 'IMPORT_FAILED' using errcode = 'P0001', detail = errs::text;
  end if;
  return jsonb_build_object('inserted', n);
end $fn$;

-- add an influencer to the master list (or return the one with that name)
create or replace function public.growth_influencer_add(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_name text; v_id uuid; v_new boolean := false;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['name', 'channel_link']);
  v_name := public.growth__txt(p, 'name', 120);
  if v_name is null then raise exception 'REQUIRED: name' using errcode = '22023'; end if;
  select id into v_id from public.growth_influencers where lower(btrim(name)) = lower(v_name);
  if v_id is null then
    insert into public.growth_influencers (name, channel_link, created_by) values (v_name, public.growth__url(p, 'channel_link'), auth.uid())
    returning id into v_id;
    v_new := true;
  end if;
  return jsonb_build_object('id', v_id, 'name', (select name from public.growth_influencers where id = v_id), 'created', v_new);
end $fn$;

-- add a column: { channel, label, type, required, options? }
create or replace function public.growth_column_add(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare ch text; v_label text; v_type text; v_key text; v_opts jsonb := null; n int := 0; o text;
  reserved text[] := array['id', 'serial_no', 'ad_name', 'platform', 'campaign', 'campaign_status', 'live_date', 'spend', 'utm_link', 'notes',
                           'influencer', 'live_link', 'expected_views', 'actual_views', 'cost', 'live_status', 'leads', 'payments', 'enrollments'];
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['channel', 'label', 'type', 'required', 'options']);
  ch := public.growth__channel(p);
  v_label := public.growth__txt(p, 'label', 60);
  if v_label is null then raise exception 'REQUIRED: label' using errcode = '22023'; end if;
  v_type := coalesce(p->>'type', '');
  if v_type not in ('text', 'number', 'date', 'url', 'select') then raise exception 'BAD_VALUE: type' using errcode = '22023'; end if;
  if p ? 'required' and jsonb_typeof(p->'required') <> 'boolean' then raise exception 'BAD_VALUE: required' using errcode = '22023'; end if;
  if v_type = 'select' then
    if jsonb_typeof(p->'options') is distinct from 'array' or jsonb_array_length(p->'options') not between 1 and 30 then
      raise exception 'BAD_VALUE: options' using errcode = '22023';
    end if;
    v_opts := '[]'::jsonb;
    for o in select btrim(x) from jsonb_array_elements_text(p->'options') x loop
      if o = '' or char_length(o) > 60 then raise exception 'BAD_VALUE: options' using errcode = '22023'; end if;
      if not (v_opts ? o) then v_opts := v_opts || to_jsonb(o); end if;
    end loop;
  elsif p ? 'options' and jsonb_typeof(p->'options') <> 'null' then
    raise exception 'BAD_VALUE: options' using errcode = '22023';
  end if;
  if (select count(*) from public.growth_custom_columns where channel = ch and deleted_at is null) >= 30 then
    raise exception 'TOO_MANY_COLUMNS' using errcode = '22023';
  end if;
  v_key := 'x_' || left(trim(both '_' from regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g')), 30);
  if v_key = 'x_' then v_key := 'x_col'; end if;
  if exists (select 1 from public.growth_custom_columns where channel = ch and deleted_at is null and lower(label) = lower(v_label))
     or substr(v_key, 3) = any (reserved) then
    raise exception 'DUPLICATE' using errcode = '22023';
  end if;
  while exists (select 1 from public.growth_custom_columns where channel = ch and deleted_at is null and col_key = v_key || case when n = 0 then '' else '_' || n end) loop
    n := n + 1;
  end loop;
  if n > 0 then v_key := v_key || '_' || n; end if;
  insert into public.growth_custom_columns (channel, col_key, label, col_type, required, options, display_order, created_by)
  values (ch, v_key, v_label, v_type, coalesce((p->>'required')::boolean, false), v_opts,
          (select coalesce(max(display_order), 0) + 1 from public.growth_custom_columns where channel = ch), auth.uid());
  return jsonb_build_object('key', v_key);
end $fn$;

-- remove a column (its values stay in the rows but are no longer shown or required)
create or replace function public.growth_column_remove(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare ch text; n int;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['channel', 'key']);
  ch := public.growth__channel(p);
  update public.growth_custom_columns set deleted_at = now() where channel = ch and col_key = coalesce(p->>'key', '') and deleted_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end $fn$;

-- performance rows: { channel, from?, to?, campaign_ids?: [...], live?: 'live'|'planned'|'all' }
-- campaign filter = in-window cohort of those campaigns' rows; else date range by event date (see header)
create or replace function public.growth_perf(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare ch text; v_from date; v_to date; v_camps uuid[]; v_live text; v_rows jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['channel', 'from', 'to', 'campaign_ids', 'live']);
  ch := public.growth__channel(p);
  v_from := public.growth__date(p, 'from'); v_to := public.growth__date(p, 'to');
  if v_from is not null and v_to is not null and v_to < v_from then raise exception 'BAD_VALUE: to' using errcode = '22023'; end if;
  if p ? 'campaign_ids' and jsonb_typeof(p->'campaign_ids') <> 'null' then
    if jsonb_typeof(p->'campaign_ids') <> 'array' or jsonb_array_length(p->'campaign_ids') > 100 then raise exception 'BAD_VALUE: campaign_ids' using errcode = '22023'; end if;
    begin select array_agg(x::uuid) into v_camps from jsonb_array_elements_text(p->'campaign_ids') x;
    exception when others then raise exception 'BAD_VALUE: campaign_ids' using errcode = '22023'; end;
  end if;
  v_live := coalesce(p->>'live', 'all');
  if v_live not in ('live', 'planned', 'all') then raise exception 'BAD_VALUE: live' using errcode = '22023'; end if;

  with r as (
    select a.id, public.growth__utm_key(a.utm_link) k, a.campaign_id, c.name campaign, c.campaign_start s, c.campaign_end e,
           a.spend cost, a.platform, a.live_date, a.ad_name label, null::uuid influencer_id, null::text influencer, null::bigint views,
           a.campaign_status status, null::text live_link, a.utm_link
      from public.growth_ad_rows a left join public.vsat_campaigns c on c.id = a.campaign_id
     where ch = 'ads' and a.deleted_at is null
    union all
    select a.id, public.growth__utm_key(a.utm_link), a.campaign_id, c.name, c.campaign_start, c.campaign_end,
           a.cost, a.platform, a.live_date, i.name, a.influencer_id, i.name, a.actual_views, a.live_status, a.live_link, a.utm_link
      from public.growth_infl_posts a join public.growth_influencers i on i.id = a.influencer_id
      left join public.vsat_campaigns c on c.id = a.campaign_id
     where ch = 'influencers' and a.deleted_at is null
       and (v_live = 'all' or lower(a.live_status) = v_live)
  ), f as (
    select * from r where v_camps is null or r.campaign_id = any (v_camps)
  ), l as materialized (
    select * from public.growth__leads(array(select distinct k from f where k is not null))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'utm_key', f.k, 'campaign_id', f.campaign_id, 'campaign', f.campaign, 'cost', f.cost, 'platform', f.platform,
      'live_date', f.live_date, 'label', f.label, 'influencer_id', f.influencer_id, 'influencer', f.influencer, 'views', f.views,
      'status', f.status, 'live_link', f.live_link, 'utm_link', f.utm_link,
      'leads', m.leads, 'payments', m.payments, 'enrollments', m.enrollments)), '[]'::jsonb)
    into v_rows
    from f
    cross join lateral (
      select
        count(*) filter (where v_camps is null and (v_from is null or l.created_d >= v_from) and (v_to is null or l.created_d <= v_to)
                         or v_camps is not null and l.created_d between f.s and f.e
                            and (v_from is null or l.created_d >= v_from) and (v_to is null or l.created_d <= v_to))::int leads,
        count(*) filter (where l.paid_d is not null and (
                           v_camps is null and (v_from is null or l.paid_d >= v_from) and (v_to is null or l.paid_d <= v_to)
                           or v_camps is not null and l.created_d between f.s and f.e
                              and (v_from is null or l.created_d >= v_from) and (v_to is null or l.created_d <= v_to)))::int payments,
        count(*) filter (where l.enrolled_d is not null and (
                           v_camps is null and (v_from is null or l.enrolled_d >= v_from) and (v_to is null or l.enrolled_d <= v_to)
                           or v_camps is not null and l.created_d between f.s and f.e
                              and (v_from is null or l.created_d >= v_from) and (v_to is null or l.created_d <= v_to)))::int enrollments
        from l where f.k is not null and l.k = f.k
    ) m
   -- a date range with no campaign keeps the rows that went live in it or had a lead / payment /
   -- enrollment in it (their spend counts); a campaign filter keeps all of the campaign's rows
   where v_camps is not null or (v_from is null and v_to is null)
      or (f.live_date is not null and (v_from is null or f.live_date >= v_from) and (v_to is null or f.live_date <= v_to))
      or m.leads + m.payments + m.enrollments > 0;
  return jsonb_build_object('rows', v_rows);
end $fn$;

-- weekly leads / payments / enrollments for a set of rows: { channel, ids: [...], campaign_id? }
-- leads are counted once even when several of the rows share a UTM. With a campaign: only the rows of
-- that campaign and the leads that arrived in its window (the cohort).
create or replace function public.growth_weekly(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare ch text; v_ids uuid[]; v_camp uuid; s date; e date; v_out jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['channel', 'ids', 'campaign_id']);
  ch := public.growth__channel(p);
  if jsonb_typeof(p->'ids') is distinct from 'array' or jsonb_array_length(p->'ids') = 0 or jsonb_array_length(p->'ids') > 2000 then
    raise exception 'BAD_VALUE: ids' using errcode = '22023';
  end if;
  begin select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(p->'ids') x;
  exception when others then raise exception 'BAD_VALUE: ids' using errcode = '22023'; end;
  if p ? 'campaign_id' and jsonb_typeof(p->'campaign_id') <> 'null' then
    v_camp := public.growth__campaign_id(p, 'campaign_id');
    select campaign_start, campaign_end into s, e from public.vsat_campaigns where id = v_camp;
  end if;
  with k as (
    select distinct public.growth__utm_key(utm_link) k from public.growth_ad_rows
     where ch = 'ads' and id = any (v_ids) and (v_camp is null or campaign_id = v_camp)
    union
    select distinct public.growth__utm_key(utm_link) from public.growth_infl_posts
     where ch = 'influencers' and id = any (v_ids) and (v_camp is null or campaign_id = v_camp)
  ), l as materialized (
    select * from public.growth__leads(array(select k from k where k is not null))
     where v_camp is null or created_d between s and e
  ), ev as (
    select date_trunc('week', created_d)::date wk, 1 a, 0 b, 0 c from l
    union all select date_trunc('week', paid_d)::date, 0, 1, 0 from l where paid_d is not null
    union all select date_trunc('week', enrolled_d)::date, 0, 0, 1 from l where enrolled_d is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'leads', a, 'payments', b, 'enrollments', c) order by wk), '[]'::jsonb)
    into v_out
    from (select wk, sum(a)::int a, sum(b)::int b, sum(c)::int c from ev group by wk) w;
  return jsonb_build_object('weeks', v_out, 'from', s, 'to', e);
end $fn$;

-- YouTube posts the view sync should read (id + live link)
create or replace function public.growth_infl_youtube_targets()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  perform public.growth__admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'live_link', live_link))
    from public.growth_infl_posts
   where deleted_at is null and platform like 'YouTube%' and live_link is not null), '[]'::jsonb);
end $fn$;

-- store synced YouTube views: { items: [{ id, views }] } (YouTube posts only; stamps views_synced_at)
create or replace function public.growth_infl_views_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare it jsonb; n int := 0; v bigint; v_id uuid;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['items']);
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') > 2000 then raise exception 'BAD_VALUE: items' using errcode = '22023'; end if;
  for it in select x from jsonb_array_elements(p->'items') x loop
    perform public.growth__keys(it, array['id', 'views']);
    begin v_id := (it->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
    v := public.growth__num(it, 'views', 0, 1e12)::bigint;
    if v is null then raise exception 'BAD_VALUE: views' using errcode = '22023'; end if;
    update public.growth_infl_posts set actual_views = v, views_synced_at = now(), updated_at = now()
     where id = v_id and platform like 'YouTube%' and deleted_at is null;
    if found then n := n + 1; end if;
  end loop;
  return jsonb_build_object('updated', n);
end $fn$;

-- ═══════════════════════════════ grants ═══════════════════════════════
do $g$
declare f text;
begin
  foreach f in array array[
    'growth__admin()', 'growth__utm_key(text)', 'growth__leads(text[])', 'growth__keys(jsonb, text[])', 'growth__channel(jsonb)',
    'growth__txt(jsonb, text, int)', 'growth__num(jsonb, text, numeric, numeric)', 'growth__date(jsonb, text)', 'growth__url(jsonb, text)',
    'growth__extra(text, jsonb, jsonb)', 'growth__campaign_id(jsonb, text)', 'growth__next_serial(text)',
    'growth__save_row(text, jsonb, boolean)', 'growth__row_attr(text, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'growth_mkt_meta()', 'growth_campaign_save(jsonb)', 'growth_campaign_delete(jsonb)', 'growth_rows_list(jsonb)', 'growth_row_save(jsonb)',
    'growth_rows_trash(jsonb)', 'growth_rows_import(jsonb)', 'growth_influencer_add(jsonb)', 'growth_column_add(jsonb)',
    'growth_column_remove(jsonb)', 'growth_perf(jsonb)', 'growth_weekly(jsonb)', 'growth_infl_youtube_targets()', 'growth_infl_views_set(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;
