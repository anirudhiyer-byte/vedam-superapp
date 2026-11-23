-- 0156 · VSAT offer (Acceptance) letter
--
-- 1. vsat_offer_letter(p): the data the server needs to draw a student's Acceptance Letter PDF
--    (src/lib/vsat/offer-letter-pdf.ts). Two callers, both signed in:
--      · the student, p = {}            → their own current offer (Offer sent / Enrolled, not cancelled)
--      · admin / admissions, p = {application_id} → any released offer on a campus they manage (vsat__can_manage)
--    Returns {available:false, reason} when there is nothing to show; never another student's data.
-- 2. The "Offer released → student" email gets the admissions team's wording (the letter goes with it as a PDF).
--    Only when the step still has the 0144 text, so an admin's own edits are never overwritten.
--
-- Rollback: supabase/rollback/0156_vsat_offer_letter_down.sql

-- ═════════════ 1. letter data ═════════════
create or replace function public.vsat_offer_letter(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  uid uuid := auth.uid();
  v_app text;
  am public.application_manager;
  v_stage text;
  v_campus text;
  v_fee numeric;
  v_days int;
  v_manager boolean := false;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb), array['application_id']);
  v_app := nullif(btrim(coalesce(p ->> 'application_id', '')), '');

  if v_app is not null then
    select * into am from public.application_manager a where a.application_id = v_app;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
    if not public.vsat__can_manage(public.vsat__campus_key(am.campus_applied)) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    v_manager := true;
  else
    select a.* into am
      from public.application_manager a
      join public.vsat_pipeline x on x.application_id = a.application_id
     where a.lead_id = uid
     order by a.offer_released_at desc nulls last, x.stage_changed_at desc
     limit 1;
    if not found then return jsonb_build_object('available', false, 'reason', 'NO_OFFER'); end if;
  end if;

  select x.stage into v_stage from public.vsat_pipeline x where x.application_id = am.application_id;
  if am.offer_released_at is null then return jsonb_build_object('available', false, 'reason', 'NO_OFFER'); end if;
  if not v_manager and (coalesce(am.offer_cancelled, false) or v_stage is null or v_stage not in ('offer_sent', 'enrolled')) then
    return jsonb_build_object('available', false, 'reason', 'NOT_ACTIVE');
  end if;

  v_campus := public.vsat__campus_key(am.campus_applied);
  if v_campus is null then return jsonb_build_object('available', false, 'reason', 'CAMPUS_MISSING'); end if;
  select s.programme_fee, s.offer_days into v_fee, v_days from public.vsat_campus_settings s where s.campus = v_campus;

  return jsonb_build_object(
    'available', true,
    'application_id', am.application_id,
    'application_no', am.application_no,
    'name', am.registered_name,
    'campus', v_campus,
    'scholarship_pct', am.scholarship_percentage,
    'programme_fee', v_fee,
    'offer_days', v_days,
    'seat_block', (select f.value from public.app_flags f where f.key = 'enrollment_fee'),
    'released_at', am.offer_released_at,
    'expires_at', am.offer_expires_at,
    'stage', v_stage,
    'offer_status', am.offer_status);
end $$;

revoke all on function public.vsat_offer_letter(jsonb) from public, anon;
grant execute on function public.vsat_offer_letter(jsonb) to authenticated;
comment on function public.vsat_offer_letter(jsonb) is
  'VSAT Acceptance Letter data. Student: own current offer (p = {}). Admin/admissions: {application_id} on a campus they manage. Read-only.';

-- ═════════════ 2. offer email wording (only if still the 0144 text) ═════════════
update public.vsat_comm_steps
   set email_body = '<p>Dear {{student_name}},</p>'
     || '<p>Congratulations on successfully completing your counseling session at Vedam School of Technology! We are thrilled to offer you admission to our institution, where innovation and excellence come to life.</p>'
     || '<p><b>Next Steps –</b></p>'
     || '<p><b>Confirm Your Admission</b> – Please review, sign, and return the Acceptance letter at the earliest to confirm your spot.</p>'
     || '<p><b>Make Your Payment</b> – A payment of INR {{amount}} is required to secure your seat. We encourage you to complete this step at the earliest via your student dashboard- <a href="{{dashboard_link}}">{{dashboard_link}}</a></p>'
     || '<p>Log on to your student dashboard and you will see an ‘Enroll · pay’ button.</p>'
     || '<p>Click on the button and you will be redirected to the payment page- where you can make the payment through UPI, Credit card, Debit card and online bank transfer.</p>'
     || '<p>As part of the documentation verification process of the university you will be required to submit all the relevant documents- the details of which will be shared with you soon.</p>'
     || '<p><b>Note:</b> This Acceptance letter, along with the accompanying scholarship benefits, remains valid for {{offer_days}} days from the date the letter is received. This opportunity is time-sensitive—failure to respond within the stipulated period will result in the forfeiture of both the scholarship and your admission to the school.</p>'
     || '<p><b>Re-Counseling Option:</b><br>If you have any new doubts or would like further clarification before confirming your admission, you have the option to request a re-counseling session. Please note that this option is available only within the {{offer_days}}-day validity window of this offer letter.</p>'
     || '<p>The Seats are filling up quickly, and we wouldn’t want you to miss out on this incredible opportunity to be part of Vedam’s dynamic learning environment!</p>'
     || '<p>If you have any questions or need assistance, feel free to reach out.</p>'
     || '<p>Campus Brochure - <a href="https://bit.ly/4dzLkCG">https://bit.ly/4dzLkCG</a></p>'
     || '<p>Inside Vedam’s Placement-Focused Learning System - <a href="https://shorturl.at/pLJIn">https://shorturl.at/pLJIn</a></p>'
     || '<p>We look forward to welcoming you to the Vedam family!</p>',
       updated_at = now()
 where step_key = 'offer_released'
   and md5(email_body) = 'c3326d13446460aa93c9708c9d81ba89';
