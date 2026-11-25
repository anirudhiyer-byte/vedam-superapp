-- 0179 · counselling mode (Online / Offline), chosen by the student at PI cleared (staging first).
--
-- Owner's model (25 Nov 2026): when a student is at PI cleared, the dashboard asks "Mode of counselling — Online or
-- Offline?". The answer is stored on the application and shown to admissions / counsellors.
--
--   application_manager.counselling_mode     'online' | 'offline' (null = not chosen yet) + counselling_mode_at
--   vsat_set_counselling_mode(p)             the student, signed in: {mode}. Every check is here, not in the UI:
--                                            own application only (auth.uid()), only at PI cleared / Counselling
--                                            scheduled and Active, not after the counselling is submitted
--                                            (ALREADY_COUNSELLED); unknown keys refused. They can change it until then.
--   vsat_student (drawer)                    + profile.counselling_mode — patched in place (one field added after
--                                            campus_applied) so each environment keeps its own version of the function;
--                                            the patch refuses to run unless that field appears exactly once.
--   admin grid                               nothing to do: vsat__grid_catalog lists application_manager's columns
--                                            itself (the new ones land in the "Application" group).
--
-- Rollback: supabase/rollback/0179_vsat_counselling_mode_down.sql
-- Tests:    supabase/tests/vsat_counselling_mode.test.sql

alter table public.application_manager
  add column if not exists counselling_mode    text,
  add column if not exists counselling_mode_at timestamptz;
alter table public.application_manager drop constraint if exists application_manager_counselling_mode_check;
alter table public.application_manager add constraint application_manager_counselling_mode_check
  check (counselling_mode is null or counselling_mode in ('online', 'offline'));

create or replace function public.vsat_set_counselling_mode(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare uid uuid := auth.uid(); v_mode text; v_app text; vp public.vsat_pipeline;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  perform public.vsat__check_keys(p, array['mode']);
  if jsonb_typeof(p->'mode') is distinct from 'string' or (p->>'mode') not in ('online', 'offline') then
    raise exception 'BAD_VALUE: mode' using errcode = '22023';
  end if;
  v_mode := p->>'mode';

  select am.application_id into v_app from public.application_manager am
   where am.lead_id = uid order by am.created_at desc nulls last limit 1;
  if v_app is null then raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002'; end if;

  select * into vp from public.vsat_pipeline where application_id = v_app;
  if not found or vp.stage not in ('pi_cleared', 'counselling_scheduled') or vp.status <> 'active' then
    raise exception 'WRONG_STAGE' using errcode = '22023';
  end if;
  if exists (select 1 from public.counselling_assignments c
              where c.application_id = v_app and c.attempt_no = vp.attempt_no and c.submitted_at is not null) then
    raise exception 'ALREADY_COUNSELLED' using errcode = '22023';
  end if;

  update public.application_manager
     set counselling_mode = v_mode, counselling_mode_at = now(), last_updated_date = now()
   where application_id = v_app;

  begin
    insert into public.crm_activity_log (entity_type, application_id, lead_id, action, metadata, actor, path)
    values ('application', v_app, uid, 'counselling_mode', jsonb_build_object('mode', v_mode), 'applicant', '/apply/dashboard');
  exception when others then null; -- the log must never block the choice
  end;

  return jsonb_build_object('counselling_mode', v_mode);
end $function$;

revoke all on function public.vsat_set_counselling_mode(jsonb) from public, anon;
grant execute on function public.vsat_set_counselling_mode(jsonb) to authenticated, service_role;

-- the drawer shows it: add one field to vsat_student's profile object, in place
do $$
declare o oid; d text; n int;
  tok constant text := '''campus_applied'', am.campus_applied,';
begin
  select p.oid into strict o from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'vsat_student';
  d := pg_get_functiondef(o);
  if position('''counselling_mode''' in d) > 0 then return; end if; -- already patched
  n := (length(d) - length(replace(d, tok, ''))) / length(tok);
  if n <> 1 then raise exception '0179: expected campus_applied once in vsat_student, found %', n; end if;
  execute replace(d, tok, tok || ' ''counselling_mode'', am.counselling_mode,');
end $$;
