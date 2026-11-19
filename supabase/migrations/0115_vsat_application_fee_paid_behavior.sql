-- 0115 · VSAT application_fee_paid — payment→stage behavior (parity reconciliation).
--
-- The 'application_fee_paid' stage was added to staging out-of-band by an earlier branch but
-- never committed, so production never got its behavior. 0114 already makes it a valid stage
-- (constraint + order); this migration adds the behavior that advances a student into it:
--   • vsat__on_application: an exam-date now promotes 'applied' OR 'application_fee_paid' → booked
--   • vsat__on_payment:     a vsat_payments insert promotes 'applied' → 'application_fee_paid'
--   • backfill: existing 'applied' students who already paid → 'application_fee_paid'
-- Idempotent: on staging (already has this) the CREATE OR REPLACEs are byte-identical no-ops and
-- the backfill matches nothing; on production it installs the behavior.
-- Rollback: supabase/rollback/0115_vsat_application_fee_paid_behavior_down.sql

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

create or replace function public.vsat__on_payment()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare v_app text; st text; stt text;
begin
  select am.application_id into v_app from public.application_manager am where am.lead_id = new.lead_id limit 1;
  if v_app is null then return null; end if;
  select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = v_app;
  if st = 'applied' and stt = 'active' then
    begin
      perform public.vsat__move(v_app, 'application_fee_paid', 'active', null, 'system', null, null);
    exception when others then null;
    end;
  end if;
  return null;
end $fn$;
revoke all on function public.vsat__on_payment() from public, anon, authenticated;

drop trigger if exists trg_vsat_payment_stage on public.vsat_payments;
create trigger trg_vsat_payment_stage after insert on public.vsat_payments
  for each row execute function public.vsat__on_payment();

do $$
declare r record;
begin
  for r in
    select vp.application_id
      from public.vsat_pipeline vp
      join public.application_manager am on am.application_id = vp.application_id
     where vp.stage = 'applied' and vp.status = 'active'
       and exists (select 1 from public.vsat_payments p where p.lead_id = am.lead_id)
  loop
    perform public.vsat__move(r.application_id, 'application_fee_paid', 'active', null, 'backfill', null, null);
  end loop;
end $$;
