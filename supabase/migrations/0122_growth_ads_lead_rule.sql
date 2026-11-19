-- 0122 · Growth · Ads / Influencers use the same lead rule and campaign order as the Overview pages
--
-- Owner decision (19 Nov 2026), already live on the Overview pages (0121). This file brings the Ads / Influencers
-- pages in line:
--   * growth__leads(text[]) — the lead's day is its registration day (user_registration_date, IST; the row's
--       creation day when that is empty) instead of created_at. A lead whose email ends in @vedam.org (any case)
--       is staff and is left out, with its payment and enrolment (a lead without an email still counts).
--       The returned column is still called created_d, so nothing that reads it changes: growth_rows_list
--       (in-window / all-time), growth__owned_leads → growth_perf, growth_weekly, growth_lead_timing.
--   * growth_mkt_meta() — campaigns come newest first (campaign_start desc), the same order as
--       growth_campaigns_list. Before: oldest first. The Influencer "Campaign" compare tab picked its two
--       default campaigns from the END of the list; it now takes them from the start (performance.tsx), so it
--       still opens on the two newest campaigns.
--
-- Not touched: growth__owned_leads, growth_perf, growth_weekly, growth_rows_list, growth_lead_timing (they only
-- read growth__leads), any table, RLS, grants, the Overview functions.
-- Rollback: supabase/rollback/0122_growth_ads_lead_rule_down.sql

create or replace function public.growth__leads(p_keys text[])
returns table (lead_id uuid, k text, created_d date, paid_d date, enrolled_d date)
language sql stable security definer set search_path to '' as $fn$
  select lm.lead_id,
         public.vsat__norm_utm(lm.primary_utm),
         (coalesce(lm.user_registration_date, lm.created_at) at time zone 'Asia/Kolkata')::date,   -- 0122: registration day (creation day when empty)
         (select (min(vp.paid_at) at time zone 'Asia/Kolkata')::date from public.vsat_payments vp where vp.lead_id = lm.lead_id),
         (select (min(coalesce(am.enrollment_paid_at, am.last_updated_date)) at time zone 'Asia/Kolkata')::date
            from public.application_manager am where am.lead_id = lm.lead_id and am.enrollment_stage = 'approved')
    from public.lead_manager lm
   where public.vsat__norm_utm(lm.primary_utm) = any (p_keys)
     and (lm.registered_email is null or lm.registered_email not ilike '%@vedam.org');   -- 0122: staff are not leads
$fn$;

create or replace function public.growth_mkt_meta()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  perform public.growth__admin();
  return jsonb_build_object(
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'campaign_start', c.campaign_start,
        'campaign_end', c.campaign_end, 'exam_date', c.exam_date, 'budget', c.budget, 'application_target', c.application_target,
        'used', (select count(*) from public.growth_ad_rows a where a.campaign_id = c.id)
              + (select count(*) from public.growth_infl_posts a where a.campaign_id = c.id))
        order by c.campaign_start desc nulls last, c.name) from public.vsat_campaigns c), '[]'::jsonb),   -- 0122: newest first, as growth_campaigns_list
    'columns', coalesce((select jsonb_agg(jsonb_build_object('channel', x.channel, 'key', x.col_key, 'label', x.label, 'type', x.col_type,
        'required', x.required, 'options', x.options) order by x.channel, x.display_order, x.created_at)
        from public.growth_custom_columns x where x.deleted_at is null), '[]'::jsonb),
    'influencers', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'channel_link', i.channel_link) order by lower(i.name))
        from public.growth_influencers i), '[]'::jsonb),
    'ad_platforms', '["Meta","Google"]'::jsonb,
    'infl_platforms', '["YouTube - Dedicated","YouTube - Integrated","YouTube - Semi-Dedicated","YouTube Shorts","YouTube - Generic","Instagram Reel","Instagram Story"]'::jsonb);
end $fn$;

-- create or replace keeps the grants of 0105; restated so this file is complete on its own
revoke all on function public.growth__leads(text[]) from public, anon, authenticated;
revoke all on function public.growth_mkt_meta() from public, anon;
grant execute on function public.growth_mkt_meta() to authenticated;
