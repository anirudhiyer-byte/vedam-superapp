-- 0169 · VSAT: bookings no longer depend on the stage for Meet attendance and the team count (STAGING FIRST)
--
-- Why: since 0166 every stage after the exam is changed by hand. Two places still looked for the old automatic stage:
--   1. vsat_interview_attendance_due / vsat_counselling_attendance_due read Google Meet attendance only when the
--      student was at Interview scheduled / Counselling scheduled. A booking sent while the student is still at
--      VSAT cleared / PI cleared (normal now) never got its Status from Meet.
--   2. vsat_team_admin_list counted a person's "still scheduled" students only at that stage, so the warning before
--      deactivating an interviewer or counsellor missed bookings sent while the student is at VSAT cleared / PI cleared.
-- Now: Meet is read at the same stages where staff can set the Status (as vsat_set_*_attendance, 0166), and the
-- team count is live bookings (not cancelled, not submitted, Status not Done) of students still at a bookable
-- stage. Nothing else changes: same signatures, security definer, empty search_path and grants (create or
-- replace keeps the ACL).
-- Rollback: supabase/rollback/0169_vsat_attendance_any_stage_down.sql (the 0140 / 0145 / 0098 bodies).

create or replace function public.vsat_interview_attendance_due(p_limit int)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.slot_datetime), '[]'::jsonb)
    from (select a.id, a.version, a.application_id, a.slot_datetime, a.duration_min, a.meet_code, a.attendance_check_attempts
            from public.interview_assignments a
            join public.vsat_pipeline vp on vp.application_id = a.application_id and vp.attempt_no = a.attempt_no
           where a.meet_mode = 'auto' and a.meet_sync = 'ok' and a.meet_code is not null and a.cancelled_at is null
             and a.slot_datetime is not null and a.attendance = 'scheduled' and a.attendance_source is null
             and a.attendance_checked_at is null and a.submitted_at is null
             -- vsat_attendance_any_stage: stages are changed by hand (0166), so Meet is read at every stage where staff
             -- can set the Status, not only at Interview scheduled
             and vp.stage in ('vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_not_appeared')
             and a.slot_datetime + make_interval(mins => a.duration_min + 10) < now()
             and a.slot_datetime > now() - interval '3 days'
             and a.attendance_check_attempts < 12
           order by a.slot_datetime
           limit least(greatest(coalesce(p_limit, 20), 1), 50)) x
$$;

create or replace function public.vsat_counselling_attendance_due(p_limit int)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.slot_datetime), '[]'::jsonb)
    from (select a.id, a.version, a.application_id, a.slot_datetime, a.duration_min, a.meet_code, a.attendance_check_attempts
            from public.counselling_assignments a
            join public.vsat_pipeline vp on vp.application_id = a.application_id and vp.attempt_no = a.attempt_no
           where a.meet_mode = 'auto' and a.meet_sync = 'ok' and a.meet_code is not null and a.cancelled_at is null
             and a.slot_datetime is not null and a.attendance = 'scheduled' and a.attendance_source is null
             and a.attendance_checked_at is null and a.submitted_at is null
             -- vsat_attendance_any_stage: stages are changed by hand (0166), so Meet is read at every stage where staff
             -- can set the Status, not only at Counselling scheduled
             and vp.stage in ('pi_cleared', 'counselling_scheduled', 'counselled', 'counselling_not_appeared')
             and a.slot_datetime + make_interval(mins => a.duration_min + 10) < now()
             and a.slot_datetime > now() - interval '3 days'
             and a.attendance_check_attempts < 12
           order by a.slot_datetime
           limit least(greatest(coalesce(p_limit, 20), 1), 50)) x
$$;

create or replace function public.vsat_team_admin_list()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  perform public.vsat__settings_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', t.user_id, 'name', coalesce(pr.full_name, u.email), 'email', u.email,
             'role', t.role, 'campus', t.campus, 'active', t.active, 'created_at', t.created_at,
             'open', case t.role
                       when 'interviewer' then (select count(*) from public.interview_assignments a join public.vsat_pipeline vp
                                                  on vp.application_id = a.application_id and vp.attempt_no = a.attempt_no
                                                 where a.interviewer_id = t.user_id
                                                   -- vsat_attendance_any_stage: a live booking not yet done, while the student is still
                                                   -- at a stage where it can be booked (0166: the stage no longer follows the booking)
                                                   and vp.stage in ('vsat_cleared', 'interview_scheduled') and a.cancelled_at is null
                                                   and a.slot_datetime is not null and a.submitted_at is null and a.attendance <> 'done')
                       when 'counsellor' then (select count(*) from public.counselling_assignments a join public.vsat_pipeline vp
                                                  on vp.application_id = a.application_id and vp.attempt_no = a.attempt_no
                                                 where a.counsellor_id = t.user_id
                                                   and vp.stage in ('pi_cleared', 'counselling_scheduled') and a.cancelled_at is null
                                                   and a.slot_datetime is not null and a.submitted_at is null and a.attendance <> 'done')
                       else 0 end)
             order by t.active desc, coalesce(pr.full_name, u.email), t.role)
      from public.vsat_team t join auth.users u on u.id = t.user_id left join public.profiles pr on pr.id = t.user_id), '[]'::jsonb);
end $$;
