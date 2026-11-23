-- Rollback of 0157 · VSAT offer reminder + lapsed emails.
-- Puts back the 0144 functions (copied from 0144 as they are), removes the reminder job, the two comms steps and the
-- reminder events, and closes lapse emails that are still queued (0144 sent none).
-- Test on staging inside one transaction: down → compare md5(prosrc) + ACLs with the 0144 snapshot → up.

-- the reminder job
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'vsat-offer-remind') then
    perform cron.unschedule('vsat-offer-remind');
  end if;
end $$;
drop function if exists public.vsat__offers_remind(timestamptz);

-- 0144 functions
create or replace function public.vsat__on_offer_stage()
returns trigger language plpgsql security definer set search_path to '' as $$
declare am public.application_manager;
begin
  if new.stage is not distinct from old.stage then return null; end if;

  if new.stage = 'offer_sent' then
    perform public.vsat__offer_release(new.application_id, new.attempt_no, new.stage_changed_by);

  elsif new.stage = 'offer_lapsed' then
    update public.application_manager a set offer_status = 'lapsed', last_updated_date = now()
     where a.application_id = new.application_id and a.offer_released_at is not null
    returning * into am;
    if found then
      insert into public.vsat_offer_events (application_id, attempt_no, kind, scholarship_pct, released_at, expires_at, detail, actor_id)
      values (new.application_id, new.attempt_no, 'lapsed', am.scholarship_percentage, am.offer_released_at, am.offer_expires_at,
              jsonb_build_object('from_stage', old.stage), new.stage_changed_by);
    end if;

  elsif new.stage = 'offer_cancelled'
        or (old.stage in ('offer_sent', 'offer_lapsed') and public.vsat__stage_order(new.stage) < public.vsat__stage_order('offer_sent')) then
    -- the fee can no longer be paid
    update public.application_manager a set offer_cancelled = true, offer_status = 'cancelled', last_updated_date = now()
     where a.application_id = new.application_id and a.offer_released_at is not null and not coalesce(a.offer_cancelled, false)
    returning * into am;
    if found then
      insert into public.vsat_offer_events (application_id, attempt_no, kind, scholarship_pct, released_at, expires_at, detail, actor_id)
      values (new.application_id, new.attempt_no, 'cancelled', am.scholarship_percentage, am.offer_released_at, am.offer_expires_at,
              jsonb_build_object('from_stage', old.stage, 'to_stage', new.stage), new.stage_changed_by);
    end if;
  end if;
  return null;
end $$;

create or replace function public.vsat_offer_notices_claim(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare lim int; ids text[]; claimed uuid[];
begin
  p := coalesce(p, '{}'::jsonb);
  perform public.vsat__check_keys(p, array['limit', 'application_ids']);
  lim := coalesce(public.vsat__num(p, 'limit', 1, 100, false), 20)::int;
  if p ? 'application_ids' then ids := public.vsat__iv_ids(p, 200); end if;

  update public.vsat_offer_events ev
     set notify_status = 'skipped', notify_detail = jsonb_build_object('why', 'not_current'), notified_at = now(), notify_claimed_at = null
   where ev.notify_status in ('pending', 'failed')
     and not exists (select 1 from public.vsat_pipeline vp
                       join public.application_manager am on am.application_id = vp.application_id
                      where vp.application_id = ev.application_id and vp.stage = 'offer_sent'
                        and am.offer_released_at = ev.released_at and not coalesce(am.offer_cancelled, false)
                        and am.offer_expires_at > now());

  with cand as (
    select ev.id
      from public.vsat_offer_events ev
     where (ev.notify_status = 'pending' or (ev.notify_status = 'sending' and ev.notify_claimed_at < now() - interval '10 minutes'))
       and ev.notify_attempts < 5
       and (ids is null or ev.application_id = any(ids))
     order by ev.created_at
     limit lim
       for update of ev skip locked
  ), upd as (
    update public.vsat_offer_events ev
       set notify_status = 'sending', notify_claimed_at = now(), notify_attempts = ev.notify_attempts + 1
      from cand
     where ev.id = cand.id
    returning ev.id
  )
  select array_agg(upd.id) into claimed from upd;

  if claimed is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', ev.id, 'kind', ev.kind, 'attempts', ev.notify_attempts,
             'sent_to', coalesce(ev.notify_detail->'sent_to', '[]'::jsonb),
             'scholarship_pct', ev.scholarship_pct, 'released_at', ev.released_at, 'expires_at', ev.expires_at,
             'amount', (select f.value from public.app_flags f where f.key = 'enrollment_fee'),
             'student', jsonb_build_object('name', am.registered_name, 'email', am.registered_email, 'lead_id', am.lead_id,
                                           'application_no', coalesce(am.application_no::text, am.application_id),
                                           'campus', public.vsat__campus_key(am.campus_applied)))
             order by ev.created_at)
      from public.vsat_offer_events ev
      join public.application_manager am on am.application_id = ev.application_id
     where ev.id = any(claimed)), '[]'::jsonb);
end $$;

revoke all on function public.vsat__on_offer_stage() from public, anon, authenticated;
revoke all on function public.vsat_offer_notices_claim(jsonb) from public, anon, authenticated;
grant execute on function public.vsat_offer_notices_claim(jsonb) to service_role;

-- queued lapse emails: 0144 never sent them
update public.vsat_offer_events
   set notify_status = 'skipped', notify_detail = jsonb_build_object('why', 'rollback_0157'), notified_at = now(), notify_claimed_at = null
 where kind = 'lapsed' and notify_status in ('pending', 'sending', 'failed');

-- reminder events and their index, then the 0144 kinds
delete from public.vsat_offer_events where kind = 'reminder';
drop index if exists public.vsat_offer_events_reminder_key;
alter table public.vsat_offer_events drop constraint if exists vsat_offer_events_kind_check;
alter table public.vsat_offer_events add constraint vsat_offer_events_kind_check check (kind in ('released', 'lapsed', 'cancelled'));

-- the two comms steps, then the 0145 step list
delete from public.vsat_comm_steps where step_key in ('offer_reminder', 'offer_lapsed');
alter table public.vsat_comm_steps drop constraint if exists vsat_comm_steps_step_key_check;
alter table public.vsat_comm_steps add constraint vsat_comm_steps_step_key_check check (step_key in (
  'first_half', 'application_started', 'payment_reminder_24h', 'payment_confirmed',
  'interview_invite', 'interview_rescheduled', 'interview_cancelled',
  'interviewer_invite', 'interviewer_rescheduled', 'interviewer_cancelled',
  'offer_released',
  'counselling_invite', 'counselling_rescheduled', 'counselling_cancelled',
  'counsellor_invite', 'counsellor_rescheduled', 'counsellor_cancelled'));
