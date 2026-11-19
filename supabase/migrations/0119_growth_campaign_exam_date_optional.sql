-- 0119 · Growth · a campaign no longer needs an exam date
--
-- Why: the campaign form asked for an "Exam date" (the Vedam CRM form has none). It was a second, hand-typed
-- copy of a date that really lives in Exam Center (vsat_exam_dates), and the Season Dashboard used it: with a
-- campaign selected, Paid and Enrolments counted only the leads whose application was booked on exactly that
-- date. The typed dates did not match Exam Center and most paid leads have no exam booked yet, so those two
-- cards showed 0 for every campaign.
--
-- Now:
--   * vsat_campaigns.exam_date is optional. The column and every stored value stay (nothing is deleted).
--   * growth_campaign_save(jsonb)  CHANGED — "exam_date" is still an accepted key, but no longer required.
--       Absent on an edit = the stored value is kept; present = stored (empty clears it); a malformed value is
--       still BAD_VALUE. So the old form (which always sends it) and the new form (which never does) both work.
--       Everything else (admin check, unknown keys, required name / start / end, ranges, DUPLICATE, NOT_FOUND)
--       is exactly as 0107.
--   * growth__season_window(jsonb) CHANGED — for a campaign it returns no exam date, so the Season Dashboard
--       counts Paid (first payment date) and Enrolments (enrolment date) inside the campaign's start and end
--       dates: the same rule as a typed date range, and the same as the CRM. Leads are unchanged.
--
-- Not touched: growth__season_ids / growth__season_rows / growth_season_counts / growth_season_drill (they
-- already handle "no exam date"), growth_campaigns_list and growth_mkt_meta (they still return exam_date, now
-- possibly null), the Payment Cohort (it uses only the dates of growth__season_window), VSAT Campaign Report,
-- Ad / Influencer pages, Exam Center, any other table, RLS, grants.
-- Rollback: supabase/rollback/0119_growth_campaign_exam_date_optional_down.sql

alter table public.vsat_campaigns alter column exam_date drop not null;

-- add / edit a campaign (as 0107, exam_date optional)
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
  perform public.growth__date(p, 'exam_date');   -- 0119: optional; a malformed value is still refused
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
    update public.vsat_campaigns set name = v_name, campaign_start = s, campaign_end = e,
      exam_date = case when p ? 'exam_date' then public.growth__date(p, 'exam_date') else exam_date end,   -- 0119: absent key keeps it
      budget = public.growth__num(p, 'budget', 0, 1e11), application_target = public.growth__num(p, 'application_target', 0, 1e9)::int,
      last_date_to_apply = case when p ? 'last_date_to_apply' then public.growth__date(p, 'last_date_to_apply') else last_date_to_apply end,
      planned_l2p = case when p ? 'planned_l2p' then public.growth__num(p, 'planned_l2p', 0, 100) else planned_l2p end,
      planned_cpp = case when p ? 'planned_cpp' then public.growth__num(p, 'planned_cpp', 0, 1e9) else planned_cpp end,
      metadata = case when p ? 'metadata' then v_meta else metadata end
    where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $fn$;

-- the window of a Season Dashboard request (as 0108, a campaign gives its dates only)
create or replace function public.growth__season_window(p jsonb)
returns table (d_from date, d_to date, exam date, camp_name text, locked boolean)
language plpgsql stable security definer set search_path to '' as $fn$
declare v_id uuid; c record; f date; t date;
begin
  if p ? 'campaign_id' and jsonb_typeof(p->'campaign_id') <> 'null' then
    if p ? 'from' or p ? 'to' then raise exception 'BAD_VALUE: from' using errcode = '22023'; end if;
    begin v_id := (p->>'campaign_id')::uuid; exception when others then raise exception 'BAD_VALUE: campaign_id' using errcode = '22023'; end;
    select name, campaign_start, campaign_end into c from public.vsat_campaigns where id = v_id;
    if not found then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
    if c.campaign_start is null or c.campaign_end is null then raise exception 'BAD_VALUE: campaign_id' using errcode = '22023'; end if;
    return query select c.campaign_start, c.campaign_end, null::date, c.name, true;   -- 0119: no exam date → Paid / Enrolments by the dates
  else
    f := public.growth__date(p, 'from'); t := public.growth__date(p, 'to');
    if f is null then raise exception 'REQUIRED: from' using errcode = '22023'; end if;
    if t is null then raise exception 'REQUIRED: to' using errcode = '22023'; end if;
    if t < f then raise exception 'BAD_VALUE: to' using errcode = '22023'; end if;
    return query select f, t, null::date, null::text, false;
  end if;
end $fn$;

-- create or replace keeps the grants of 0107 / 0108; restated so this file is complete on its own
revoke all on function public.growth_campaign_save(jsonb) from public, anon;
grant execute on function public.growth_campaign_save(jsonb) to authenticated;
revoke all on function public.growth__season_window(jsonb) from public, anon, authenticated;
