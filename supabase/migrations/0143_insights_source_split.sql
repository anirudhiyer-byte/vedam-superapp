-- 0143 · Insights — source-wise registrant split per product.
--
-- For each product, break registrants into marketing-source buckets with Registrations and MQR
-- (the UI derives the %s: MQR-rate, % source split, % MQR split). Classification is by the
-- PRIMARY first-touch campaign (utm_primary = "source/medium/campaign"), falling back to the
-- raw utm_source only when utm_primary is empty — this resolves flow-labels like
-- "Early registration"/"calling" to their real first-touch source (Telegram, vedam_website, …).
--
-- Buckets (owner-defined): Meta / Google (split out of paid by medium), Telegram, WhatsApp
-- (incl. community), Website (vedam_website + organic_search), Email, School Connect
-- (schoolconnect + vsatoffline), Influencers (youtube/instagram), Direct/Unknown, Other.
-- Excluded everywhere: test data (zz_dummy_campaign / zz* / medium 'dummy') and internal
-- @vedam.org / @vedamcoms.org emails (same policy as the other dashboards, 0142).
--
-- Products: all (overall Vedam One) · bootcamp · codesprint · pyq · vsat_early · vsat_exam.
-- vsat_exam reads application_manager (its own primary_utm_source/medium) and can be filtered to
-- one VSAT via p_vsat (= vsat_exam_dates.id); ins_vsats() lists the exams for the dropdown.
-- Rollback: supabase/rollback/0143_insights_source_split_down.sql.

-- ── bucket a (normalized) primary source + medium into a marketing channel ──
create or replace function public.ins__bucket(p_src text, p_med text)
 returns text language sql immutable set search_path to ''
as $function$
  select case
    when p_src = 'google' then 'Google'
    when p_src = 'paid' and lower(coalesce(p_med,'')) like '%google%' then 'Google'
    when p_src = 'meta' then 'Meta'
    when p_src = 'paid' then 'Meta'                              -- paid is Meta unless flagged Google above
    when p_src in ('youtube','instagram') then 'Influencers'
    when p_src = 'telegram' then 'Telegram'
    when p_src in ('whatsapp','community') then 'WhatsApp'
    when p_src in ('vedam_website','organic_search','organic') then 'Website'
    when p_src = 'email' then 'Email'
    when p_src in ('schoolconnect','vsatoffline') then 'School Connect'
    when p_src is null or p_src = '' or p_src in ('unknown','direct') then 'Direct/Unknown'
    else 'Other'
  end
$function$;
revoke all on function public.ins__bucket(text, text) from public, anon;
grant execute on function public.ins__bucket(text, text) to authenticated;

-- ── VSAT exam list for the "which VSAT" dropdown ────────────────────────────
create or replace function public.ins_vsats()
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORISED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'label', d.label, 'exam_date', d.exam_date
         ) order by d.exam_date desc nulls last), '[]'::jsonb)
    into v from public.vsat_exam_dates d;
  return v;
end $function$;
revoke all on function public.ins_vsats() from public, anon;
grant execute on function public.ins_vsats() to authenticated;

-- ── the split itself ────────────────────────────────────────────────────────
create or replace function public.ins_source_split(p_product text, p_from timestamptz, p_to timestamptz, p_vsat uuid default null)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare
  v jsonb;
  v_lo timestamptz := coalesce(p_from, '-infinity');
  v_hi timestamptz := coalesce(p_to, 'infinity');
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORISED'; end if;
  if p_product is null or p_product not in ('all','bootcamp','codesprint','pyq','vsat_early','vsat_exam') then
    raise exception 'product_invalid' using errcode = '22023';
  end if;

  with rows as (
    -- profile-based products: Vedam One sign-ups / product users, classified by their primary source
    select
      public.ins__bucket(
        public.ins__src(coalesce(nullif(split_part(coalesce(p.utm_primary,''),'/',1),''), p.utm_source)),
        coalesce(nullif(split_part(coalesce(p.utm_primary,''),'/',2),''), p.utm_medium)
      ) as bucket,
      coalesce(p.stream in ('PCM','PCMB') and p.grad_year in (2026,2027), false) as is_mqr
    from public.profiles p
    where p_product <> 'vsat_exam'
      and (
        (p_product = 'all' and p.created_at >= v_lo and p.created_at < v_hi)
        or (p_product <> 'all' and p.id in (
             select u.user_id from public.ins__product_users(
               case p_product when 'vsat_early' then 'vsat' else p_product end, p_from, p_to) u))
      )
      and not public.app__is_internal_email(p.email)
      and coalesce(p.utm_campaign,'') <> 'zz_dummy_campaign'
      and lower(coalesce(p.utm_medium,'')) <> 'dummy'
      and public.ins__src(coalesce(nullif(split_part(coalesce(p.utm_primary,''),'/',1),''), p.utm_source)) not like 'zz%'

    union all

    -- VSAT exam applicants: application_manager, its own parsed primary_utm_*, optional exam filter
    select
      public.ins__bucket(public.ins__src(am.primary_utm_source), am.primary_utm_medium) as bucket,
      coalesce(p.stream in ('PCM','PCMB') and p.grad_year in (2026,2027), false) as is_mqr
    from public.application_manager am
    left join public.profiles p on p.id = am.lead_id
    where p_product = 'vsat_exam'
      and (p_vsat is null or am.exam_date_id = p_vsat)
      and am.created_at >= v_lo and am.created_at < v_hi
      and not public.app__is_internal_email(coalesce(am.registered_email, p.email))
      and coalesce(am.primary_utm_campaign,'') <> 'zz_dummy_campaign'
      and public.ins__src(am.primary_utm_source) not like 'zz%'
  ),
  agg as (
    select bucket, count(*)::int as registrations, count(*) filter (where is_mqr)::int as mqr
    from rows group by bucket
  ),
  tot as (select coalesce(sum(registrations),0)::int treg, coalesce(sum(mqr),0)::int tmqr from agg)
  select jsonb_build_object(
    'product', p_product,
    'total_registrations', (select treg from tot),
    'total_mqr', (select tmqr from tot),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
              'bucket', a.bucket, 'registrations', a.registrations, 'mqr', a.mqr)
              order by a.registrations desc, a.bucket) from agg a), '[]'::jsonb)
  ) into v;
  return v;
end $function$;
revoke all on function public.ins_source_split(text, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.ins_source_split(text, timestamptz, timestamptz, uuid) to authenticated;
