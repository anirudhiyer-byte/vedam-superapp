-- Rollback of 0122 · Growth · Ads / Influencers lead rule and campaign order
--
-- Puts back growth__leads and growth_mkt_meta exactly as 0105 made them: leads by created_at with staff
-- included; campaigns oldest first. No data is changed.
-- If you run this, also put back the two default-campaign lines in src/components/admin/marketing/performance.tsx
-- (meta.campaigns[length - 2] / [length - 1]), or the Influencer compare tab opens on the two oldest campaigns.

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

revoke all on function public.growth__leads(text[]) from public, anon, authenticated;
revoke all on function public.growth_mkt_meta() from public, anon;
grant execute on function public.growth_mkt_meta() to authenticated;
