-- 0107 · Growth · Campaigns page (VSAT Admin → Growth → Overview → Campaigns).
--
-- A replica of the Vedam CRM "Campaigns" page needs four fields that public.vsat_campaigns does not have.
-- This migration reuses vsat_campaigns (the table Growth Ads / Influencers already use) and adds them:
--   * last_date_to_apply date           ("Apply by")
--   * planned_l2p numeric  (0–100)      (Planned L2P %)
--   * planned_cpp numeric  (>= 0)       (Planned CPP ₹)
--   * metadata jsonb object, default {} (Custom fields / filters; stored only, no report applies them yet)
--
-- Functions:
--   * growth_campaigns_list()      NEW  — all campaigns, newest start first, with every field + "used" (ad rows + influencer posts).
--   * growth_campaign_save(jsonb)  CHANGED — accepts the 4 new keys. A new key that is ABSENT from the call leaves the
--       stored value alone, so the existing Ads/Influencers "Campaigns" dialog (which never sends them) keeps working
--       and never wipes them. Everything else (required fields, ranges, DUPLICATE, NOT_FOUND) is exactly as 0105.
--   * growth_campaign_delete(jsonb) unchanged (IN_USE guard stays).
--
-- Not touched: mkt_campaigns, comms_campaigns, campaign_report, growth_perf / growth_weekly / growth_rows_list, RLS, table grants.
-- Rollback: supabase/rollback/0107_growth_campaigns_down.sql

alter table public.vsat_campaigns
  add column if not exists last_date_to_apply date,
  add column if not exists planned_l2p numeric,
  add column if not exists planned_cpp numeric,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'vsat_campaigns_planned_l2p_chk') then
    alter table public.vsat_campaigns add constraint vsat_campaigns_planned_l2p_chk check (planned_l2p is null or (planned_l2p >= 0 and planned_l2p <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vsat_campaigns_planned_cpp_chk') then
    alter table public.vsat_campaigns add constraint vsat_campaigns_planned_cpp_chk check (planned_cpp is null or planned_cpp >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vsat_campaigns_metadata_chk') then
    alter table public.vsat_campaigns add constraint vsat_campaigns_metadata_chk check (jsonb_typeof(metadata) = 'object');
  end if;
end $c$;

-- list for the Campaigns page
create or replace function public.growth_campaigns_list()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  perform public.growth__admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'campaign_start', c.campaign_start, 'campaign_end', c.campaign_end,
      'last_date_to_apply', c.last_date_to_apply, 'exam_date', c.exam_date,
      'application_target', c.application_target, 'budget', c.budget,
      'planned_l2p', c.planned_l2p, 'planned_cpp', c.planned_cpp, 'metadata', c.metadata,
      'used', (select count(*) from public.growth_ad_rows a where a.campaign_id = c.id)
            + (select count(*) from public.growth_infl_posts a where a.campaign_id = c.id))
      order by c.campaign_start desc nulls last, c.name) from public.vsat_campaigns c), '[]'::jsonb);
end $fn$;

-- add / edit a campaign
create or replace function public.growth_campaign_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid; v_name text; s date; e date; v_meta jsonb;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['id', 'name', 'campaign_start', 'campaign_end', 'exam_date', 'budget', 'application_target',
                                       'last_date_to_apply', 'planned_l2p', 'planned_cpp', 'metadata']);
  v_name := public.growth__txt(p, 'name', 60);
  if v_name is null then raise exception 'REQUIRED: name' using errcode = '22023'; end if;
  s := public.growth__date(p, 'campaign_start'); e := public.growth__date(p, 'campaign_end');
  if s is null then raise exception 'REQUIRED: campaign_start' using errcode = '22023'; end if;
  if e is null then raise exception 'REQUIRED: campaign_end' using errcode = '22023'; end if;
  if e < s then raise exception 'BAD_VALUE: campaign_end' using errcode = '22023'; end if;
  if public.growth__date(p, 'exam_date') is null then raise exception 'REQUIRED: exam_date' using errcode = '22023'; end if;  -- vsat_campaigns.exam_date is NOT NULL
  -- new fields: validate before any write
  perform public.growth__date(p, 'last_date_to_apply');
  perform public.growth__num(p, 'planned_l2p', 0, 100);
  perform public.growth__num(p, 'planned_cpp', 0, 1e9);
  if p ? 'metadata' then
    if jsonb_typeof(p->'metadata') = 'null' then v_meta := '{}'::jsonb;
    elsif jsonb_typeof(p->'metadata') = 'object' and length((p->'metadata')::text) <= 4000 then v_meta := p->'metadata';
    else raise exception 'BAD_VALUE: metadata' using errcode = '22023'; end if;
  end if;
  if p ? 'id' and jsonb_typeof(p->'id') <> 'null' then
    begin v_id := (p->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
    if not exists (select 1 from public.vsat_campaigns where id = v_id) then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  end if;
  if exists (select 1 from public.vsat_campaigns where lower(btrim(name)) = lower(v_name) and id is distinct from v_id) then
    raise exception 'DUPLICATE' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date, budget, application_target,
                                       last_date_to_apply, planned_l2p, planned_cpp, metadata)
    values (v_name, s, e, public.growth__date(p, 'exam_date'), public.growth__num(p, 'budget', 0, 1e11),
            public.growth__num(p, 'application_target', 0, 1e9)::int,
            public.growth__date(p, 'last_date_to_apply'), public.growth__num(p, 'planned_l2p', 0, 100),
            public.growth__num(p, 'planned_cpp', 0, 1e9), coalesce(v_meta, '{}'::jsonb))
    returning id into v_id;
  else
    update public.vsat_campaigns set name = v_name, campaign_start = s, campaign_end = e, exam_date = public.growth__date(p, 'exam_date'),
      budget = public.growth__num(p, 'budget', 0, 1e11), application_target = public.growth__num(p, 'application_target', 0, 1e9)::int,
      last_date_to_apply = case when p ? 'last_date_to_apply' then public.growth__date(p, 'last_date_to_apply') else last_date_to_apply end,
      planned_l2p = case when p ? 'planned_l2p' then public.growth__num(p, 'planned_l2p', 0, 100) else planned_l2p end,
      planned_cpp = case when p ? 'planned_cpp' then public.growth__num(p, 'planned_cpp', 0, 1e9) else planned_cpp end,
      metadata = case when p ? 'metadata' then v_meta else metadata end
    where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $fn$;

-- grants (same as 0105)
revoke all on function public.growth_campaigns_list() from public, anon;
revoke all on function public.growth_campaign_save(jsonb) from public, anon;
grant execute on function public.growth_campaigns_list() to authenticated;
grant execute on function public.growth_campaign_save(jsonb) to authenticated;
