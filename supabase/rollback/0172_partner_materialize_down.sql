-- Rollback for 0172_partner_materialize.sql
drop trigger if exists trg_vsat_app_prepaid_reflect on public.application_manager;
drop function if exists public.vsat__app_prepaid_reflect();
drop function if exists public.partner_materialize(uuid, text, text);
drop function if exists public.partner_find_user(text, text);

-- restore vsat__on_application to its pre-0172 definition (no payment-aware initial stage)
create or replace function public.vsat__on_application()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare st text; stt text; v_attempt int := least(greatest(coalesce(new.current_attempt, 1), 1), 2);
begin
  if not exists (select 1 from public.vsat_pipeline vp where vp.application_id = new.application_id) then
    insert into public.vsat_pipeline (application_id, attempt_no, stage, status)
    values (new.application_id, v_attempt, case when new.exam_date_id is not null then 'booked' else 'applied' end, 'active')
    on conflict (application_id) do nothing;
    if found then
      insert into public.vsat_stage_history (application_id, attempt_no, to_stage, to_status, source)
      values (new.application_id, v_attempt, case when new.exam_date_id is not null then 'booked' else 'applied' end, 'active', 'system');
    end if;
  elsif new.exam_date_id is not null then
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = new.application_id;
    if st in ('applied', 'application_fee_paid') and stt = 'active' then
      perform public.vsat__move(new.application_id, 'booked', 'active', null, 'system', null, null);
    end if;
  end if;
  if coalesce(new.exam_given, false) and (tg_op = 'INSERT' or not coalesce(old.exam_given, false)) then
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = new.application_id;
    if st in ('booked', 'eligible') and stt = 'active' then
      perform public.vsat__move(new.application_id, 'exam_taken', 'active', null, 'system', null, null);
    end if;
  end if;
  return null;
end $fn$;
