-- 0157 · VSAT offers — a reminder on the last day and an email when the offer lapses (staging first).
--
-- Decisions (owner, 23 Nov 2026):
--   * One reminder, on the offer's last day at 10:00 am IST ("today is the last day"), only while the fee is not paid.
--     The deadline is always 11:59:59 pm IST of the last day, so the student has about 14 hours left.
--   * One email when the offer lapses (the deadline passed without payment, or someone moved the student to
--     Offer lapsed). Not sent when the fee was paid after all (the student is Enrolled).
--   * Two new VSAT comms steps, OFF and in test mode until an admin turns them on (like every other step). Email only.
--     The copy is a draft for the admissions team to change in VSAT comms.
--
-- Built on 0144 (the offer outbox). The same outbox and the same server job send all three offer emails:
--   vsat_offer_events.kind   + 'reminder' (one per offer: unique on application + release time)
--   lapse events             now queue an email (notify_status 'pending'); before 0157 they had none
--   vsat__offers_remind()    pg_cron job vsat-offer-remind (every 15 minutes): queues the reminders that are due
--                            (p_now only for the tests; the job passes nothing = now())
--   vsat_offer_notices_claim replaced: a job is sent only while it still fits —
--                              released / reminder: the same offer is current, not cancelled, before the deadline
--                                                   (reminder: and the fee is not paid);
--                              lapsed: the student is still at Offer lapsed for that offer and has not paid.
--                            Everything else is closed as skipped (why: not_current), as in 0144.
--
-- Rollback: supabase/rollback/0157_vsat_offer_reminders_down.sql
-- Tests:    supabase/tests/vsat_offer_reminders.test.sql (+ vsat_offer_release.test.sql, updated for the lapse email)

-- ═════════════ 1. the outbox takes reminders ═════════════
alter table public.vsat_offer_events drop constraint if exists vsat_offer_events_kind_check;
alter table public.vsat_offer_events add constraint vsat_offer_events_kind_check
  check (kind in ('released', 'lapsed', 'cancelled', 'reminder'));
create unique index if not exists vsat_offer_events_reminder_key
  on public.vsat_offer_events (application_id, released_at) where kind = 'reminder';

-- ═════════════ 2. VSAT comms: two offer steps (off + test mode) ═════════════
alter table public.vsat_comm_steps drop constraint if exists vsat_comm_steps_step_key_check;
alter table public.vsat_comm_steps add constraint vsat_comm_steps_step_key_check check (step_key in (
  'first_half', 'application_started', 'payment_reminder_24h', 'payment_confirmed',
  'interview_invite', 'interview_rescheduled', 'interview_cancelled',
  'interviewer_invite', 'interviewer_rescheduled', 'interviewer_cancelled',
  'offer_released',
  'counselling_invite', 'counselling_rescheduled', 'counselling_cancelled',
  'counsellor_invite', 'counsellor_rescheduled', 'counsellor_cancelled',
  'offer_reminder', 'offer_lapsed'));

insert into public.vsat_comm_steps (step_key, title, sort, wa_enabled, email_subject, email_body) values
  ('offer_reminder', 'Offer: last day reminder → student', 21, false,
   'Today is the last day to accept your Vedam offer',
   '<p>Dear {{student_name}},</p><p>This is a reminder that <b>today is the last day</b> to accept your admission offer at Vedam School of Technology, {{campus}} campus, with a <b>{{scholarship}}% scholarship</b>.</p><p>To confirm your seat, pay the seat blocking amount of <b>INR {{amount}}</b> by <b>{{deadline_date}}, {{deadline_time}} IST</b> from your student dashboard: <a href="{{dashboard_link}}">{{dashboard_link}}</a></p><p>Log on to your student dashboard and click the ‘Enroll · pay’ button. You can pay through UPI, credit card, debit card or online bank transfer.</p><p>After this time, the offer and the scholarship expire.</p><p>If you have any questions, reply to this email and the admissions team will help you.</p><p>We look forward to welcoming you to the Vedam family!</p>'),
  ('offer_lapsed', 'Offer lapsed → student', 22, false,
   'Your Vedam admission offer has expired',
   '<p>Dear {{student_name}},</p><p>The last day to accept your admission offer at Vedam School of Technology, {{campus}} campus, was {{deadline_date}} ({{deadline_time}} IST). As the seat blocking amount was not paid by then, the offer and the {{scholarship}}% scholarship have expired.</p><p>If you still want to join Vedam, reply to this email and the admissions team will tell you what you can do next.</p><p>Warm regards,<br>Team Vedam</p>')
on conflict (step_key) do nothing;

-- ═════════════ 3. a lapse queues its email ═════════════
-- Same as 0144 except the lapse event: notify_status 'pending' (the email "Offer lapsed → student").
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
      insert into public.vsat_offer_events (application_id, attempt_no, kind, scholarship_pct, released_at, expires_at, detail, actor_id, notify_status)
      values (new.application_id, new.attempt_no, 'lapsed', am.scholarship_percentage, am.offer_released_at, am.offer_expires_at,
              jsonb_build_object('from_stage', old.stage), new.stage_changed_by, 'pending');
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

-- ═════════════ 4. the reminder job ═════════════
-- pg_cron (every 15 minutes): offers whose last day has reached 10:00 am IST, still at Offer sent (active), not cancelled,
-- before the deadline, fee not paid, released before that 10:00 am → one reminder email each (once per offer).
-- p_now: the time to check against (tests only; null = now()).
create or replace function public.vsat__offers_remind(p_now timestamptz default null)
returns int language plpgsql security definer set search_path to '' as $$
declare n int; v_now timestamptz := coalesce(p_now, now());
begin
  with due as (
    select vp.application_id, vp.attempt_no, am.scholarship_percentage, am.offer_released_at, am.offer_expires_at
      from public.vsat_pipeline vp
      join public.application_manager am on am.application_id = vp.application_id
     where vp.stage = 'offer_sent' and vp.status = 'active'
       and am.offer_released_at is not null and am.offer_expires_at is not null
       and not coalesce(am.offer_cancelled, false)
       and coalesce(am.enrollment_stage, '') <> 'approved'
       and am.offer_expires_at > v_now
       and v_now >= (((am.offer_expires_at at time zone 'Asia/Kolkata')::date + time '10:00') at time zone 'Asia/Kolkata')
       and am.offer_released_at < (((am.offer_expires_at at time zone 'Asia/Kolkata')::date + time '10:00') at time zone 'Asia/Kolkata')
       and not exists (select 1 from public.vsat_offer_events ev
                        where ev.application_id = vp.application_id and ev.kind = 'reminder' and ev.released_at = am.offer_released_at)
     order by am.offer_expires_at
     limit 500
  )
  insert into public.vsat_offer_events (application_id, attempt_no, kind, scholarship_pct, released_at, expires_at, notify_status)
  select due.application_id, due.attempt_no, 'reminder', due.scholarship_percentage, due.offer_released_at, due.offer_expires_at, 'pending'
    from due
  on conflict (application_id, released_at) where kind = 'reminder' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ═════════════ 5. the outbox hands out only jobs that still fit ═════════════
-- Same as 0144 except the "not current" rule, which now depends on the kind.
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
                      where vp.application_id = ev.application_id
                        and am.offer_released_at = ev.released_at
                        and (   (ev.kind = 'released' and vp.stage = 'offer_sent'
                                 and not coalesce(am.offer_cancelled, false) and am.offer_expires_at > now())
                             or (ev.kind = 'reminder' and vp.stage = 'offer_sent' and vp.status = 'active'
                                 and not coalesce(am.offer_cancelled, false) and am.offer_expires_at > now()
                                 and coalesce(am.enrollment_stage, '') <> 'approved')
                             or (ev.kind = 'lapsed' and vp.stage = 'offer_lapsed'
                                 and coalesce(am.enrollment_stage, '') <> 'approved')));

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

-- ═════════════ 6. who may run what ═════════════
revoke all on function public.vsat__offers_remind(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.vsat__on_offer_stage() from public, anon, authenticated;
revoke all on function public.vsat_offer_notices_claim(jsonb) from public, anon, authenticated;
grant execute on function public.vsat_offer_notices_claim(jsonb) to service_role;

-- ═════════════ 7. the reminder job ═════════════
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'vsat-offer-remind') then perform cron.unschedule('vsat-offer-remind'); end if;
    perform cron.schedule('vsat-offer-remind', '1,16,31,46 * * * *', 'select public.vsat__offers_remind()');
  else
    raise notice 'pg_cron is not installed: run select public.vsat__offers_remind() every 15 minutes some other way';
  end if;
end $$;
