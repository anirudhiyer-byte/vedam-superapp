-- 0180 · per-student offer validity ("Days to pay") when releasing an offer (staging first).
--
-- Owner's model (25 Nov 2026): when the offer is sent after counselling, admissions pick the scholarship % (counselling)
-- and how many days the offer is valid for. Until now the deadline was always the campus "Days to pay"
-- (vsat_campus_settings.offer_days). This lets the release set it per student; empty keeps the campus default.
--
--   application_manager.offer_days_override  1–90, set by vsat_offers_release just before the student moves to
--                                            Offer sent, read by vsat__offer_deadline, cleared by vsat__offer_release
--                                            once used — so a later re-open (Move stage → Offer sent) never picks up an
--                                            old value. The days actually used stay in offer_pay_timeline_days.
--   vsat_offers_release(p)                   + optional offer_days (whole number 1–90). The preview (dry_run) shows the
--                                            deadline those days give and saves nothing. Everything else as 0144.
--   vsat__offer_deadline                     days = override, else campus offer_days, else counselling pay_timeline_days.
--   vsat__offer_release                      clears the override in the same update that writes the offer.
--
-- Rollback: supabase/rollback/0180_vsat_offer_days_override_down.sql
-- Tests:    supabase/tests/vsat_offer_days_override.test.sql

alter table public.application_manager add column if not exists offer_days_override int;
alter table public.application_manager drop constraint if exists application_manager_offer_days_override_check;
alter table public.application_manager add constraint application_manager_offer_days_override_check
  check (offer_days_override is null or offer_days_override between 1 and 90);

create or replace function public.vsat__offer_deadline(p_app text, p_now timestamp with time zone)
 returns table(days integer, expires_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with n as (
    select coalesce(
             am.offer_days_override,
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
$function$;

create or replace function public.vsat__offer_release(p_app text, p_attempt integer, p_actor uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
         offer_released_date = v_now, offer_expiry_date = v_exp, offer_pay_timeline_days = v_days, last_updated_date = v_now,
         offer_days_override = null
   where a.application_id = p_app;
  update public.counselling_assignments c set offer_expiry_date = v_exp
   where c.application_id = p_app and c.attempt_no = p_attempt;
  insert into public.vsat_offer_events (application_id, attempt_no, kind, scholarship_pct, released_at, expires_at, actor_id, notify_status)
  values (p_app, p_attempt, 'released', am.scholarship_percentage, v_now, v_exp, p_actor, 'pending');
end $function$;

create or replace function public.vsat_offers_release(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare ids text[]; id text; dry boolean; src text; vp public.vsat_pipeline; am public.application_manager;
        v_days int; v_exp timestamptz; v_req int; done jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_manage(null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_ids', 'dry_run', 'offer_days']);
  ids := public.vsat__iv_ids(p, 100);
  dry := coalesce(public.vsat__bool(p, 'dry_run', false), false);
  src := case when array_length(ids, 1) > 1 then 'bulk' else 'manual' end;
  -- 0180: optional validity for this release, a whole number of days (1–90); null = the campus default
  if p ? 'offer_days' and jsonb_typeof(p->'offer_days') <> 'null' then
    if jsonb_typeof(p->'offer_days') <> 'number' or (p->>'offer_days')::numeric <> trunc((p->>'offer_days')::numeric)
       or (p->>'offer_days')::numeric not between 1 and 90 then
      raise exception 'BAD_VALUE: offer_days' using errcode = '22023';
    end if;
    v_req := (p->>'offer_days')::int;
  end if;

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
    if v_req is not null then
      v_days := v_req;
      v_exp := (((now() at time zone 'Asia/Kolkata')::date + v_req)::timestamp + interval '23 hours 59 minutes 59 seconds') at time zone 'Asia/Kolkata';
    else
      select d.days, d.expires_at into v_days, v_exp from public.vsat__offer_deadline(id, now()) d;
    end if;
    if v_days is null then
      skipped := skipped || jsonb_build_object('application_id', id, 'name', am.registered_name, 'code', 'CAMPUS_MISSING'); continue;
    end if;

    if not dry then
      begin
        -- the trigger (vsat__offer_release) reads the override and clears it; a failed move rolls it back too
        if v_req is not null then
          update public.application_manager a set offer_days_override = v_req where a.application_id = id;
        end if;
        perform public.vsat__move_checked(id, 'offer_sent', 'active', null, 'counselled', src);
        -- belt and braces: never leave an override behind (e.g. the release kept an offer that was still valid)
        update public.application_manager a set offer_days_override = null
         where a.application_id = id and a.offer_days_override is not null;
      exception when others then
        skipped := skipped || jsonb_build_object('application_id', id, 'name', am.registered_name, 'code', sqlerrm); continue;
      end;
      select a.offer_expires_at, a.offer_pay_timeline_days into v_exp, v_days
        from public.application_manager a where a.application_id = id;
    end if;
    done := done || jsonb_build_object('application_id', id, 'name', am.registered_name,
                                       'scholarship_pct', am.scholarship_percentage, 'expires_at', v_exp, 'days', v_days);
  end loop;
  return jsonb_build_object('released', done, 'skipped', skipped, 'dry_run', dry);
end $function$;
