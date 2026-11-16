-- 0098 · VSAT pipeline — Settings screen + Team screen (admin only)
--
-- Until now these could only be changed in the database. This adds the RPCs behind two admin
-- screens in the VSAT Admin Panel:
--
--   Scholarship & scoring
--     • campus settings     programme fee, days to pay the offer, JEE floor on/off (per campus)
--     • interview weights   a new dated set; only dates from tomorrow (IST) can be added, changed or
--                           removed, so interviews already submitted keep the weights they used
--     • scholarship bands   per campus, as the default or for one VSAT; a set must run without gaps
--                           from 100 (category 1) down to 0, so no score falls outside a band
--     • per VSAT            VPS curve (anchor points) and the "VSAT cleared" VPS cut-off; empty = use
--                           the Exam Center default
--   Team
--     • add a person (by the email of an existing Vedam One account) as admissions / interviewer /
--       counsellor, with an optional campus; switch a role off or on again (never deleted, so
--       history and past assignments keep their names)
--
-- Security: every RPC is admin only (is_admin(), not every @vedam.org login: these rules decide
-- scholarships and who sees student data). SECURITY DEFINER, search_path '', authenticated only.
-- Every change is written to vsat_settings_audit (who, what, before, after); RLS on, no grants.
-- Nothing already stored is recalculated: submitted interviews and counselling keep their values.
--
-- Rollback: supabase/rollback/0098_vsat_settings_team_down.sql   Tests: supabase/tests/vsat_settings_team.test.sql

-- ── audit log ─────────────────────────────────────────────────────────────────────────
create table if not exists public.vsat_settings_audit (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  area       text not null check (area in ('campus', 'weights', 'bands', 'vsat', 'team')),
  target     text not null,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index if not exists vsat_settings_audit_time on public.vsat_settings_audit (created_at desc);
alter table public.vsat_settings_audit enable row level security;
revoke all on table public.vsat_settings_audit from public, anon, authenticated;

-- private: admin check + log
create or replace function public.vsat__settings_admin()
returns void language plpgsql stable security definer set search_path to '' as $$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
end $$;
revoke all on function public.vsat__settings_admin() from public, anon, authenticated;

create or replace function public.vsat__settings_log(p_area text, p_target text, p_before jsonb, p_after jsonb)
returns void language sql security definer set search_path to '' as $$
  insert into public.vsat_settings_audit (user_id, area, target, before, after) values (auth.uid(), p_area, p_target, p_before, p_after)
$$;
revoke all on function public.vsat__settings_log(text, text, jsonb, jsonb) from public, anon, authenticated;

-- private: a number from the request within [lo, hi] (null when absent and not required)
create or replace function public.vsat__settings_num(p jsonb, k text, lo numeric, hi numeric, req boolean)
returns numeric language plpgsql immutable set search_path to '' as $$
declare v numeric;
begin
  if p is null or not (p ? k) or jsonb_typeof(p->k) = 'null' then
    if req then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
    return null;
  end if;
  if jsonb_typeof(p->k) <> 'number' then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  v := (p->>k)::numeric;
  if v < lo or v > hi then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  return v;
end $$;
revoke all on function public.vsat__settings_num(jsonb, text, numeric, numeric, boolean) from public, anon, authenticated;

-- ── read everything the settings screen shows ─────────────────────────────────────────
create or replace function public.vsat_settings_get()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare s public.vsat_exam_settings; tomorrow date := (now() at time zone 'Asia/Kolkata')::date + 1;
begin
  perform public.vsat__settings_admin();
  select * into s from public.vsat_exam_settings where id = 1;
  return jsonb_build_object(
    'editable_from', tomorrow,
    'campuses', coalesce((select jsonb_agg(jsonb_build_object('campus', c.campus, 'programme_fee', c.programme_fee, 'offer_days', c.offer_days,
                            'jee_floor_enabled', c.jee_floor_enabled, 'updated_at', c.updated_at) order by c.campus)
                          from public.vsat_campus_settings c), '[]'::jsonb),
    'weights', coalesce((select jsonb_agg(jsonb_build_object('effective_from', w.effective_from, 'w_communication', w.w_communication, 'w_logic', w.w_logic,
                            'w_passion', w.w_passion, 'w_achievements', w.w_achievements, 'w_why_program', w.w_why_program, 'note', w.note,
                            'editable', w.effective_from >= tomorrow) order by w.effective_from desc)
                         from public.vsat_interview_weights w), '[]'::jsonb),
    'bands', coalesce((select jsonb_agg(jsonb_build_object('exam_date_id', b.exam_date_id, 'campus', b.campus, 'category', b.category,
                          'min_score', b.min_score, 'max_score', b.max_score, 'steps', b.steps, 'min_award', b.min_award, 'max_award', b.max_award)
                          order by b.exam_date_id nulls first, b.campus, b.category)
                       from public.vsat_scholarship_bands b), '[]'::jsonb),
    'vsats', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'exam_date', d.exam_date, 'enabled', d.enabled,
                          'vps_anchors', d.vps_anchors, 'cleared_vps_cutoff', d.cleared_vps_cutoff,
                          'students', (select count(*) from public.application_manager am where am.exam_date_id = d.id)) order by d.exam_date desc)
                       from public.vsat_exam_dates d), '[]'::jsonb),
    'default_vps_anchors', s.vps_anchors,
    'default_cleared_vps_cutoff', s.pass_vps_cutoff);
end $$;

-- ── campus: fee, days to pay, JEE floor ───────────────────────────────────────────────
-- p: {campus, programme_fee, offer_days, jee_floor_enabled}
create or replace function public.vsat_settings_campus_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_campus text; old public.vsat_campus_settings; fee numeric; days numeric;
begin
  perform public.vsat__settings_admin();
  perform public.vsat__check_keys(p, array['campus', 'programme_fee', 'offer_days', 'jee_floor_enabled']);
  v_campus := p->>'campus';
  select * into old from public.vsat_campus_settings where campus = v_campus for update;
  if not found then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  fee  := public.vsat__settings_num(p, 'programme_fee', 100000, 10000000, true);
  days := public.vsat__settings_num(p, 'offer_days', 1, 60, true);
  if days <> trunc(days) then raise exception 'BAD_VALUE: offer_days' using errcode = '22023'; end if;
  if jsonb_typeof(p->'jee_floor_enabled') is distinct from 'boolean' then raise exception 'BAD_VALUE: jee_floor_enabled' using errcode = '22023'; end if;
  update public.vsat_campus_settings
     set programme_fee = fee, offer_days = days::int, jee_floor_enabled = (p->>'jee_floor_enabled')::boolean, updated_at = now(), updated_by = auth.uid()
   where campus = v_campus;
  perform public.vsat__settings_log('campus', v_campus,
    jsonb_build_object('programme_fee', old.programme_fee, 'offer_days', old.offer_days, 'jee_floor_enabled', old.jee_floor_enabled),
    jsonb_build_object('programme_fee', fee, 'offer_days', days::int, 'jee_floor_enabled', (p->>'jee_floor_enabled')::boolean));
  return jsonb_build_object('ok', true);
end $$;

-- ── interview weights: add / change a dated set (from tomorrow), or remove a future one ──
-- p: {effective_from, w_communication, w_logic, w_passion, w_achievements, w_why_program, note?}
create or replace function public.vsat_settings_weights_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare d date; tomorrow date := (now() at time zone 'Asia/Kolkata')::date + 1; old jsonb; total numeric;
  w1 numeric; w2 numeric; w3 numeric; w4 numeric; w5 numeric; v_note text;
begin
  perform public.vsat__settings_admin();
  perform public.vsat__check_keys(p, array['effective_from', 'w_communication', 'w_logic', 'w_passion', 'w_achievements', 'w_why_program', 'note']);
  begin d := (p->>'effective_from')::date; exception when others then raise exception 'BAD_VALUE: effective_from' using errcode = '22023'; end;
  if d is null or d < tomorrow then raise exception 'PAST_DATE' using errcode = '22023'; end if;
  w1 := public.vsat__settings_num(p, 'w_communication', 0, 1, true);
  w2 := public.vsat__settings_num(p, 'w_logic', 0, 1, true);
  w3 := public.vsat__settings_num(p, 'w_passion', 0, 1, true);
  w4 := public.vsat__settings_num(p, 'w_achievements', 0, 1, true);
  w5 := public.vsat__settings_num(p, 'w_why_program', 0, 1, true);
  total := w1 + w2 + w3 + w4 + w5;
  if total < 0.5 or total > 1 then raise exception 'BAD_WEIGHTS' using errcode = '22023'; end if;
  if p ? 'note' and jsonb_typeof(p->'note') not in ('string', 'null') then raise exception 'BAD_VALUE: note' using errcode = '22023'; end if;
  v_note := nullif(left(btrim(coalesce(p->>'note', '')), 200), '');
  select to_jsonb(w) into old from public.vsat_interview_weights w where w.effective_from = d;
  insert into public.vsat_interview_weights (effective_from, w_communication, w_logic, w_passion, w_achievements, w_why_program, note)
  values (d, w1, w2, w3, w4, w5, v_note)
  on conflict (effective_from) do update set w_communication = excluded.w_communication, w_logic = excluded.w_logic, w_passion = excluded.w_passion,
    w_achievements = excluded.w_achievements, w_why_program = excluded.w_why_program, note = excluded.note;
  perform public.vsat__settings_log('weights', d::text, old,
    jsonb_build_object('w_communication', w1, 'w_logic', w2, 'w_passion', w3, 'w_achievements', w4, 'w_why_program', w5, 'note', v_note));
  return jsonb_build_object('ok', true, 'effective_from', d);
end $$;

-- p: {effective_from}
create or replace function public.vsat_settings_weights_delete(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare d date; tomorrow date := (now() at time zone 'Asia/Kolkata')::date + 1; old jsonb;
begin
  perform public.vsat__settings_admin();
  perform public.vsat__check_keys(p, array['effective_from']);
  begin d := (p->>'effective_from')::date; exception when others then raise exception 'BAD_VALUE: effective_from' using errcode = '22023'; end;
  if d is null or d < tomorrow then raise exception 'PAST_DATE' using errcode = '22023'; end if;
  select to_jsonb(w) into old from public.vsat_interview_weights w where w.effective_from = d;
  if old is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  delete from public.vsat_interview_weights where effective_from = d;
  perform public.vsat__settings_log('weights', d::text, old, null);
  return jsonb_build_object('ok', true);
end $$;

-- ── scholarship bands: replace a whole set (default or one VSAT) for a campus ──────────
-- p: {exam_date_id: uuid|null, campus, bands: [{category, min_score, max_score, steps, min_award, max_award}] }
-- bands: [] with a VSAT removes that VSAT's own set (it goes back to the default).
create or replace function public.vsat_settings_bands_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_campus text; v_date uuid; old jsonb; n int; b jsonb; i int; prev_min numeric; cat int;
  mn numeric; mx numeric; st numeric; a0 numeric; a1 numeric; new_set jsonb := '[]'::jsonb;
begin
  perform public.vsat__settings_admin();
  perform public.vsat__check_keys(p, array['exam_date_id', 'campus', 'bands']);
  v_campus := p->>'campus';
  if v_campus is null or v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  if p ? 'exam_date_id' and jsonb_typeof(p->'exam_date_id') not in ('string', 'null') then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end if;
  begin v_date := nullif(p->>'exam_date_id', '')::uuid; exception when others then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end;
  if v_date is not null and not exists (select 1 from public.vsat_exam_dates d where d.id = v_date) then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end if;
  if jsonb_typeof(p->'bands') is distinct from 'array' then raise exception 'BAD_VALUE: bands' using errcode = '22023'; end if;
  n := jsonb_array_length(p->'bands');
  if n = 0 and v_date is null then raise exception 'BAD_BANDS: the default set cannot be empty' using errcode = '22023'; end if;
  if n > 8 then raise exception 'BAD_BANDS: at most 8 categories' using errcode = '22023'; end if;

  -- categories 1..n in order, top band ends at 100, each band starts where the next one (lower) ends, last starts at 0
  for i in 0 .. n - 1 loop
    b := (select e from jsonb_array_elements(p->'bands') with ordinality x(e, o) order by (e->>'category')::numeric nulls last, o offset i limit 1);
    perform public.vsat__check_keys(b, array['category', 'min_score', 'max_score', 'steps', 'min_award', 'max_award']);
    cat := public.vsat__settings_num(b, 'category', 1, 8, true)::int;
    if cat <> i + 1 then raise exception 'BAD_BANDS: categories must be 1 to % in order', n using errcode = '22023'; end if;
    mn := public.vsat__settings_num(b, 'min_score', 0, 100, true);
    mx := public.vsat__settings_num(b, 'max_score', 0, 100, true);
    st := public.vsat__settings_num(b, 'steps', 1, 10, true);
    a0 := public.vsat__settings_num(b, 'min_award', 0, 100, true);
    a1 := public.vsat__settings_num(b, 'max_award', 0, 100, true);
    if st <> trunc(st) then raise exception 'BAD_BANDS: steps must be a whole number' using errcode = '22023'; end if;
    if mn >= mx then raise exception 'BAD_BANDS: category % score range', cat using errcode = '22023'; end if;
    if a0 > a1 then raise exception 'BAD_BANDS: category % award range', cat using errcode = '22023'; end if;
    if i = 0 and mx <> 100 then raise exception 'BAD_BANDS: category 1 must end at 100' using errcode = '22023'; end if;
    if i > 0 and mx <> prev_min then raise exception 'BAD_BANDS: category % must end where category % starts', cat, cat - 1 using errcode = '22023'; end if;
    if i = n - 1 and mn <> 0 then raise exception 'BAD_BANDS: the last category must start at 0' using errcode = '22023'; end if;
    prev_min := mn;
    new_set := new_set || jsonb_build_object('category', cat, 'min_score', mn, 'max_score', mx, 'steps', st::int, 'min_award', a0, 'max_award', a1);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('category', x.category, 'min_score', x.min_score, 'max_score', x.max_score, 'steps', x.steps,
                                               'min_award', x.min_award, 'max_award', x.max_award) order by x.category), '[]'::jsonb)
    into old from public.vsat_scholarship_bands x where x.campus = v_campus and x.exam_date_id is not distinct from v_date;
  delete from public.vsat_scholarship_bands x where x.campus = v_campus and x.exam_date_id is not distinct from v_date;
  insert into public.vsat_scholarship_bands (exam_date_id, campus, category, min_score, max_score, steps, min_award, max_award)
  select v_date, v_campus, (e->>'category')::int, (e->>'min_score')::numeric, (e->>'max_score')::numeric, (e->>'steps')::int,
         (e->>'min_award')::numeric, (e->>'max_award')::numeric
    from jsonb_array_elements(new_set) e;
  perform public.vsat__settings_log('bands', v_campus || ':' || coalesce(v_date::text, 'default'), old, new_set);
  return jsonb_build_object('ok', true, 'categories', n);
end $$;

-- ── per VSAT: VPS curve + "cleared" cut-off (null = the Exam Center default) ───────────
-- p: {exam_date_id, vps_anchors: [{percentile, vps}, …] | null, cleared_vps_cutoff: number | null}
create or replace function public.vsat_settings_vsat_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_date uuid; old jsonb; a jsonb; anchors jsonb := null; cutoff numeric; n int; i int; pp numeric; vv numeric; lp numeric; lv numeric;
begin
  perform public.vsat__settings_admin();
  perform public.vsat__check_keys(p, array['exam_date_id', 'vps_anchors', 'cleared_vps_cutoff']);
  begin v_date := (p->>'exam_date_id')::uuid; exception when others then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end;
  select jsonb_build_object('vps_anchors', d.vps_anchors, 'cleared_vps_cutoff', d.cleared_vps_cutoff) into old
    from public.vsat_exam_dates d where d.id = v_date for update;
  if old is null then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end if;
  if not (p ? 'vps_anchors') or not (p ? 'cleared_vps_cutoff') then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;

  if jsonb_typeof(p->'vps_anchors') = 'array' then
    n := jsonb_array_length(p->'vps_anchors');
    if n < 2 or n > 10 then raise exception 'BAD_ANCHORS: 2 to 10 points' using errcode = '22023'; end if;
    anchors := '[]'::jsonb;
    for i in 0 .. n - 1 loop
      a := p->'vps_anchors'->i;
      perform public.vsat__check_keys(a, array['percentile', 'vps']);
      pp := public.vsat__settings_num(a, 'percentile', 0, 100, true);
      vv := public.vsat__settings_num(a, 'vps', 0, 10, true);
      if i > 0 and (pp <= lp or vv < lv) then raise exception 'BAD_ANCHORS: percentiles must rise and VPS must not fall' using errcode = '22023'; end if;
      lp := pp; lv := vv;
      anchors := anchors || jsonb_build_object('percentile', pp, 'vps', vv);
    end loop;
  elsif jsonb_typeof(p->'vps_anchors') <> 'null' then
    raise exception 'BAD_VALUE: vps_anchors' using errcode = '22023';
  end if;
  cutoff := public.vsat__settings_num(p, 'cleared_vps_cutoff', 0, 10, false);

  update public.vsat_exam_dates set vps_anchors = anchors, cleared_vps_cutoff = cutoff, updated_at = now() where id = v_date;
  perform public.vsat__settings_log('vsat', v_date::text, old, jsonb_build_object('vps_anchors', anchors, 'cleared_vps_cutoff', cutoff));
  return jsonb_build_object('ok', true);
end $$;

-- ── team ──────────────────────────────────────────────────────────────────────────────
-- every role row (active or not), with open assignments so the screen can warn before switching one off
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
                                                 where a.interviewer_id = t.user_id and vp.stage = 'interview_scheduled')
                       when 'counsellor' then (select count(*) from public.counselling_assignments a join public.vsat_pipeline vp
                                                  on vp.application_id = a.application_id and vp.attempt_no = a.attempt_no
                                                 where a.counsellor_id = t.user_id and vp.stage = 'counselling_scheduled')
                       else 0 end)
             order by t.active desc, coalesce(pr.full_name, u.email), t.role)
      from public.vsat_team t join auth.users u on u.id = t.user_id left join public.profiles pr on pr.id = t.user_id), '[]'::jsonb);
end $$;

-- p: {email, role, campus?}  — the person must already have a Vedam One account
create or replace function public.vsat_team_add(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_email text; v_role text; v_campus text; uid uuid; old jsonb;
begin
  perform public.vsat__settings_admin();
  perform public.vsat__check_keys(p, array['email', 'role', 'campus']);
  v_email := lower(btrim(coalesce(p->>'email', '')));
  if char_length(v_email) < 5 or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'BAD_VALUE: email' using errcode = '22023'; end if;
  v_role := p->>'role';
  if v_role is null or v_role not in ('admissions', 'interviewer', 'counsellor') then raise exception 'BAD_VALUE: role' using errcode = '22023'; end if;
  if p ? 'campus' and jsonb_typeof(p->'campus') not in ('string', 'null') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  v_campus := nullif(p->>'campus', '');
  if v_campus is not null and v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  select u.id into uid from auth.users u where lower(u.email) = v_email limit 1;
  if uid is null then raise exception 'NO_ACCOUNT' using errcode = 'P0002'; end if;
  select to_jsonb(t) into old from public.vsat_team t where t.user_id = uid and t.role = v_role;
  insert into public.vsat_team (user_id, role, campus, active, created_by) values (uid, v_role, v_campus, true, auth.uid())
  on conflict (user_id, role) do update set campus = excluded.campus, active = true;
  perform public.vsat__settings_log('team', uid::text || ':' || v_role, old, jsonb_build_object('role', v_role, 'campus', v_campus, 'active', true));
  return jsonb_build_object('ok', true, 'user_id', uid, 'reactivated', old is not null);
end $$;

-- p: {user_id, role, active?, campus?}
create or replace function public.vsat_team_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare uid uuid; v_role text; old public.vsat_team; v_campus text; v_active boolean;
begin
  perform public.vsat__settings_admin();
  perform public.vsat__check_keys(p, array['user_id', 'role', 'active', 'campus']);
  begin uid := (p->>'user_id')::uuid; exception when others then raise exception 'BAD_VALUE: user_id' using errcode = '22023'; end;
  v_role := p->>'role';
  select * into old from public.vsat_team t where t.user_id = uid and t.role = v_role for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_active := old.active; v_campus := old.campus;
  if p ? 'active' then
    if jsonb_typeof(p->'active') <> 'boolean' then raise exception 'BAD_VALUE: active' using errcode = '22023'; end if;
    v_active := (p->>'active')::boolean;
  end if;
  if p ? 'campus' then
    if jsonb_typeof(p->'campus') not in ('string', 'null') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
    v_campus := nullif(p->>'campus', '');
    if v_campus is not null and v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  end if;
  update public.vsat_team set active = v_active, campus = v_campus where user_id = uid and role = v_role;
  perform public.vsat__settings_log('team', uid::text || ':' || v_role,
    jsonb_build_object('active', old.active, 'campus', old.campus), jsonb_build_object('active', v_active, 'campus', v_campus));
  return jsonb_build_object('ok', true);
end $$;

-- ── grants ────────────────────────────────────────────────────────────────────────────
do $g$
declare f text;
begin
  foreach f in array array['public.vsat_settings_get()', 'public.vsat_settings_campus_set(jsonb)', 'public.vsat_settings_weights_set(jsonb)',
                           'public.vsat_settings_weights_delete(jsonb)', 'public.vsat_settings_bands_set(jsonb)', 'public.vsat_settings_vsat_set(jsonb)',
                           'public.vsat_team_admin_list()', 'public.vsat_team_add(jsonb)', 'public.vsat_team_set(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;
