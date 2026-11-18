-- Rollback 0107 · Growth Campaigns page.
-- Puts back the exact 0105 growth_campaign_save, removes growth_campaigns_list and the 4 added columns
-- (last_date_to_apply, planned_l2p, planned_cpp, metadata — their values are lost; the 7 original fields are untouched).

drop function if exists public.growth_campaigns_list();

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

revoke all on function public.growth_campaign_save(jsonb) from public, anon;
grant execute on function public.growth_campaign_save(jsonb) to authenticated;

alter table public.vsat_campaigns
  drop constraint if exists vsat_campaigns_planned_l2p_chk,
  drop constraint if exists vsat_campaigns_planned_cpp_chk,
  drop constraint if exists vsat_campaigns_metadata_chk,
  drop column if exists last_date_to_apply,
  drop column if exists planned_l2p,
  drop column if exists planned_cpp,
  drop column if exists metadata;
