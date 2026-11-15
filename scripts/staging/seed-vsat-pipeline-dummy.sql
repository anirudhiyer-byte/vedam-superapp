-- STAGING ONLY · seed FAKE VSAT pipeline data (step 3 of the VSAT pipeline build), so the
-- Applications / Exam / Interview / Counselling panels can be built and tested on realistic data.
--
-- How: run this whole file once in the STAGING SQL editor (project kyhakenhbgcissmaacws), or via
--      the Supabase MCP. Remove everything with scripts/staging/cleanup-vsat-pipeline-dummy.sql.
--      Size: v_per_batch below (default 200 per batch → 400 applicants). For the load test,
--      clean up and re-run with a larger number.
--
-- What it creates (all tagged so the cleanup finds every row):
--   * auth.users: email zzvsat-*@example.invalid, raw_user_meta_data.dummy_seed = 'vsat-pipeline-v1'
--     (no password, no phone, .invalid email → nobody can log in, nothing can be delivered;
--     no phone also means no link to calling leads, so the Elevate webhook never fires)
--     → the normal sign-up trigger creates their profiles, like a real sign-up
--   * staff: 2 admissions (all campuses / Pune), 4 interviewers, 2 counsellors in vsat_team
--   * 2 exam batches: label 'DUMMY VSAT-A' / 'DUMMY VSAT-B', enabled = false (never shown to students),
--     with their own VPS curves (A: anchor 65, like VSAT-14; B: anchor 35, like VSAT-12)
--   * applications (application_id 'DUMMY-VSAT-NNNNN') across both campuses, with marks, VSAT
--     result, VPS, and a pipeline stage spread like a real funnel; interview and counselling
--     assignments with scores, scholarship score/category and offer dates where the stage needs them
--   * every stage move goes through the real engine (vsat__move, source 'system', reason 'dummy seed'),
--     so history and the old stage fields are filled exactly as in real use
--
-- Randomness is deterministic (md5 of the applicant number), so a re-seed gives the same data.

do $$
declare
  v_per_batch int := 200;                       -- ← applicants per batch
  v_tag text := 'vsat-pipeline-v1';
  b_a uuid; b_b uuid; adm1 uuid; adm2 uuid; ints uuid[] := '{}'; cous uuid[] := '{}';
  first_m text[] := array['Aarav','Vivaan','Aditya','Arjun','Sai','Reyansh','Krishna','Ishaan','Rohan','Kabir','Dhruv','Atharv','Ayaan','Vihaan','Yash','Pranav','Harsh','Kunal','Nikhil','Rahul'];
  first_f text[] := array['Ananya','Diya','Aadhya','Saanvi','Myra','Ira','Kiara','Anika','Navya','Sara','Riya','Meera','Tanvi','Pari','Aditi','Sneha','Kavya','Nisha','Pooja','Ishita'];
  last_n  text[] := array['Sharma','Verma','Gupta','Iyer','Nair','Reddy','Patel','Shah','Mehta','Singh','Kumar','Das','Joshi','Kulkarni','Rao','Chopra','Bose','Pillai','Agarwal','Mishra'];
  n int; uid uuid; app text; batch uuid; anchors jsonb; female boolean; campus text; r float8;
  y10 int; y12 int; ph numeric; ch numeric; ma numeric; c10 numeric; m10 numeric; c12 numeric; m12 numeric;
  jee boolean; jee_p numeric; jee_m numeric; pct numeric; marks numeric; vps numeric;
  target text; tstatus text; ord int; iv jsonb; parts numeric[]; sc jsonb; step numeric; slot timestamptz; k int := 0;
  path text[] := array['booked','eligible','exam_taken','vsat_cleared','interview_scheduled','interviewed','pi_cleared',
                       'counselling_scheduled','counselled','offer_sent','seat_blocked'];
begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;
  if exists (select 1 from auth.users where raw_user_meta_data->>'dummy_seed' = v_tag) then
    raise exception 'VSAT dummy data is already seeded. Run cleanup-vsat-pipeline-dummy.sql first.';
  end if;

  -- ── staff (fake accounts; they own assignments, nobody logs in as them) ─────────────
  for n in 1 .. 8 loop
    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            'zzvsat-staff-' || n || '@example.invalid',
            jsonb_build_object('dummy_seed', v_tag, 'full_name', 'Dummy ' || (array['Admissions All','Admissions Pune','Interviewer 1','Interviewer 2','Interviewer 3','Interviewer 4','Counsellor 1','Counsellor 2'])[n]),
            '{"provider":"email","providers":["email"]}'::jsonb, now(), now(), now(), false, false)
    returning id into uid;
    if n = 1 then adm1 := uid; elsif n = 2 then adm2 := uid; elsif n <= 6 then ints := ints || uid; else cous := cous || uid; end if;
  end loop;
  insert into public.vsat_team (user_id, role, campus) values (adm1, 'admissions', null), (adm2, 'admissions', 'pune');
  insert into public.vsat_team (user_id, role) select u, 'interviewer' from unnest(ints) u;
  insert into public.vsat_team (user_id, role) select u, 'counsellor' from unnest(cous) u;

  -- ── two batches with their own VPS curves; never shown to students ─────────────────
  insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at, enabled, vps_anchors, cleared_vps_cutoff)
  values ('DUMMY VSAT-A', 'zzdummy-a', current_date - 30, now() - interval '30 days', now() - interval '30 days' + interval '2 hours', false,
          '[{"percentile":0,"vps":0},{"percentile":65,"vps":7.4},{"percentile":100,"vps":9.8}]', 7.4)
  returning id into b_a;
  insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at, enabled, vps_anchors, cleared_vps_cutoff)
  values ('DUMMY VSAT-B', 'zzdummy-b', current_date - 10, now() - interval '10 days', now() - interval '10 days' + interval '2 hours', false,
          '[{"percentile":0,"vps":0},{"percentile":35,"vps":7.4},{"percentile":100,"vps":9.8}]', 7.4)
  returning id into b_b;

  -- ── applicants ───────────────────────────────────────────────────────────────────
  for n in 1 .. v_per_batch * 2 loop
    -- deterministic random in [0,1) for this applicant and slot k
    batch   := case when n <= v_per_batch then b_a else b_b end;
    anchors := (select d.vps_anchors from public.vsat_exam_dates d where d.id = batch);
    r := (('x' || substr(md5(n || ':1'), 1, 8))::bit(32)::bigint)::float8 / 4294967296;
    female := r < 0.32;
    campus := case when (('x' || substr(md5(n || ':2'), 1, 8))::bit(32)::bigint)::float8 / 4294967296 < 0.55
                   then 'Ajeenkya DY Patil University — Pune' else 'Sushant University — Gurugram' end;

    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            'zzvsat-' || lpad(n::text, 5, '0') || '@example.invalid',
            jsonb_build_object('dummy_seed', v_tag, 'dummy_n', n,
              'full_name', (case when female then first_f else first_m end)[1 + (('x' || substr(md5(n || ':3'), 1, 8))::bit(32)::bigint % 20)::int]
                           || ' ' || last_n[1 + (('x' || substr(md5(n || ':4'), 1, 8))::bit(32)::bigint % 20)::int] || ' (dummy)',
              'grad_year', '2026', 'stream', 'PCM', 'consent_given', 'true'),
            '{"provider":"email","providers":["email"]}'::jsonb,
            now() - interval '60 days', now() - interval '60 days', now() - interval '60 days', false, false)
    returning id into uid;

    -- marks (sheet-like ranges); ~5% finished 10th before 2023 (not eligible), ~20% 12th not out yet
    y10 := case when (('x' || substr(md5(n || ':5'), 1, 8))::bit(32)::bigint)::float8 / 4294967296 < 0.05 then 2022 else 2023 + (n % 2) end;
    y12 := y10 + 2;
    c10 := round((60 + 38 * (('x' || substr(md5(n || ':6'), 1, 8))::bit(32)::bigint)::float8 / 4294967296)::numeric, 1);
    m10 := least(100, round((c10 - 8 + 16 * (('x' || substr(md5(n || ':7'), 1, 8))::bit(32)::bigint)::float8 / 4294967296)::numeric, 0));
    if y12 = 2026 and (('x' || substr(md5(n || ':8'), 1, 8))::bit(32)::bigint)::float8 / 4294967296 < 0.4 then
      ph := 0; ch := 0; ma := 0; c12 := null; m12 := null;                     -- yet to graduate
    else
      ph := round((35 + 60 * (('x' || substr(md5(n || ':9'), 1, 8))::bit(32)::bigint)::float8 / 4294967296)::numeric, 0);
      ch := round((35 + 60 * (('x' || substr(md5(n || ':10'), 1, 8))::bit(32)::bigint)::float8 / 4294967296)::numeric, 0);
      ma := round((35 + 63 * (('x' || substr(md5(n || ':11'), 1, 8))::bit(32)::bigint)::float8 / 4294967296)::numeric, 0);
      c12 := round(((ph + ch + ma) / 3 + 5)::numeric, 1); m12 := ma;
    end if;
    jee := (('x' || substr(md5(n || ':12'), 1, 8))::bit(32)::bigint)::float8 / 4294967296 < 0.45;
    jee_p := case when jee then round((40 + 59.5 * (('x' || substr(md5(n || ':13'), 1, 8))::bit(32)::bigint)::float8 / 4294967296)::numeric, 2) end;
    jee_m := case when jee then least(100, round((jee_p - 15 + 25 * (('x' || substr(md5(n || ':14'), 1, 8))::bit(32)::bigint)::float8 / 4294967296)::numeric, 2)) end;
    pct   := round((5 + 94 * power((('x' || substr(md5(n || ':15'), 1, 8))::bit(32)::bigint)::float8 / 4294967296, 0.8))::numeric, 0);  -- percentile
    marks := round((10 + 38 * pct / 100)::numeric, 1);                                                                            -- out of 50
    vps   := public.vsat_calc_vps(pct, anchors);

    -- where in the funnel this applicant ends up
    r := (('x' || substr(md5(n || ':16'), 1, 8))::bit(32)::bigint)::float8 / 4294967296;
    target := case when r < 0.06 then 'booked' when r < 0.10 then 'eligible' when r < 0.32 then 'exam_taken'
                   when r < 0.42 then 'vsat_cleared' when r < 0.52 then 'interview_scheduled' when r < 0.62 then 'interviewed'
                   when r < 0.68 then 'pi_cleared' when r < 0.74 then 'counselling_scheduled' when r < 0.82 then 'counselled'
                   when r < 0.90 then 'offer_sent' when r < 0.97 then 'seat_blocked' else 'offer_lapsed' end;
    tstatus := 'active';
    r := (('x' || substr(md5(n || ':17'), 1, 8))::bit(32)::bigint)::float8 / 4294967296;
    if target = 'exam_taken' and (vps < 7.4 or r < 0.3) then tstatus := 'not_selected';      -- VSAT not cleared
    elsif target = 'interviewed' and r < 0.35 then tstatus := 'not_selected';
    elsif target in ('interview_scheduled', 'counselling_scheduled') and r < 0.12 then tstatus := 'absent';
    elsif target in ('vsat_cleared', 'pi_cleared') and r < 0.08 then tstatus := 'on_hold';
    end if;
    if y10 < 2023 and target not in ('booked', 'eligible') then target := 'booked'; tstatus := 'not_selected'; end if;
    ord := array_position(path, case when target = 'offer_lapsed' then 'offer_sent' else target end);   -- lapsed = after offer_sent

    app := 'DUMMY-VSAT-' || lpad(n::text, 5, '0');
    insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage, campus_preference)
    values (uid, (select p.full_name from public.profiles p where p.id = uid), 'zzvsat-' || lpad(n::text, 5, '0') || '@example.invalid', 'applicant_paid', campus)
    on conflict (lead_id) do update set lead_stage = 'applicant_paid', registered_name = excluded.registered_name;
    insert into public.application_manager (
      application_id, lead_id, application_no, registered_name, registered_email, registered_mobile, gender, campus_applied, program,
      class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
      marks_physics_12, marks_chemistry_12, marks_maths_12, studied_cs, jee_registered, jee_score, jee_main_maths_percentile, entrance_percentile,
      form_stage_1, payment_stage_1, application_stage_1, vsat_registered, exam_date_id, exam_assigned,
      exam_percentile, exam_obtained_marks, exam_max_marks, vps_score, created_at)
    values (
      app, uid, app, (select p.full_name from public.profiles p where p.id = uid), 'zzvsat-' || lpad(n::text, 5, '0') || '@example.invalid',
      '90000' || lpad(n::text, 5, '0'), case when female then 'Female' else 'Male' end, campus, 'CS & AI',
      y10, c10, m10, y12, c12, m12, ph, ch, ma, (n % 3 = 0), jee, case when jee then jee_p::text end, jee_m, jee_p,
      'form_submitted', 'payment_approved', 'slot_selected', true, batch, true,
      case when ord >= 3 then pct end, case when ord >= 3 then marks end, case when ord >= 3 then 50 end,
      case when ord >= 3 then vps end, now() - interval '45 days');
    -- trigger has created the pipeline row as "booked"

    if ord >= 3 then
      update public.application_manager set exam_given = true where application_id = app;   -- trigger → exam_taken
    end if;

    -- interview (from interview_scheduled on)
    if ord >= 5 then
      k := k + 1;
      slot := date_trunc('day', now()) - interval '20 days' + (k / 12) * interval '1 day' + (k % 12) * interval '30 minutes' + interval '9 hours';
      insert into public.interview_assignments (application_id, attempt_no, interviewer_id, slot_datetime, meet_link, attendance)
      values (app, 1, ints[1 + n % 4], slot, 'https://meet.google.com/zzd-' || lpad(n::text, 5, '0'),
              case when target = 'interview_scheduled' and tstatus = 'absent' then 'no_show'::public.vm_attendance
                   when ord >= 6 then 'done'::public.vm_attendance else 'scheduled'::public.vm_attendance end);
      if ord >= 6 then
        parts := array(select least(5, greatest(1, round(1 + 4.2 * (('x' || substr(md5(n || ':p' || i), 1, 8))::bit(32)::bigint)::float8 / 4294967296
                                                         + case when ord >= 7 then 1 else 0 end - case when tstatus = 'not_selected' then 1.5 else 0 end)))::numeric
                       from generate_series(1, 5) i);
        if ord >= 7 then parts := array(select greatest(3, x) from unnest(parts) x); end if;           -- cleared PI: no part below 3
        iv := public.vsat_calc_interview(parts[1], parts[2], parts[3], parts[4], parts[5], slot::date);
        update public.interview_assignments
           set rubric_behavioural = parts[1], rubric_math = parts[2], rubric_passion = parts[3], rubric_achievements = parts[4],
               rubric_why_program = parts[5], weighted_avg = (iv->>'score')::numeric,
               result = case when tstatus = 'not_selected' then 'not_selected' else iv->>'suggested_verdict' end
         where application_id = app;
        update public.application_manager set interview_weighted_avg_1 = (iv->>'score')::numeric,
               interview_result_1 = case when tstatus = 'not_selected' then 'not_selected' else iv->>'suggested_verdict' end
         where application_id = app;
      end if;
    end if;

    -- counselling (from counselling_scheduled on)
    if ord >= 8 then
      insert into public.counselling_assignments (application_id, attempt_no, counsellor_id, slot_datetime, zoom_link, attendance)
      values (app, 1, cous[1 + n % 2], slot + interval '5 days', 'https://meet.google.com/zzc-' || lpad(n::text, 5, '0'),
              case when target = 'counselling_scheduled' and tstatus = 'absent' then 'no_show'::public.vm_attendance
                   when ord >= 9 then 'done'::public.vm_attendance else 'scheduled'::public.vm_attendance end);
      if ord >= 9 then
        sc := public.vsat_calc_scholarship(jsonb_build_object(
                'vsat_pct', round(marks * 2, 1), 'class10_pct', c10, 'class12_pct', c12, 'interview_score', (iv->>'score')::numeric,
                'cs_passion', parts[3], 'jee_pct', jee_p, 'jee_maths_pct', jee_m, 'class10_maths_pct', m10, 'class12_maths_pct', m12),
              public.vsat__campus_key(campus), null);
        step := (sc->'award_steps'->>(jsonb_array_length(sc->'award_steps') / 2))::numeric;          -- middle step
        update public.counselling_assignments set scholarship_pct = step, scholarship_category = (sc->>'category')::int,
               pay_timeline_days = 5 where application_id = app;
        update public.application_manager set counselling_status_1 = 'done', scholarship_pct_1 = step,
               scholarship_category_1 = (sc->>'category')::int, scholarship_percentage = step where application_id = app;
      end if;
    end if;

    -- offer dates
    if ord >= 10 then
      update public.application_manager set offer_status = 'released', offer_released_at = slot + interval '7 days',
             offer_expires_at = slot + interval '12 days', offer_released_date = slot + interval '7 days', offer_expiry_date = slot + interval '12 days'
       where application_id = app;
    end if;

    -- walk the student through every stage with the real engine, one step at a time, so history and
    -- the old stage fields (application_stage_1, lead_stage) look exactly like real use
    for i in array_position(path, (select vp.stage from public.vsat_pipeline vp where vp.application_id = app)) + 1 .. ord loop
      perform public.vsat__move(app, path[i], 'active', 'dummy seed', 'system', null, null);
    end loop;
    if target = 'offer_lapsed' then
      perform public.vsat__move(app, 'offer_lapsed', 'active', 'dummy seed', 'system', null, null);
    end if;
    if tstatus <> 'active' then
      perform public.vsat__move(app, target, tstatus, 'dummy seed', 'system', null, null);
    end if;
  end loop;

  raise notice 'Seeded % dummy applicants in 2 batches, 8 dummy staff.', v_per_batch * 2;
end $$;

-- summary: one row per stage
select vp.stage, vp.status, count(*) n
  from public.vsat_pipeline vp where vp.application_id like 'DUMMY-VSAT-%'
 group by 1, 2 order by min(public.vsat__stage_order(vp.stage)), 2;
