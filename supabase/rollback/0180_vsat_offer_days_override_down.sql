-- Rollback 0180 · back to the campus "Days to pay" for every offer (the 0144 definitions, verbatim from staging).
-- Functions first (they reference the column), then the column.

CREATE OR REPLACE FUNCTION public.vsat__offer_deadline(p_app text, p_now timestamp with time zone)
 RETURNS TABLE(days integer, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.vsat__offer_release(p_app text, p_attempt integer, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.vsat_offers_release(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

alter table public.application_manager drop constraint if exists application_manager_offer_days_override_check;
alter table public.application_manager drop column if exists offer_days_override;
