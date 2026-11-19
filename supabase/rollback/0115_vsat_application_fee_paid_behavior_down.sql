-- Rollback for 0115 — restore the pre-fee_paid behavior: vsat__on_application only advances
-- 'applied' (not 'application_fee_paid') on an exam date, and drop the payment→stage trigger.
-- Matches production's pre-0115 definition. The one-time backfill is not reversed.

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
    if st = 'applied' and stt = 'active' then
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

drop trigger if exists trg_vsat_payment_stage on public.vsat_payments;
drop function if exists public.vsat__on_payment();
