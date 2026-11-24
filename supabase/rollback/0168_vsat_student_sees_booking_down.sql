-- Rollback of 0168: puts back the 0140 vsat_my_interview and the 0145 vsat_my_counselling exactly.

create or replace function public.vsat_my_interview()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare uid uuid := auth.uid(); r record; t_open timestamptz; t_end timestamptz; st text;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  select a.slot_datetime, a.duration_min, a.meet_link, a.attendance, vp.status into r
    from public.application_manager am
    join public.vsat_pipeline vp on vp.application_id = am.application_id
    join public.interview_assignments a on a.application_id = vp.application_id and a.attempt_no = vp.attempt_no
   where am.lead_id = uid and vp.stage = 'interview_scheduled' and a.cancelled_at is null and a.slot_datetime is not null
   order by a.slot_datetime desc
   limit 1;
  if not found then return jsonb_build_object('state', 'none', 'now', now()); end if;
  t_open := r.slot_datetime - interval '10 minutes';
  t_end  := r.slot_datetime + make_interval(mins => r.duration_min);
  st := case when r.status = 'absent' or r.attendance = 'no_show' then 'missed'
             when now() < t_open then 'upcoming'
             when now() < t_end then 'open'
             else 'ended' end;
  return jsonb_build_object('state', st, 'now', now(), 'start', r.slot_datetime, 'end', t_end, 'opens_at', t_open,
                            'duration_min', r.duration_min, 'has_link', r.meet_link is not null,
                            'meet_link', case when st = 'open' then r.meet_link end);
end $$;

create or replace function public.vsat_my_counselling()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare uid uuid := auth.uid(); vp public.vsat_pipeline; r record; t_open timestamptz; t_end timestamptz; st text; v_step text;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  select x.* into vp
    from public.application_manager am
    join public.vsat_pipeline x on x.application_id = am.application_id
   where am.lead_id = uid
   order by x.stage_changed_at desc
   limit 1;
  v_step := case when not found then 'interview'
                 when vp.stage = 'counselling_scheduled' then 'counselling'
                 when vp.stage = 'pi_cleared' and vp.status = 'active' then 'pi_cleared'
                 when vp.stage in ('interviewed', 'pi_cleared') then 'interviewed'
                 else 'interview' end;
  if v_step <> 'counselling' then return jsonb_build_object('state', 'none', 'now', now(), 'step', v_step); end if;

  select a.slot_datetime, a.duration_min, a.zoom_link, a.attendance into r
    from public.counselling_assignments a
   where a.application_id = vp.application_id and a.attempt_no = vp.attempt_no and a.cancelled_at is null and a.slot_datetime is not null
   order by a.slot_datetime desc
   limit 1;
  if not found then return jsonb_build_object('state', 'none', 'now', now(), 'step', v_step); end if;
  t_open := r.slot_datetime - interval '10 minutes';
  t_end  := r.slot_datetime + make_interval(mins => r.duration_min);
  st := case when vp.status = 'absent' or r.attendance = 'no_show' then 'missed'
             when now() < t_open then 'upcoming'
             when now() < t_end then 'open'
             else 'ended' end;
  return jsonb_build_object('state', st, 'now', now(), 'step', v_step, 'start', r.slot_datetime, 'end', t_end, 'opens_at', t_open,
                            'duration_min', r.duration_min, 'has_link', r.zoom_link is not null,
                            'meet_link', case when st = 'open' then r.zoom_link end);
end $$;
