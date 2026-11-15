-- 0079 · VSAT pipeline, step 1 — settings and score formulas (staging first).
--
-- Moves the scoring rules from the per-batch Google "Mastersheets" into the database, so
-- Vedam One calculates them instead of sheet cells. Rules copied from VSAT-14 Mastersheet'26
-- (checked against VSAT-12): every VSAT-14 scholarship score and category is reproduced by
-- supabase/tests/vsat_pipeline_scoring.test.sql. Spec: "VSAT Pipeline in Vedam One — Build Spec".
--
-- What this adds (nothing existing is changed or dropped):
--   Settings (admin-editable, browsers never read the tables directly):
--     vsat_exam_dates      + vps_anchors (per batch; null = the global Exam Center anchors)
--                          + cleared_vps_cutoff (per batch, optional)
--     vsat_exam_settings   + eligibility (10th / 12th rules as data)
--     vsat_team            who is admissions / interviewer / counsellor (admins can do everything)
--     vsat_interview_weights  weights with a start date, so old interviews keep their weights
--     vsat_scholarship_bands  category bands + award steps per campus (per batch, or default)
--     vsat_campus_settings    programme fee, offer days, JEE floor on/off per campus
--   Formula functions (private: callable only by other database functions, not by browsers):
--     vsat_calc_vps, vsat_calc_eligibility, vsat_calc_interview, vsat_calc_scholarship,
--     vsat_calc_final_scholarship
--   Role helper for later RPCs: vsat_has_role(role), vsat_my_roles() (the only browser-callable one).
--
-- Known sheet behaviour kept on purpose (decided with the owner, see the spec):
--   * The JEE floor (90+ → 30% … 98.5+ → 70%) never applied in the sheets (the formula returned
--     text, which MAX ignores). It is built but OFF by default (vsat_campus_settings.jee_floor_enabled).
--   * VPS and the logical-reasoning interview score are not part of the scholarship score.
--
-- Rollback: supabase/rollback/0079_vsat_pipeline_scoring_down.sql
-- Tests:    supabase/tests/vsat_pipeline_scoring.test.sql

-- ── settings: per-batch VPS curve and cut-off ─────────────────────────────────────────
alter table public.vsat_exam_dates
  add column if not exists vps_anchors jsonb,             -- null → vsat_exam_settings.vps_anchors
  add column if not exists cleared_vps_cutoff numeric;    -- optional helper for "VSAT cleared"

alter table public.vsat_exam_settings
  add column if not exists eligibility jsonb not null default
    '{"min_year10": 2023, "class12_years": [2025, 2026], "pending_year": 2026, "pcm_min_total": 150}'::jsonb;

-- ── VSAT team (roles for the pipeline) ────────────────────────────────────────────────
create table if not exists public.vsat_team (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admissions', 'interviewer', 'counsellor')),
  campus     text check (campus in ('pune', 'gurugram')),          -- null = both
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (user_id, role)
);
alter table public.vsat_team enable row level security;

-- ── interview weights (dated) ─────────────────────────────────────────────────────────
create table if not exists public.vsat_interview_weights (
  effective_from date primary key,
  w_communication numeric not null,
  w_logic         numeric not null,
  w_passion       numeric not null,
  w_achievements  numeric not null,
  w_why_program   numeric not null,
  note            text
);
alter table public.vsat_interview_weights enable row level security;
insert into public.vsat_interview_weights values
  ('2025-01-01', 0.25, 0.25, 0.20, 0.10, 0.15, 'Used until 26 Mar 2026 (weights sum to 0.95)'),
  ('2026-04-01', 0.25, 0.25, 0.20, 0.15, 0.15, 'Used from 2 Apr 2026')
on conflict (effective_from) do nothing;

-- ── scholarship bands per campus (per batch, or default when exam_date_id is null) ─────
create table if not exists public.vsat_scholarship_bands (
  id           uuid primary key default gen_random_uuid(),
  exam_date_id uuid references public.vsat_exam_dates(id) on delete cascade,
  campus       text not null check (campus in ('pune', 'gurugram')),
  category     int  not null check (category between 1 and 8),
  min_score    numeric not null,
  max_score    numeric not null,
  steps        int  not null check (steps between 1 and 10),
  min_award    numeric not null check (min_award between 0 and 100),
  max_award    numeric not null check (max_award between 0 and 100),
  check (min_score < max_score and min_award <= max_award)
);
create unique index if not exists vsat_scholarship_bands_key
  on public.vsat_scholarship_bands (coalesce(exam_date_id, '00000000-0000-0000-0000-000000000000'::uuid), campus, category);
alter table public.vsat_scholarship_bands enable row level security;
-- defaults = VSAT-14 Mastersheet'26 "Buckets Pune" / "Buckets GGN"
insert into public.vsat_scholarship_bands (exam_date_id, campus, category, min_score, max_score, steps, min_award, max_award) values
  (null, 'pune', 1, 95, 100, 3, 90, 100), (null, 'pune', 2, 90, 95, 3, 75, 85), (null, 'pune', 3, 85, 90, 3, 50, 70),
  (null, 'pune', 4, 80, 85, 2, 50, 55),   (null, 'pune', 5, 75, 80, 2, 35, 45), (null, 'pune', 6, 70, 75, 2, 30, 35),
  (null, 'pune', 7, 65, 70, 3, 15, 25),   (null, 'pune', 8, 0, 65, 2, 5, 10),
  (null, 'gurugram', 1, 95, 100, 2, 95, 100), (null, 'gurugram', 2, 90, 95, 2, 85, 90), (null, 'gurugram', 3, 85, 90, 2, 75, 80),
  (null, 'gurugram', 4, 80, 85, 2, 65, 70),   (null, 'gurugram', 5, 75, 80, 2, 55, 60), (null, 'gurugram', 6, 70, 75, 2, 45, 50),
  (null, 'gurugram', 7, 65, 70, 3, 30, 40),   (null, 'gurugram', 8, 0, 65, 5, 5, 25)
on conflict do nothing;

-- ── campus settings ───────────────────────────────────────────────────────────────────
create table if not exists public.vsat_campus_settings (
  campus            text primary key check (campus in ('pune', 'gurugram')),
  programme_fee     numeric not null check (programme_fee > 0),
  offer_days        int not null check (offer_days between 1 and 60),
  jee_floor_enabled boolean not null default false,
  updated_at        timestamptz not null default now(),
  updated_by        uuid
);
alter table public.vsat_campus_settings enable row level security;
insert into public.vsat_campus_settings (campus, programme_fee, offer_days) values
  ('pune', 1850000, 5), ('gurugram', 1800000, 5)
on conflict (campus) do nothing;

-- ── roles ─────────────────────────────────────────────────────────────────────────────
-- true for admins, or an active vsat_team member with that role
create or replace function public.vsat_has_role(p_role text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(public.is_admin(), false)
      or exists (select 1 from public.vsat_team t where t.user_id = auth.uid() and t.role = p_role and t.active)
$$;

-- what the signed-in user may do in the VSAT panels
create or replace function public.vsat_my_roles()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'admin', coalesce(public.is_admin(), false),
    'roles', coalesce((select jsonb_agg(t.role order by t.role) from public.vsat_team t where t.user_id = auth.uid() and t.active), '[]'::jsonb))
$$;

-- ── formulas ──────────────────────────────────────────────────────────────────────────

-- VPS: piecewise-linear through the anchor points, clamped to [0, 10], 2 decimals.
-- Same maths as src/lib/wheebox/vps.ts computeVps(). Sheet VSAT-14 = anchors (0,0) (65,7.4) (100,9.8).
create or replace function public.vsat_calc_vps(p_percentile numeric, p_anchors jsonb)
returns numeric language plpgsql immutable set search_path to '' as $$
declare a jsonb; p numeric; lo record; hi record; v numeric; n int;
begin
  if p_percentile is null then return null; end if;
  p := greatest(0, least(100, p_percentile));
  select jsonb_agg(x order by (x->>'percentile')::numeric) into a
    from jsonb_array_elements(coalesce(p_anchors, '[]'::jsonb)) x
   where jsonb_typeof(x->'percentile') = 'number' and jsonb_typeof(x->'vps') = 'number';
  n := coalesce(jsonb_array_length(a), 0);
  if n = 0 then return 0; end if;
  if p <= (a->0->>'percentile')::numeric then v := (a->0->>'vps')::numeric;
  elsif p >= (a->(n-1)->>'percentile')::numeric then v := (a->(n-1)->>'vps')::numeric;
  else
    for i in 0 .. n - 2 loop
      if p >= (a->i->>'percentile')::numeric and p <= (a->(i+1)->>'percentile')::numeric then
        v := (a->i->>'vps')::numeric + case when (a->(i+1)->>'percentile')::numeric = (a->i->>'percentile')::numeric then 0
             else (p - (a->i->>'percentile')::numeric) / ((a->(i+1)->>'percentile')::numeric - (a->i->>'percentile')::numeric)
                  * ((a->(i+1)->>'vps')::numeric - (a->i->>'vps')::numeric) end;
        exit;
      end if;
    end loop;
  end if;
  return greatest(0, least(10, round(v, 2)));
end $$;

-- Eligibility (sheet "12th Pass/Fail", "10th Eli", "12th Eli", "Eligibility")
create or replace function public.vsat_calc_eligibility(
  p_year10 int, p_year12 int, p_physics numeric, p_chemistry numeric, p_maths numeric, p_rules jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $$
declare r jsonb := coalesce(p_rules, '{}'::jsonb); total numeric; c12 text; e10 boolean; e12 boolean;
begin
  total := coalesce(p_physics, 0) + coalesce(p_chemistry, 0) + coalesce(p_maths, 0);
  if p_year12 is not null and p_year12 = (r->>'pending_year')::int and total = 0 then c12 := 'yet_to_graduate';
  elsif p_year12 is not null and to_jsonb(p_year12) <@ coalesce(r->'class12_years', '[]'::jsonb)
        and total >= coalesce((r->>'pcm_min_total')::numeric, 150) then c12 := 'pass';
  else c12 := 'fail';
  end if;
  e10 := p_year10 is not null and p_year10 >= coalesce((r->>'min_year10')::int, 2023);
  e12 := p_year12 is not null and c12 <> 'fail'
         and p_year12 >= coalesce((select min(y::int) from jsonb_array_elements_text(r->'class12_years') y), 2025);
  return jsonb_build_object('class12', c12, 'class10_ok', e10, 'class12_ok', e12, 'eligible', e10 and e12, 'pcm_total', total);
end $$;

-- Interview score: weighted sum of five 1–5 parts, using the weights in force on p_at.
-- ranking = score × 4 (out of 20). suggested_verdict: lowest part 1 → not_selected, 2 → maybe, 3+ → selected.
create or replace function public.vsat_calc_interview(
  p_communication numeric, p_logic numeric, p_passion numeric, p_achievements numeric, p_why_program numeric, p_at date)
returns jsonb language plpgsql stable set search_path to '' as $$
declare w record; s numeric; m numeric;
begin
  if p_communication is null or p_logic is null or p_passion is null or p_achievements is null or p_why_program is null then
    return null;
  end if;
  if exists (select 1 from unnest(array[p_communication, p_logic, p_passion, p_achievements, p_why_program]) x
             where x not in (1, 2, 3, 4, 5)) then
    raise exception 'interview_part_out_of_range' using errcode = '22023';
  end if;
  select * into w from public.vsat_interview_weights where effective_from <= coalesce(p_at, current_date)
   order by effective_from desc limit 1;
  if not found then raise exception 'interview_weights_missing' using errcode = '22023'; end if;
  s := round(p_communication * w.w_communication + p_logic * w.w_logic + p_passion * w.w_passion
             + p_achievements * w.w_achievements + p_why_program * w.w_why_program, 4);
  m := least(p_communication, p_logic, p_passion, p_achievements, p_why_program);
  return jsonb_build_object('score', s, 'ranking', round(s * 4, 4), 'weights_from', w.effective_from,
    'suggested_verdict', case when m <= 1 then 'not_selected' when m < 3 then 'maybe' else 'selected' end);
end $$;

-- Scholarship score (sheet "Scholarship Score"), category and award steps.
-- p keys (all 0–100 except interview_score 0–5 and cs_passion 1–5; null = not available):
--   vsat_pct, class10_pct, class12_pct, interview_score, cs_passion, jee_pct, jee_maths_pct,
--   class10_maths_pct, class12_maths_pct
-- Case: JEE present? 12th present? (sheet treats "N/A" as absent; other blanks count as 0).
create or replace function public.vsat_calc_scholarship(p jsonb, p_campus text, p_exam_date_id uuid)
returns jsonb language plpgsql stable set search_path to '' as $$
declare
  vs numeric; c10 numeric; c12 numeric; iv numeric; cs numeric; jee numeric; jm numeric; m10 numeric; m12 numeric;
  k text; s numeric; b record; steps jsonb; floor_pct numeric; k_missing text[] := '{}'; key text;
begin
  if p_campus not in ('pune', 'gurugram') then raise exception 'campus_invalid' using errcode = '22023'; end if;
  foreach key in array array['vsat_pct','class10_pct','class12_pct','interview_score','cs_passion','jee_pct','jee_maths_pct','class10_maths_pct','class12_maths_pct'] loop
    if p ? key and jsonb_typeof(p->key) not in ('number', 'null') then raise exception 'input_not_a_number: %', key using errcode = '22023'; end if;
  end loop;
  vs := (p->>'vsat_pct')::numeric;  c10 := (p->>'class10_pct')::numeric;  c12 := (p->>'class12_pct')::numeric;
  iv := (p->>'interview_score')::numeric;  cs := (p->>'cs_passion')::numeric;
  jee := (p->>'jee_pct')::numeric;  jm := (p->>'jee_maths_pct')::numeric;
  m10 := (p->>'class10_maths_pct')::numeric;  m12 := (p->>'class12_maths_pct')::numeric;
  if exists (select 1 from unnest(array[vs, c10, c12, jee, jm, m10, m12]) x where x < 0 or x > 100)
     or iv < 0 or iv > 5 or cs < 0 or cs > 5 then
    raise exception 'input_out_of_range' using errcode = '22023';
  end if;

  k := case when jee is not null and c12 is not null then 'jee_and_12th'
            when c12 is not null then '12th_only'
            when jee is not null then 'jee_only' else 'neither' end;
  -- inputs the chosen case uses but which are empty (counted as 0, like the sheet)
  k_missing := array(select n from (values
                       ('vsat_pct', vs, true), ('class10_pct', c10, true), ('interview_score', iv, true),
                       ('cs_passion', cs, true), ('class10_maths_pct', m10, true),
                       ('jee_maths_pct', jm, k in ('jee_and_12th', 'jee_only')),
                       ('class12_maths_pct', m12, k in ('jee_and_12th', '12th_only'))) v(n, x, used)
                     where used and x is null);
  s := case k
    when 'neither'      then coalesce(vs,0)*0.25 + coalesce(c10,0)*0.20 + coalesce(iv,0)*20*0.35 + coalesce(m10,0)*0.10 + coalesce(cs,0)*20*0.10
    when 'jee_and_12th' then coalesce(vs,0)*0.15 + coalesce(c10,0)*0.05 + coalesce(m10,0)*0.05 + coalesce(m12,0)*0.10 + c12*0.10
                             + coalesce(iv,0)*20*0.15 + jee*0.20 + coalesce(jm,0)*0.15 + coalesce(cs,0)*20*0.05
    when '12th_only'    then coalesce(vs,0)*0.20 + coalesce(c10,0)*0.05 + c12*0.20 + coalesce(iv,0)*20*0.20 + coalesce(m12,0)*0.15
                             + coalesce(m10,0)*0.15 + coalesce(cs,0)*20*0.05
    else                     coalesce(vs,0)*0.20 + coalesce(c10,0)*0.05 + jee*0.20 + coalesce(jm,0)*0.15 + coalesce(iv,0)*20*0.20
                             + coalesce(m10,0)*0.15 + coalesce(cs,0)*20*0.05
  end;
  s := round(s, 4);

  -- band: this batch's bands for the campus, else the defaults; lower edge included, category 1 includes 100
  select * into b from public.vsat_scholarship_bands sb
   where sb.campus = p_campus
     and sb.exam_date_id is not distinct from (
           case when exists (select 1 from public.vsat_scholarship_bands x where x.campus = p_campus and x.exam_date_id = p_exam_date_id)
                then p_exam_date_id end)
     and s >= sb.min_score and (s < sb.max_score or (sb.category = 1 and s <= sb.max_score))
   order by sb.category limit 1;

  if b.id is not null then
    steps := (select jsonb_agg(round(b.min_award + i * (b.max_award - b.min_award) / greatest(b.steps - 1, 1), 2) order by i)
                from generate_series(0, b.steps - 1) i);
  end if;

  floor_pct := case when jee is null or jee < 90 then null when jee >= 98.5 then 70 when jee >= 97 then 60
                    when jee >= 95 then 50 when jee >= 93 then 40 else 30 end;

  return jsonb_build_object('case', k, 'score', s, 'category', b.category, 'min_award', b.min_award, 'max_award', b.max_award,
                            'award_steps', coalesce(steps, '[]'::jsonb), 'jee_floor', floor_pct,
                            'missing', to_jsonb(k_missing));
end $$;

-- Final scholarship %: chosen award step, raised to the JEE floor only if that campus has it
-- switched on, plus 10 if the special 1–5 rating (sheet column BQ, meaning to confirm) is 5 and
-- the result is 30% or less. Capped at 100.
create or replace function public.vsat_calc_final_scholarship(
  p_weightage_pct numeric, p_jee_floor numeric, p_special_rating int, p_campus text)
returns jsonb language plpgsql stable set search_path to '' as $$
declare use_floor boolean; m numeric; bonus boolean;
begin
  if p_weightage_pct is not null and (p_weightage_pct < 0 or p_weightage_pct > 100) then
    raise exception 'weightage_out_of_range' using errcode = '22023';
  end if;
  select c.jee_floor_enabled into use_floor from public.vsat_campus_settings c where c.campus = p_campus;
  if not found then raise exception 'campus_invalid' using errcode = '22023'; end if;
  m := greatest(coalesce(p_weightage_pct, 0), case when use_floor then coalesce(p_jee_floor, 0) else 0 end);
  bonus := p_special_rating = 5 and m <= 30;
  return jsonb_build_object('pct', least(100, m + case when bonus then 10 else 0 end),
                            'jee_floor_applied', use_floor and coalesce(p_jee_floor, 0) > coalesce(p_weightage_pct, 0),
                            'bonus_applied', coalesce(bonus, false));
end $$;

-- ── grants: formulas and settings tables are private; only vsat_my_roles is browser-callable ──
revoke all on function public.vsat_has_role(text) from public, anon, authenticated;
revoke all on function public.vsat_calc_vps(numeric, jsonb) from public, anon, authenticated;
revoke all on function public.vsat_calc_eligibility(int, int, numeric, numeric, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.vsat_calc_interview(numeric, numeric, numeric, numeric, numeric, date) from public, anon, authenticated;
revoke all on function public.vsat_calc_scholarship(jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.vsat_calc_final_scholarship(numeric, numeric, int, text) from public, anon, authenticated;
revoke all on function public.vsat_my_roles() from public, anon;
grant execute on function public.vsat_my_roles() to authenticated;
revoke all on public.vsat_team, public.vsat_interview_weights, public.vsat_scholarship_bands, public.vsat_campus_settings
  from public, anon, authenticated;
