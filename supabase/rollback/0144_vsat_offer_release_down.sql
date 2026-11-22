-- Rollback for 0144_vsat_offer_release.sql (staging first).
-- Removes the offer trigger, the lapse job, the release RPC, the email outbox and the offer email step, and puts
-- vsat__on_enrollment back as it was (0114). Offers already released stay as they are on application_manager
-- (students can still pay them); nothing lapses them any more and moving to Offer sent goes back to changing
-- the stage only.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'vsat-offer-lapse') then
    perform cron.unschedule('vsat-offer-lapse');
  end if;
end $$;

drop trigger if exists vsat_offer_stage on public.vsat_pipeline;

drop function if exists public.vsat_offer_notice_done(jsonb);
drop function if exists public.vsat_offer_notices_claim(jsonb);
drop function if exists public.vsat_offers_release(jsonb);
drop function if exists public.vsat__offers_lapse();
drop function if exists public.vsat__on_offer_stage();
drop function if exists public.vsat__offer_release(text, int, uuid);
drop function if exists public.vsat__offer_deadline(text, timestamptz);

-- as in 0114
CREATE OR REPLACE FUNCTION public.vsat__on_enrollment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare st text; stt text;
begin
  if new.enrollment_stage = 'approved' and (tg_op = 'INSERT' or coalesce(old.enrollment_stage, '') <> 'approved') then
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = new.application_id;
    if st is not null and stt = 'active' and public.vsat__stage_order(st) < public.vsat__stage_order('enrolled') then
      begin perform public.vsat__move(new.application_id, 'enrolled', 'active', null, 'system', null, null); exception when others then null; end;
    end if;
  end if;
  return null;
end $function$;

delete from public.vsat_comm_steps where step_key = 'offer_released';
alter table public.vsat_comm_steps drop constraint if exists vsat_comm_steps_step_key_check;
alter table public.vsat_comm_steps add constraint vsat_comm_steps_step_key_check check (step_key in (
  'first_half', 'application_started', 'payment_reminder_24h', 'payment_confirmed',
  'interview_invite', 'interview_rescheduled', 'interview_cancelled',
  'interviewer_invite', 'interviewer_rescheduled', 'interviewer_cancelled'));

drop table if exists public.vsat_offer_events;
