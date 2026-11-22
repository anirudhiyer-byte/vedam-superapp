-- 0138 · Growth · a VSAT date change may not put two Vedantu rows with the same UTM into one VSAT
--
-- Why: a Vedantu row's VSAT is not stored; it is worked out from its Live Date (growth__vd_campaign, 0136). The rule
-- "one UTM once per VSAT" is checked when a row is saved, but growth_campaign_save (0120) let an admin move or overlap VSAT
-- dates freely. Two rows that sat in different VSATs (same UTM, allowed) could land in the same VSAT after a date change,
-- so their leads and payments counted twice.
--
-- Now: growth_campaign_save is exactly as 0120, plus one check at the end. When a campaign is added, or its start / end
-- dates change, every live Vedantu row is looked at again; if two rows with the same UTM (same text, or same source / medium /
-- campaign) now share a VSAT and at least one of them moved because of this save, the save is refused with
-- 'VD_UTM_CONFLICT' (detail = the Channel of one row) and nothing is written. Same rule as growth_vd_save and as restoring
-- from the trash (0136). Older clashes never block an unrelated edit; trashed rows are checked when they are restored.
--
-- Changed: growth_campaign_save(jsonb) only (create or replace, same signature, same grants). No table, column, index or
-- other function is touched. Needs 0120 (its body) and 0136 (growth_vd_rows, growth__vd_campaign): apply in number order.
-- Rollback: supabase/rollback/0138_growth_vd_campaign_dates_down.sql

create or replace function public.growth_campaign_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid; v_name text; s date; e date; v_meta jsonb;
        v_ids uuid[]; v_cs uuid[]; v_old_s date; v_old_e date; v_check boolean; v_dup text;
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
  perform public.growth__date(p, 'exam_date');   -- 0120: optional; a malformed value is still refused
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
    select campaign_start, campaign_end into v_old_s, v_old_e from public.vsat_campaigns where id = v_id;
    if not found then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  end if;
  if exists (select 1 from public.vsat_campaigns where lower(btrim(name)) = lower(v_name) and id is distinct from v_id) then
    raise exception 'DUPLICATE' using errcode = '22023';
  end if;
  -- 0138: a new campaign, or new start / end dates, can move Vedantu rows into another VSAT (their VSAT is worked out from
  -- the Live Date). Remember where every live row sits now, to compare after the write.
  v_check := v_id is null or v_old_s is distinct from s or v_old_e is distinct from e;
  if v_check then
    select array_agg(r.id order by r.id), array_agg(public.growth__vd_campaign(r.live_date) order by r.id)
      into v_ids, v_cs from public.growth_vd_rows r where r.deleted_at is null;
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
    update public.vsat_campaigns set name = v_name, campaign_start = s, campaign_end = e,
      exam_date = case when p ? 'exam_date' then public.growth__date(p, 'exam_date') else exam_date end,   -- 0120: absent key keeps it
      budget = public.growth__num(p, 'budget', 0, 1e11), application_target = public.growth__num(p, 'application_target', 0, 1e9)::int,
      last_date_to_apply = case when p ? 'last_date_to_apply' then public.growth__date(p, 'last_date_to_apply') else last_date_to_apply end,
      planned_l2p = case when p ? 'planned_l2p' then public.growth__num(p, 'planned_l2p', 0, 100) else planned_l2p end,
      planned_cpp = case when p ? 'planned_cpp' then public.growth__num(p, 'planned_cpp', 0, 1e9) else planned_cpp end,
      metadata = case when p ? 'metadata' then v_meta else metadata end
    where id = v_id;
  end if;
  if v_check then
    -- same rule as growth_vd_save / growth_vd_trash(restore): one UTM (same text, or same source / medium / campaign) once per VSAT.
    -- Only pairs where at least one row moved because of this save are looked at, so an older clash never blocks an unrelated edit.
    with b as (select t.id, t.c from unnest(v_ids, v_cs) as t(id, c)),
         r as materialized (
           select x.id, x.channel, x.utm_key, lower(btrim(x.utm_link)) t, public.growth__vd_campaign(x.live_date) c,
                  (b.id is not null and b.c is distinct from public.growth__vd_campaign(x.live_date)) moved
             from public.growth_vd_rows x left join b on b.id = x.id where x.deleted_at is null)
    select m.channel into v_dup from (
      select a.channel from r a join r z on a.moved and a.id <> z.id and a.c is not distinct from z.c and a.t = z.t
      union all
      select a.channel from r a join r z on a.moved and a.id <> z.id and a.c is not distinct from z.c and a.utm_key is not null and a.utm_key = z.utm_key
    ) m limit 1;
    if v_dup is not null then raise exception 'VD_UTM_CONFLICT' using errcode = '22023', detail = v_dup; end if;   -- the whole save is undone
  end if;
  return jsonb_build_object('id', v_id);
end $fn$;

-- create or replace keeps the grants; restated so this file is complete on its own
revoke all on function public.growth_campaign_save(jsonb) from public, anon;
grant execute on function public.growth_campaign_save(jsonb) to authenticated;
