-- 0144 · VSAT Phase 3, part 1 — release the offer, email it, lapse it after the deadline (staging first).
--
-- Found on staging (23 Nov 2026): nothing in the app set offer_released_at / offer_expires_at. Moving a student
-- to "Offer sent" only changed the stage, so the enrollment fee route answered "no_offer" and the dashboard never
-- showed the offer. Only the staging dummy seed filled those columns. Also, "Offer cancelled" did not stop the
-- fee (the payment gate reads application_manager.offer_cancelled, which nothing set).
--
-- Decisions (owner, 23 Nov 2026): Phase 3 = offer release + auto-lapse first, then counselling scheduling;
-- the offer letter PDF later. Rules settled from the existing code:
--   * Releasing = moving the student to Offer sent. Every path does the same thing (the new "Release offer"
--     button, the drawer's Move stage, the bulk move): a trigger on vsat_pipeline fills the offer fields the
--     payment gate checks (src/lib/payments/enroll-fee.ts offerPayable) and queues the offer email.
--   * The offer needs the scholarship % saved by counselling (vsat_submit_counselling). Without it the move to
--     Offer sent is refused (NO_SCHOLARSHIP).
--   * Deadline = the campus "Days to pay" (vsat_campus_settings.offer_days), until 11:59:59 pm IST of that day.
--   * A still-valid offer is kept as it is (moving back into Offer sent before the deadline changes nothing and
--     sends nothing). An expired or cancelled offer is issued again with a new deadline and a new email — this is
--     how admissions re-open a lapsed offer (Move stage → Offer sent, with a reason).
--   * Offer cancelled, or moving back to an earlier stage, cancels the offer: the fee can no longer be paid.
--   * pg_cron, every 15 minutes: offers past the deadline (fee not paid) move to Offer lapsed.
--   * A fee paid after the lapse (the payment was started before the deadline — the order route refuses expired
--     offers) still enrols the student.
--   * One email step "Offer released → student" in VSAT comms, OFF and in test mode until an admin turns it on.
--
-- What this adds
--   vsat_offer_events          history of every release / lapse / cancel; also the email outbox (release only)
--   vsat_comm_steps            + step offer_released
--   trigger on vsat_pipeline   vsat__on_offer_stage (stage changes into / out of the offer stages)
--   vsat_offers_release(p)     admin / admissions: release offers for the selected students (dry_run = preview)
--   vsat__offers_lapse()       pg_cron job vsat-offer-lapse (not callable by browsers or the API)
--   vsat__on_enrollment()      replaced: a paid fee also enrols a student whose offer has just lapsed
--   server only (service_role): vsat_offer_notices_claim(p), vsat_offer_notice_done(p)
--
-- Uses public.vsat__iv_ids from 0143 (apply 0140 → 0143 → 0144 on production; roll back in reverse).
-- Rollback: supabase/rollback/0144_vsat_offer_release_down.sql
-- Tests:    supabase/tests/vsat_offer_release.test.sql

-- ═════════════ 1. history + email outbox ═════════════
create table if not exists public.vsat_offer_events (
  id                uuid primary key default gen_random_uuid(),
  application_id    text not null references public.application_manager(application_id) on delete cascade,
  attempt_no        int  not null,
  kind              text not null check (kind in ('released', 'lapsed', 'cancelled')),
  scholarship_pct   numeric,
  released_at       timestamptz,
  expires_at        timestamptz,
  detail            jsonb,
  actor_id          uuid,
  created_at        timestamptz not null default now(),
  -- email outbox (release only)
  notify_status     text not null default 'none' check (notify_status in ('none', 'pending', 'sending', 'sent', 'skipped', 'failed')),
  notify_attempts   int  not null default 0,
  notify_claimed_at timestamptz,
  notify_detail     jsonb,
  notified_at       timestamptz
);
create index if not exists vsat_offer_events_app_idx on public.vsat_offer_events (application_id, created_at desc);
create index if not exists vsat_offer_events_outbox_idx on public.vsat_offer_events (created_at) where notify_status in ('pending', 'sending');
alter table public.vsat_offer_events enable row level security;
revoke all on table public.vsat_offer_events from public, anon, authenticated;
grant select on table public.vsat_offer_events to service_role;
comment on table public.vsat_offer_events is
  'VSAT offers: one row per release / lapse / cancel (scholarship %, deadline, who). Also the email outbox for releases: the server claims pending rows through vsat_offer_notices_claim. Browsers never read it directly.';

-- ═════════════ 2. VSAT comms: offer step (off + test mode) ═════════════
alter table public.vsat_comm_steps drop constraint if exists vsat_comm_steps_step_key_check;
alter table public.vsat_comm_steps add constraint vsat_comm_steps_step_key_check check (step_key in (
  'first_half', 'application_started', 'payment_reminder_24h', 'payment_confirmed',
  'interview_invite', 'interview_rescheduled', 'interview_cancelled',
  'interviewer_invite', 'interviewer_rescheduled', 'interviewer_cancelled',
  'offer_released'));

insert into public.vsat_comm_steps (step_key, title, sort, wa_enabled, email_subject, email_body) values
  ('offer_released', 'Offer released → student', 20, false,
   'Your admission offer from Vedam: {{scholarship}}% scholarship',
   '<p>Hi {{name}},</p><p>Congratulations! You have been offered admission to Vedam School of Technology, {{campus}} campus, with a <b>{{scholarship}}% scholarship</b>.</p><p>To accept the offer, block your seat by paying the enrollment fee of <b>₹{{amount}}</b> from your dashboard.</p><p><b>Pay by:</b> {{deadline_date}}, {{deadline_time}} IST. After this, the offer expires.</p><p><a href="{{dashboard_link}}">Accept and pay →</a></p><p>If you have any questions, reply to this email and the admissions team will help you.</p><p>Warm regards,<br>Team Vedam</p>')
on conflict (step_key) do nothing;

-- ═════════════ 3. private helpers ═════════════

-- Days to pay and the deadline for an offer released at p_now: the campus "Days to pay" (else the value
-- counselling saved), until 11:59:59 pm IST of that day. No row when neither is known.
create or replace function public.vsat__offer_deadline(p_app text, p_now timestamptz)
returns table (days int, expires_at timestamptz)
language sql stable security definer set search_path to '' as $$
  with n as (
    select coalesce(
             (select s.offer_days from public.vsat_campus_settings s where s.campus = public.vsat__campus_key(am.campus_applied)),
             (select c.pay_timeline_days from public.counselling_assignments c
                join public.vsat_pipeline vp on vp.application_id = c.application_id and vp.attempt_no = c.attempt_no
               where c.application_id = p_app order by c.created_at desc limit 1)) as days
      from public.application_manager am
     where am.application_id = p_app)
  select n.days,
         (((p_now at time zone 'Asia/Kolkata')::date + n.days)::timestamp + interval '23 hours 59 minutes 59 seconds') at time zone 'Asia/Kolkata'
    from n
   where n.days is not null
$$;

-- Fill the offer fields the payment gate reads and queue the email. A still-valid offer is left alone.
create or replace function public.vsat__offer_release(p_app text, p_attempt int, p_actor uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare am public.application_manager; v_days int; v_exp timestamptz; v_now timestamptz := clock_timestamp();
begin
  select * into am from public.application_manager a where a.application_id = p_app for update;
  if not found then return; end if;
  if am.scholarship_percentage is null then raise exception 'NO_SCHOLARSHIP' using errcode = '22023'; end if;
  if am.offer_released_at is not null and not coalesce(am.offer_cancelled, false)
     and am.offer_expires_at is not null and am.offer_expires_at > v_now then
    return;
  end if;
  select d.days, d.expires_at into v_days, v_exp from public.vsat__offer_deadline(p_app, v_now) d;
  if v_days is null then raise exception 'CAMPUS_MISSING' using errcode = '22023'; end if;

  update public.application_manager a
     set offer_released_at = v_now, offer_expires_at = v_exp, offer_cancelled = false, offer_status = 'released',
         offer_released_date = v_now, offer_expiry_date = v_exp, offer_pay_timeline_days = v_days, last_updated_date = v_now
   where a.application_id = p_app;
  update public.counselling_assignments c set offer_expiry_date = v_exp
   where c.application_id = p_app and c.attempt_no = p_attempt;
  insert into public.vsat_offer_events (application_id, attempt_no, kind, scholarship_pct, released_at, expires_at, actor_id, notify_status)
  values (p_app, p_attempt, 'released', am.scholarship_percentage, v_now, v_exp, p_actor, 'pending');
end $$;

-- Stage changes into / out of the offer stages (every path: panel, bulk move, the lapse job, the database).
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

drop trigger if exists vsat_offer_stage on public.vsat_pipeline;
create trigger vsat_offer_stage after update of stage on public.vsat_pipeline
  for each row execute function public.vsat__on_offer_stage();

-- A paid fee enrols the student — also right after a lapse (payment started before the deadline).
create or replace function public.vsat__on_enrollment()
returns trigger language plpgsql security definer set search_path to '' as $$
declare st text; stt text;
begin
  if new.enrollment_stage = 'approved' and (tg_op = 'INSERT' or coalesce(old.enrollment_stage, '') <> 'approved') then
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = new.application_id;
    if st is not null and stt = 'active'
       and (public.vsat__stage_order(st) < public.vsat__stage_order('enrolled') or st = 'offer_lapsed') then
      begin
        perform public.vsat__move(new.application_id, 'enrolled', 'active',
          case when st = 'offer_lapsed' then 'Enrollment fee paid (payment started before the deadline)' end, 'system', null, null);
      exception when others then null;
      end;
    end if;
  end if;
  return null;
end $$;

-- pg_cron (every 15 minutes): offers past the deadline, fee not paid → Offer lapsed.
create or replace function public.vsat__offers_lapse()
returns int language plpgsql security definer set search_path to '' as $$
declare r record; n int := 0;
begin
  for r in
    select vp.application_id
      from public.vsat_pipeline vp
      join public.application_manager am on am.application_id = vp.application_id
     where vp.stage = 'offer_sent' and vp.status = 'active'
       and am.offer_expires_at is not null and am.offer_expires_at <= now()
       and coalesce(am.enrollment_stage, '') <> 'approved'
     order by am.offer_expires_at
     limit 500
       for update of vp skip locked
  loop
    begin
      perform public.vsat__move(r.application_id, 'offer_lapsed', 'active', 'The offer deadline passed', 'system', null, 'offer_sent');
      n := n + 1;
    exception when others then null;  -- one bad row never stops the others; it is tried again next run
    end;
  end loop;
  return n;
end $$;

-- ═════════════ 4. staff RPC ═════════════

-- p: {application_ids: [...] (1–100), dry_run?: boolean}. Admin / admissions.
-- Students at Counselled (active) with a scholarship % → Offer sent (the trigger releases the offer).
-- Students the caller may not manage are left out. Returns {released: [...], skipped: [{application_id, name, code}], dry_run}.
create or replace function public.vsat_offers_release(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare ids text[]; id text; dry boolean; src text; vp public.vsat_pipeline; am public.application_manager;
        v_days int; v_exp timestamptz; done jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_manage(null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_ids', 'dry_run']);
  ids := public.vsat__iv_ids(p, 100);
  dry := coalesce(public.vsat__bool(p, 'dry_run', false), false);
  src := case when array_length(ids, 1) > 1 then 'bulk' else 'manual' end;

  foreach id in array ids loop
    select * into vp from public.vsat_pipeline x where x.application_id = id;
    if not found then continue; end if;
    select * into am from public.application_manager a where a.application_id = id;
    if not public.vsat__can_manage(public.vsat__campus_key(am.campus_applied)) then continue; end if;

    if vp.stage in ('offer_sent', 'enrolled') then
      skipped := skipped || jsonb_build_object('application_id', id, 'name', am.registered_name, 'code', 'ALREADY_RELEASED'); continue;
    end if;
    if vp.stage <> 'counselled' or vp.status <> 'active' then
      skipped := skipped || jsonb_build_object('application_id', id, 'name', am.registered_name, 'code', 'WRONG_STAGE'); continue;
    end if;
    if am.scholarship_percentage is null then
      skipped := skipped || jsonb_build_object('application_id', id, 'name', am.registered_name, 'code', 'NO_SCHOLARSHIP'); continue;
    end if;
    select d.days, d.expires_at into v_days, v_exp from public.vsat__offer_deadline(id, now()) d;
    if v_days is null then
      skipped := skipped || jsonb_build_object('application_id', id, 'name', am.registered_name, 'code', 'CAMPUS_MISSING'); continue;
    end if;

    if not dry then
      begin
        perform public.vsat__move_checked(id, 'offer_sent', 'active', null, 'counselled', src);
      exception when others then
        skipped := skipped || jsonb_build_object('application_id', id, 'name', am.registered_name, 'code', sqlerrm); continue;
      end;
      select a.offer_expires_at into v_exp from public.application_manager a where a.application_id = id;
    end if;
    done := done || jsonb_build_object('application_id', id, 'name', am.registered_name,
                                       'scholarship_pct', am.scholarship_percentage, 'expires_at', v_exp);
  end loop;
  return jsonb_build_object('released', done, 'skipped', skipped, 'dry_run', dry);
end $$;

-- ═════════════ 5. server only (service_role): the offer email ═════════════

-- p: {limit? (1–100), application_ids?}. Jobs whose offer is no longer the current, valid one are skipped first.
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

-- p: {id, status: sent | skipped | failed, detail?: {sent_to: [...], ...}}. failed → retried (5 tries in all).
create or replace function public.vsat_offer_notice_done(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid; st text; d jsonb; n int;
begin
  perform public.vsat__check_keys(p, array['id', 'status', 'detail']);
  begin v_id := (public.vsat__txt(p, 'id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  st := public.vsat__txt(p, 'status', 10, true);
  if st not in ('sent', 'skipped', 'failed') then raise exception 'BAD_VALUE: status' using errcode = '22023'; end if;
  d := case when jsonb_typeof(p->'detail') = 'object' and pg_column_size(p->'detail') < 4000 then p->'detail' else null end;
  update public.vsat_offer_events ev
     set notify_status = case when st = 'failed' and ev.notify_attempts < 5 then 'pending' else st end,
         notify_detail = d, notify_claimed_at = null,
         notified_at = case when st = 'failed' and ev.notify_attempts < 5 then null else now() end
   where ev.id = v_id and ev.notify_status = 'sending';
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n = 1);
end $$;

-- ═════════════ 6. who may run what ═════════════
revoke all on function public.vsat__offer_deadline(text, timestamptz) from public, anon, authenticated;
revoke all on function public.vsat__offer_release(text, int, uuid) from public, anon, authenticated;
revoke all on function public.vsat__on_offer_stage() from public, anon, authenticated;
revoke all on function public.vsat__offers_lapse() from public, anon, authenticated, service_role;

revoke all on function public.vsat_offers_release(jsonb) from public, anon;
grant execute on function public.vsat_offers_release(jsonb) to authenticated;

revoke all on function public.vsat_offer_notices_claim(jsonb) from public, anon, authenticated;
revoke all on function public.vsat_offer_notice_done(jsonb) from public, anon, authenticated;
grant execute on function public.vsat_offer_notices_claim(jsonb) to service_role;
grant execute on function public.vsat_offer_notice_done(jsonb) to service_role;

-- ═════════════ 7. the lapse job ═════════════
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'vsat-offer-lapse') then perform cron.unschedule('vsat-offer-lapse'); end if;
    perform cron.schedule('vsat-offer-lapse', '7,22,37,52 * * * *', 'select public.vsat__offers_lapse()');
  else
    raise notice 'pg_cron is not installed: run select public.vsat__offers_lapse() every 15 minutes some other way';
  end if;
end $$;
