-- 0116 · Growth · VSAT Campaign Report (VSAT Admin → Growth → Overview → VSAT Campaign Report), admin only.
--
-- Copy of the Vedam CRM page /morning-report on Vedam One's own data. One campaign (vsat_campaigns), 4 cards and a
-- 7-row matrix split by campus (Total / GGN / Pune). Rules follow the CRM code (app/(app)/morning-report/page.tsx) and
-- the CRM's attribution model: every metric counts by its OWN event date inside the campaign window (IST days).
--
--   today        = the IST date, decided here (never sent by the browser)
--   window       = campaign_start .. least(today, campaign_end)          (a future campaign has an empty window)
--   over/frozen  = today > campaign_end
--   achievement  = paid in the window
--   today / yesterday rows   = that day, only when the day is inside campaign_start..campaign_end, else 0
--   last 3 days  = greatest(today-3, start) .. least(today-1, end); valid only when from <= to and from is inside the
--                  campaign; not valid → 0 (the page adds "— outside campaign" to the label)
--   paid         = public.growth__season_ids('paid', …) — the Season Dashboard rule (0109): first vsat_payments.paid_at
--                  per lead, IST date, only leads that exist in lead_manager. ("paid" is ONLY vsat_payments.)
--                  Campus of a payment = the application's campus_applied, else the lead's campus_preference
--                  (the CRM splits payments by the application's campus).
--   leads        = lead_manager by the IST date of user_registration_date (CRM rule; indexed), excluding
--                  registered_email ending in @vedam.org (any case). Leads without an email still count.
--   campus       = public.growth__campus(text): gurugram|sushant|ggn → GGN, pune|adypu → PUNE, else OTHER
--                  (case-insensitive; same as the CRM and as src/lib/growth/campus.ts).
--   default campaign (no id sent) = running today (latest start) → else the latest that has started → else the
--                  latest start overall → none: campaign null. Only campaigns with both dates are candidates.
--   no dates     = vsat_campaigns allows null start/end (older rows): such a campaign shows all 0, never errors.
--
-- growth__lead_rows / growth__paid_rows / growth__campus are written to be reused by the Payment Cohort page.
--
-- Security: admin only (growth__admin → is_admin()), checked first inside the public function. SECURITY DEFINER,
-- search_path '', revoked from public/anon, granted to authenticated. The private helpers are revoked from everyone
-- (also authenticated). Request: only `campaign_id` (uuid) is accepted; unknown keys are refused. Read only.
--
-- Not touched: any table, RLS, existing function (growth__season_ids is only called).
-- Rollback: supabase/rollback/0116_growth_vcamp_report_down.sql
-- Tests:    supabase/tests/growth_vcamp.test.sql

-- campus bucket (pure)
create or replace function public.growth__campus(p text)
returns text language sql immutable set search_path to '' as $fn$
  select case
           when p ilike '%gurugram%' or p ilike '%sushant%' or p ilike '%ggn%' then 'GGN'
           when p ilike '%pune%' or p ilike '%adypu%' then 'PUNE'
           else 'OTHER'
         end;
$fn$;

-- leads registered on IST days p_from..p_to (one row per lead)
create or replace function public.growth__lead_rows(p_from date, p_to date)
returns table (lead_id uuid, lead_on date, email text, campus text)
language sql stable security definer set search_path to '' as $fn$
  select lm.lead_id,
         (lm.user_registration_date at time zone 'Asia/Kolkata')::date,
         lm.registered_email,
         public.growth__campus(lm.campus_preference)
    from public.lead_manager lm
   where lm.user_registration_date >= (p_from::timestamp at time zone 'Asia/Kolkata')
     and lm.user_registration_date < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
$fn$;

-- leads who paid (first payment) on IST days p_from..p_to, Season Dashboard rule; one row per lead
create or replace function public.growth__paid_rows(p_from date, p_to date)
returns table (lead_id uuid, paid_on date, lead_on date, campus text)
language sql stable security definer set search_path to '' as $fn$
  select s.id,
         (select (min(vp.paid_at) at time zone 'Asia/Kolkata')::date from public.vsat_payments vp where vp.lead_id = s.id),
         (lm.user_registration_date at time zone 'Asia/Kolkata')::date,
         public.growth__campus(coalesce(
           (select nullif(btrim(am.campus_applied), '') from public.application_manager am
             where am.lead_id = s.id order by am.created_at desc nulls last limit 1),
           lm.campus_preference))
    from public.growth__season_ids('paid', p_from, p_to, null) s(id)
    join public.lead_manager lm on lm.lead_id = s.id;
$fn$;

-- default campaign for an IST day (CRM rule); a campaign without both dates is never the default
create or replace function public.growth__vcamp_default(p_today date)
returns uuid language sql stable security definer set search_path to '' as $fn$
  select coalesce(
    (select c.id from public.vsat_campaigns c where c.campaign_start <= p_today and p_today <= c.campaign_end
      order by c.campaign_start desc, c.created_at desc nulls last limit 1),
    (select c.id from public.vsat_campaigns c where c.campaign_start <= p_today and c.campaign_end is not null
      order by c.campaign_start desc, c.created_at desc nulls last limit 1),
    (select c.id from public.vsat_campaigns c where c.campaign_start is not null and c.campaign_end is not null
      order by c.campaign_start desc, c.created_at desc nulls last limit 1));
$fn$;

-- the whole report for one campaign on one IST day
create or replace function public.growth__vcamp_data(p_id uuid, p_today date)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  c public.vsat_campaigns%rowtype;
  zero constant jsonb := '{"total":0,"ggn":0,"pune":0,"other":0}';
  y date := p_today - 1;
  cut date; t3_from date; t3_to date; t3_ok boolean; today_in boolean; yday_in boolean;
  ach jsonb; tp jsonb; yp jsonb; l3 jsonb; tl jsonb; yl jsonb; al jsonb;
begin
  select * into c from public.vsat_campaigns where id = p_id;
  if not found then raise exception 'NOT_FOUND' using errcode = '22023'; end if;

  -- the columns allow a campaign without dates (older rows); it has no window, so every number is 0
  if c.campaign_start is null or c.campaign_end is null then
    return jsonb_build_object(
      'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'campaign_start', c.campaign_start, 'campaign_end', c.campaign_end,
                                     'application_target', coalesce(c.application_target, 0)),
      'today', p_today, 'over', false, 'last3_valid', false,
      'rows', jsonb_build_object('achievement', zero, 'today_pay', zero, 'yday_pay', zero, 'last3_pay', zero,
                                 'today_leads', zero, 'yday_leads', zero, 'total_leads', zero));
  end if;

  cut := least(p_today, c.campaign_end);
  today_in := p_today between c.campaign_start and c.campaign_end;
  yday_in := y between c.campaign_start and c.campaign_end;
  t3_from := greatest(p_today - 3, c.campaign_start);
  t3_to := least(y, c.campaign_end);
  t3_ok := t3_from <= t3_to and t3_from between c.campaign_start and c.campaign_end;

  select jsonb_build_object('total', count(*), 'ggn', count(*) filter (where r.campus = 'GGN'),
                            'pune', count(*) filter (where r.campus = 'PUNE'), 'other', count(*) filter (where r.campus = 'OTHER'))
    into ach from public.growth__paid_rows(c.campaign_start, cut) r;
  tp := zero; yp := zero; l3 := zero; tl := zero; yl := zero;
  if today_in then
    select jsonb_build_object('total', count(*), 'ggn', count(*) filter (where r.campus = 'GGN'),
                              'pune', count(*) filter (where r.campus = 'PUNE'), 'other', count(*) filter (where r.campus = 'OTHER'))
      into tp from public.growth__paid_rows(p_today, p_today) r;
    select jsonb_build_object('total', count(*), 'ggn', count(*) filter (where r.campus = 'GGN'),
                              'pune', count(*) filter (where r.campus = 'PUNE'), 'other', count(*) filter (where r.campus = 'OTHER'))
      into tl from public.growth__lead_rows(p_today, p_today) r where r.email is null or r.email not ilike '%@vedam.org';
  end if;
  if yday_in then
    select jsonb_build_object('total', count(*), 'ggn', count(*) filter (where r.campus = 'GGN'),
                              'pune', count(*) filter (where r.campus = 'PUNE'), 'other', count(*) filter (where r.campus = 'OTHER'))
      into yp from public.growth__paid_rows(y, y) r;
    select jsonb_build_object('total', count(*), 'ggn', count(*) filter (where r.campus = 'GGN'),
                              'pune', count(*) filter (where r.campus = 'PUNE'), 'other', count(*) filter (where r.campus = 'OTHER'))
      into yl from public.growth__lead_rows(y, y) r where r.email is null or r.email not ilike '%@vedam.org';
  end if;
  if t3_ok then
    select jsonb_build_object('total', count(*), 'ggn', count(*) filter (where r.campus = 'GGN'),
                              'pune', count(*) filter (where r.campus = 'PUNE'), 'other', count(*) filter (where r.campus = 'OTHER'))
      into l3 from public.growth__paid_rows(t3_from, t3_to) r;
  end if;
  select jsonb_build_object('total', count(*), 'ggn', count(*) filter (where r.campus = 'GGN'),
                            'pune', count(*) filter (where r.campus = 'PUNE'), 'other', count(*) filter (where r.campus = 'OTHER'))
    into al from public.growth__lead_rows(c.campaign_start, cut) r where r.email is null or r.email not ilike '%@vedam.org';

  return jsonb_build_object(
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'campaign_start', c.campaign_start, 'campaign_end', c.campaign_end,
                                   'application_target', coalesce(c.application_target, 0)),
    'today', p_today,
    'over', p_today > c.campaign_end,
    'last3_valid', t3_ok,
    'rows', jsonb_build_object('achievement', ach, 'today_pay', tp, 'yday_pay', yp, 'last3_pay', l3,
                               'today_leads', tl, 'yday_leads', yl, 'total_leads', al));
end $fn$;

-- public: the page calls only this
create or replace function public.growth_vcamp_report(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_id uuid;
begin
  perform public.growth__admin();
  p := coalesce(p, '{}'::jsonb);
  perform public.growth__keys(p, array['campaign_id']);
  if p ? 'campaign_id' and jsonb_typeof(p->'campaign_id') <> 'null' then
    if jsonb_typeof(p->'campaign_id') <> 'string' or char_length(p->>'campaign_id') > 64 then
      raise exception 'BAD_VALUE: campaign_id' using errcode = '22023';
    end if;
    begin v_id := (p->>'campaign_id')::uuid;
    exception when others then raise exception 'BAD_VALUE: campaign_id' using errcode = '22023'; end;
  else
    v_id := public.growth__vcamp_default(v_today);
    if v_id is null then return jsonb_build_object('campaign', null, 'today', v_today); end if;
  end if;
  return public.growth__vcamp_data(v_id, v_today);
end $fn$;

-- grants: browsers may call only growth_vcamp_report
revoke all on function public.growth__campus(text) from public, anon, authenticated;
revoke all on function public.growth__lead_rows(date, date) from public, anon, authenticated;
revoke all on function public.growth__paid_rows(date, date) from public, anon, authenticated;
revoke all on function public.growth__vcamp_default(date) from public, anon, authenticated;
revoke all on function public.growth__vcamp_data(uuid, date) from public, anon, authenticated;
revoke all on function public.growth_vcamp_report(jsonb) from public, anon;
grant execute on function public.growth_vcamp_report(jsonb) to authenticated;
