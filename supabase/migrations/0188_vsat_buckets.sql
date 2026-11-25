-- 0188 · VSAT Phase 5 · Buckets per VSAT and campus: ARPU target, suggested buckets, hand edit, lock, live ARPU
-- (owner's review 24 Nov 2026, transcript; decisions 25 Nov) — staging first.
--
-- Sir (transcript):
--   · "Buckets" page under Counselling Evaluation, for Pune and Gurugram (Bangalore later); "har VSAT bucket hum fix
--     karenge ya system apne aap fix karega"; a VSAT dropdown and "is VSAT ka ARPU kitna hona chahiye" per campus;
--   · ARPU = average revenue per user = programme fee − scholarship, averaged over the students; the system rearranges the
--     buckets and gives students their scholarship from their scholarship score so the ARPU is hit — the score stays the
--     same, the category and % can change; "manually bhi override kar payenge";
--   · "jitna bucket, utna range": every bucket is 5 % (3 buckets = 90 / 95 / 100, 4 = 85–100); "rule hum tight karke
--     chalayenge" → a band's award range must be 5 × (buckets − 1) points;
--   · "is VSAT ka ye hai, lock kar do, taaki yahan change karne pe purane VSATs ka change nahi hona chahiye";
--   · tiles: Pune ARPU, Gurugram ARPU, overall ARPU, changing as the buckets are changed; changing Pune's buckets changes
--     only Pune students' scholarship and category.
-- Owner's decisions (25 Nov): the suggestion moves every category's award range up or down by the same 5-point steps
-- (bucket counts and score ranges stay); an admin reviews, can change anything by hand, then saves. Admins edit, admissions
-- only view. An admin can unlock with a reason (kept in the settings audit). ARPU uses the system % from the score (as
-- sir said), over the VSAT's students at PI cleared and every stage after it (the Counselling Evaluation population).
-- Counselling forms already saved keep the % they were saved with.
--
--   vsat_bucket_sets            per VSAT + campus: ARPU target, locked at / by (RLS on, no policies, no browser access)
--   vsat__bands_check           private: the bands rules of 0098 (+ the 5-points-per-bucket rule for the Buckets page)
--   vsat_settings_bands_set     (0098 body, replaced) same rules via vsat__bands_check; refuses a locked VSAT (LOCKED)
--   vsat__bands_in_use          private: a VSAT's own bands for the campus, else the default
--   vsat__calc_safe             private: vsat_calc_scholarship that returns null instead of failing on bad data
--   vsat__bucket_pop            private: the VSAT's students (PI cleared and after) with score, JEE floor, achievements
--   vsat__bucket_cat / _pct     private: category and final % for a score under a given set (same rules as 0083)
--   vsat__bucket_arpu           private: students, ARPU, average % and the split by category under a given set
--   vsat_buckets_get            admins and admissions (campus scope): VSATs, the set in use per campus, lock, target, ARPU
--   vsat_buckets_preview        admins: ARPU of a draft set (nothing saved) — the live tiles
--   vsat_buckets_suggest        admins: the set (5-point shifts) whose ARPU meets the target with the most scholarship
--   vsat_buckets_save           admins: the VSAT's own set + target (5-point rule, then vsat_settings_bands_set: lock, rules)
--   vsat_buckets_lock           admins: lock (copies the default first if the VSAT has no own set) / unlock with a reason
--
-- Rollback: supabase/rollback/0188_vsat_buckets_down.sql
-- Tests:    supabase/tests/vsat_buckets.test.sql

-- ── table ──────────────────────────────────────────────────────────────────
create table if not exists public.vsat_bucket_sets (
  exam_date_id uuid not null references public.vsat_exam_dates(id) on delete cascade,
  campus       text not null check (campus in ('pune', 'gurugram')),
  arpu_target  numeric check (arpu_target is null or (arpu_target >= 0 and arpu_target <= 100000000)),
  locked_at    timestamptz,
  locked_by    uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  primary key (exam_date_id, campus)
);
alter table public.vsat_bucket_sets enable row level security;
revoke all on table public.vsat_bucket_sets from public, anon, authenticated;

-- ── private: the bands rules ───────────────────────────────────────────────
create or replace function public.vsat__bands_check(p_bands jsonb, p_rule boolean)
returns jsonb language plpgsql stable set search_path to '' as $$
declare n int; b jsonb; i int; prev_min numeric; cat int; mn numeric; mx numeric; st numeric; a0 numeric; a1 numeric; new_set jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_bands) is distinct from 'array' then raise exception 'BAD_VALUE: bands' using errcode = '22023'; end if;
  n := jsonb_array_length(p_bands);
  if n = 0 then raise exception 'BAD_BANDS: at least 1 category' using errcode = '22023'; end if;
  if n > 8 then raise exception 'BAD_BANDS: at most 8 categories' using errcode = '22023'; end if;
  -- categories 1..n in order, top band ends at 100, each band starts where the next one (lower) ends, last starts at 0
  for i in 0 .. n - 1 loop
    b := (select e from jsonb_array_elements(p_bands) with ordinality x(e, o) order by (e->>'category')::numeric nulls last, o offset i limit 1);
    if jsonb_typeof(b) is distinct from 'object' then raise exception 'BAD_VALUE: bands' using errcode = '22023'; end if;
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
    -- vsat_buckets (sir: "jitna bucket, utna range"): every bucket is 5 points — checked when a set is saved
    if p_rule and a1 - a0 <> 5 * (st - 1) then
      raise exception 'BAD_BANDS: category % has % buckets, so its award range must be % points (5 each)', cat, st::int, (5 * (st - 1))::int
        using errcode = '22023';
    end if;
    if i = 0 and mx <> 100 then raise exception 'BAD_BANDS: category 1 must end at 100' using errcode = '22023'; end if;
    if i > 0 and mx <> prev_min then raise exception 'BAD_BANDS: category % must end where category % starts', cat, cat - 1 using errcode = '22023'; end if;
    if i = n - 1 and mn <> 0 then raise exception 'BAD_BANDS: the last category must start at 0' using errcode = '22023'; end if;
    prev_min := mn;
    new_set := new_set || jsonb_build_object('category', cat, 'min_score', mn, 'max_score', mx, 'steps', st::int, 'min_award', a0, 'max_award', a1);
  end loop;
  return new_set;
end $$;
revoke all on function public.vsat__bands_check(jsonb, boolean) from public, anon, authenticated;

-- ── vsat_settings_bands_set (0098 body, replaced): same request, rules and result (via vsat__bands_check); + lock ──
create or replace function public.vsat_settings_bands_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_campus text; v_date uuid; old jsonb; n int; new_set jsonb := '[]'::jsonb;
begin
  perform public.vsat__settings_admin();
  perform public.vsat__check_keys(p, array['exam_date_id', 'campus', 'bands']);
  v_campus := p->>'campus';
  if v_campus is null or v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  if p ? 'exam_date_id' and jsonb_typeof(p->'exam_date_id') not in ('string', 'null') then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end if;
  begin v_date := nullif(p->>'exam_date_id', '')::uuid; exception when others then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end;
  if v_date is not null and not exists (select 1 from public.vsat_exam_dates d where d.id = v_date) then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end if;
  if jsonb_typeof(p->'bands') is distinct from 'array' then raise exception 'BAD_VALUE: bands' using errcode = '22023'; end if;
  -- vsat_buckets: a locked VSAT's buckets do not change (unlock first)
  if v_date is not null and exists (select 1 from public.vsat_bucket_sets s where s.exam_date_id = v_date and s.campus = v_campus and s.locked_at is not null) then
    raise exception 'LOCKED' using errcode = '22023';
  end if;
  n := jsonb_array_length(p->'bands');
  if n = 0 and v_date is null then raise exception 'BAD_BANDS: the default set cannot be empty' using errcode = '22023'; end if;
  if n > 0 then new_set := public.vsat__bands_check(p->'bands', false); end if;

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

-- ── private: the set in use, the population and the maths ─────────────────
create or replace function public.vsat__bands_in_use(p_campus text, p_date uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('category', b.category, 'min_score', b.min_score, 'max_score', b.max_score, 'steps', b.steps,
                                               'min_award', b.min_award, 'max_award', b.max_award) order by b.category), '[]'::jsonb)
    from public.vsat_scholarship_bands b
   where b.campus = p_campus
     and b.exam_date_id is not distinct from (
           case when exists (select 1 from public.vsat_scholarship_bands x where x.campus = p_campus and x.exam_date_id = p_date) then p_date end)
$$;
revoke all on function public.vsat__bands_in_use(text, uuid) from public, anon, authenticated;

create or replace function public.vsat__calc_safe(p_inp jsonb, p_campus text, p_date uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  return public.vsat_calc_scholarship(p_inp, p_campus, p_date);
exception when others then
  return null;  -- bad data on one application must not stop the page (that student is left out of the ARPU)
end $$;
revoke all on function public.vsat__calc_safe(jsonb, text, uuid) from public, anon, authenticated;

create or replace function public.vsat__bucket_pop(p_date uuid, p_campus text)
returns table (application_id text, campus text, fee numeric, score numeric, jee_floor numeric, rating int)
language sql stable security definer set search_path to '' as $$
  select vp.application_id, c.k, s.programme_fee, (x.sc->>'score')::numeric, (x.sc->>'jee_floor')::numeric, ia.rt
    from public.vsat_pipeline vp
    join public.application_manager am on am.application_id = vp.application_id
    cross join lateral (select public.vsat__campus_key(am.campus_applied) k) c
    join public.vsat_campus_settings s on s.campus = c.k
    cross join lateral (select public.vsat__calc_safe(public.vsat__scholarship_inputs(vp.application_id), c.k, p_date) sc) x
    left join lateral (select case when a.rubric_achievements between 1 and 5 and a.rubric_achievements = trunc(a.rubric_achievements)
                                   then a.rubric_achievements::int end rt
                         from public.interview_assignments a
                        where a.application_id = vp.application_id and a.attempt_no = coalesce(vp.attempt_no, 1)
                        order by a.created_at desc limit 1) ia on true
   where am.exam_date_id = p_date
     and c.k in ('pune', 'gurugram') and (p_campus is null or c.k = p_campus)
     and vp.stage in ('pi_cleared', 'counselling_scheduled', 'counselled', 'counselling_not_appeared',
                      'offer_sent', 'enrolled', 'offer_lapsed', 'offer_cancelled')
     and x.sc is not null
$$;
revoke all on function public.vsat__bucket_pop(uuid, text) from public, anon, authenticated;

-- category of a score under a set: lower edge included, category 1 includes 100 (as vsat_calc_scholarship)
create or replace function public.vsat__bucket_cat(p_score numeric, p_bands jsonb)
returns int language sql stable set search_path to '' as $$
  select (b->>'category')::int from jsonb_array_elements(p_bands) b
   where p_score >= (b->>'min_score')::numeric
     and (p_score < (b->>'max_score')::numeric or ((b->>'category')::int = 1 and p_score <= (b->>'max_score')::numeric))
   order by (b->>'category')::int limit 1
$$;
revoke all on function public.vsat__bucket_cat(numeric, jsonb) from public, anon, authenticated;

-- final % under a set: the bucket step (vsat_calc_auto_step), the higher of it and the JEE floor (if the campus uses it),
-- +10 when achievements = 5 and that is 30 % or less, at most 100 (as vsat_calc_final_scholarship)
create or replace function public.vsat__bucket_pct(p_score numeric, p_bands jsonb, p_jee_floor numeric, p_rating int, p_floor_on boolean)
returns numeric language sql stable set search_path to '' as $$
  select least(100, z.m + case when p_rating = 5 and z.m <= 30 then 10 else 0 end)
    from (select greatest(coalesce((select public.vsat_calc_auto_step(p_score, (b->>'min_score')::numeric, (b->>'max_score')::numeric,
                                                                     (b->>'steps')::int, (b->>'min_award')::numeric, (b->>'max_award')::numeric)
                                      from jsonb_array_elements(p_bands) b
                                     where (b->>'category')::int = public.vsat__bucket_cat(p_score, p_bands)), 0),
                          case when p_floor_on then coalesce(p_jee_floor, 0) else 0 end) m) z
$$;
revoke all on function public.vsat__bucket_pct(numeric, jsonb, numeric, int, boolean) from public, anon, authenticated;

create or replace function public.vsat__bucket_arpu(p_date uuid, p_campus text, p_bands jsonb)
returns jsonb language sql stable security definer set search_path to '' as $$
  with pop as materialized (select * from public.vsat__bucket_pop(p_date, p_campus)),
  r as materialized (
    select pop.fee, public.vsat__bucket_cat(pop.score, p_bands) cat,
           public.vsat__bucket_pct(pop.score, p_bands, pop.jee_floor, pop.rating,
                                   coalesce((select c.jee_floor_enabled from public.vsat_campus_settings c where c.campus = p_campus), false)) pct
      from pop)
  select jsonb_build_object(
    'campus', p_campus, 'students', (select count(*) from r),
    'arpu', (select round(avg(r.fee * (1 - r.pct / 100))) from r),
    'avg_pct', (select round(avg(r.pct), 2) from r),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('category', q.cat, 'students', q.n, 'avg_pct', q.a) order by q.cat nulls last)
                              from (select r.cat, count(*) n, round(avg(r.pct), 2) a from r group by r.cat) q), '[]'::jsonb))
$$;
revoke all on function public.vsat__bucket_arpu(uuid, text, jsonb) from public, anon, authenticated;

-- private: who is asking — admin (edit) or admissions (view, campus scope)
create or replace function public.vsat__bucket_viewer(out is_admin boolean, out campuses text[])
language plpgsql stable security definer set search_path to '' as $$
declare uid uuid := auth.uid(); f_adm boolean; f_all boolean; own text[];
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  is_admin := coalesce(public.is_admin(), false);
  if is_admin then campuses := array['pune', 'gurugram']; return; end if;
  select bool_or(true), bool_or(t.campus is null), array_agg(t.campus) filter (where t.campus is not null)
    into f_adm, f_all, own from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active;
  if not coalesce(f_adm, false) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  campuses := case when coalesce(f_all, false) then array['pune', 'gurugram'] else array(select x from unnest(own) x where x in ('pune', 'gurugram')) end;
end $$;
revoke all on function public.vsat__bucket_viewer() from public, anon, authenticated;

create or replace function public.vsat__bucket_args(p jsonb, p_keys text[], out v_date uuid, out v_campus text)
language plpgsql stable security definer set search_path to '' as $$
begin
  perform public.vsat__check_keys(p, p_keys);
  begin v_date := (p->>'exam_date_id')::uuid; exception when others then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end;
  if v_date is null or not exists (select 1 from public.vsat_exam_dates d where d.id = v_date) then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end if;
  if 'campus' = any(p_keys) then
    v_campus := p->>'campus';
    if v_campus is null or v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  end if;
end $$;
revoke all on function public.vsat__bucket_args(jsonb, text[]) from public, anon, authenticated;

-- ── vsat_buckets_get: the page ──────────────────────────────────────────────
create or replace function public.vsat_buckets_get(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare me record; v_date uuid; c text; cs jsonb := '[]'::jsonb; cur jsonb; bs public.vsat_bucket_sets; n_all numeric := 0; sum_rev numeric := 0;
begin
  select * into me from public.vsat__bucket_viewer();
  p := coalesce(p, '{}'::jsonb);
  perform public.vsat__check_keys(p, array['exam_date_id']);
  if p->>'exam_date_id' is not null then select x.v_date into v_date from public.vsat__bucket_args(p, array['exam_date_id']) x; end if;

  if v_date is not null then
    foreach c in array array['pune', 'gurugram'] loop
      continue when not (c = any(me.campuses));
      cur := public.vsat__bucket_arpu(v_date, c, public.vsat__bands_in_use(c, v_date));
      select * into bs from public.vsat_bucket_sets s where s.exam_date_id = v_date and s.campus = c;
      cs := cs || jsonb_build_object(
        'campus', c,
        'fee', (select x.programme_fee from public.vsat_campus_settings x where x.campus = c),
        'own', exists (select 1 from public.vsat_scholarship_bands b where b.campus = c and b.exam_date_id = v_date),
        'bands', public.vsat__bands_in_use(c, v_date),
        'default_bands', public.vsat__bands_in_use(c, null),
        'arpu_target', bs.arpu_target,
        'locked_at', bs.locked_at,
        'locked_by', (select coalesce(pr.full_name, pr.email) from public.profiles pr where pr.id = bs.locked_by),
        'current', cur);
      if (cur->>'students')::int > 0 then
        n_all := n_all + (cur->>'students')::int; sum_rev := sum_rev + (cur->>'students')::int * (cur->>'arpu')::numeric;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'can_edit', me.is_admin,
    'vsats', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'exam_date', d.exam_date) order by d.exam_date desc nulls last, d.label)
                         from public.vsat_exam_dates d), '[]'::jsonb),
    'exam_date_id', v_date,
    'campuses', cs,
    'overall', case when v_date is null then null
                    else jsonb_build_object('students', n_all, 'arpu', case when n_all > 0 then round(sum_rev / n_all) end) end);
end $$;

-- ── vsat_buckets_preview: ARPU of a draft (nothing saved) ───────────────────
create or replace function public.vsat_buckets_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare me record; a record;
begin
  select * into me from public.vsat__bucket_viewer();
  if not me.is_admin then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into a from public.vsat__bucket_args(p, array['exam_date_id', 'campus', 'bands']);
  return public.vsat__bucket_arpu(a.v_date, a.v_campus, public.vsat__bands_check(p->'bands', false));
end $$;

-- ── vsat_buckets_suggest: 5-point shifts of every award range, the most scholarship that still meets the target ──
create or replace function public.vsat_buckets_suggest(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare me record; a record; v_target numeric; base jsonb; floor_on boolean; best record; cur jsonb;
begin
  select * into me from public.vsat__bucket_viewer();
  if not me.is_admin then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into a from public.vsat__bucket_args(p, array['exam_date_id', 'campus', 'arpu_target', 'bands']);
  v_target := public.vsat__num(p, 'arpu_target', 0, 100000000, true);
  -- start from the draft on screen (if sent), else the set in use
  base := case when p ? 'bands' then public.vsat__bands_check(p->'bands', false) else public.vsat__bands_in_use(a.v_campus, a.v_date) end;
  floor_on := coalesce((select c.jee_floor_enabled from public.vsat_campus_settings c where c.campus = a.v_campus), false);

  with pop as materialized (select * from public.vsat__bucket_pop(a.v_date, a.v_campus)),
  sets as (
    select d.d, jsonb_agg(jsonb_build_object('category', (b->>'category')::int, 'min_score', (b->>'min_score')::numeric,
             'max_score', (b->>'max_score')::numeric, 'steps', (b->>'steps')::int,
             'min_award', least(greatest((b->>'min_award')::numeric + d.d, 0), 100 - ((b->>'max_award')::numeric - (b->>'min_award')::numeric)),
             'max_award', least(greatest((b->>'min_award')::numeric + d.d, 0), 100 - ((b->>'max_award')::numeric - (b->>'min_award')::numeric))
                          + ((b->>'max_award')::numeric - (b->>'min_award')::numeric))
             order by (b->>'category')::int) bands
      from generate_series(-100, 100, 5) d(d) cross join jsonb_array_elements(base) b
     group by d.d),
  scored as (
    select s.d, s.bands, round(avg(pop.fee * (1 - public.vsat__bucket_pct(pop.score, s.bands, pop.jee_floor, pop.rating, floor_on) / 100))) arpu
      from sets s cross join pop group by s.d, s.bands)
  select * into best from (
    -- meets the target with the most scholarship (lowest ARPU at or above it); else the highest ARPU possible
    (select sc.d, sc.bands, sc.arpu, true reached from scored sc where sc.arpu >= v_target order by sc.arpu, abs(sc.d) limit 1)
    union all
    (select sc.d, sc.bands, sc.arpu, false from scored sc order by sc.arpu desc, abs(sc.d) limit 1)
  ) z order by z.reached desc limit 1;

  cur := public.vsat__bucket_arpu(a.v_date, a.v_campus, base);
  if best.d is null then
    return jsonb_build_object('reached', false, 'shift', 0, 'bands', base, 'arpu', cur->'arpu', 'current', cur, 'arpu_target', v_target);
  end if;
  return jsonb_build_object('reached', best.reached, 'shift', best.d, 'bands', best.bands, 'arpu_target', v_target,
                            'suggested', public.vsat__bucket_arpu(a.v_date, a.v_campus, best.bands), 'current', cur);
end $$;

-- ── vsat_buckets_save: the VSAT's own buckets + ARPU target ─────────────────
create or replace function public.vsat_buckets_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare me record; a record; v_target numeric; old_target numeric;
begin
  select * into me from public.vsat__bucket_viewer();
  if not me.is_admin then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into a from public.vsat__bucket_args(p, array['exam_date_id', 'campus', 'bands', 'arpu_target']);
  v_target := public.vsat__num(p, 'arpu_target', 0, 100000000, false);
  if jsonb_typeof(p->'bands') is distinct from 'array' or jsonb_array_length(p->'bands') = 0 then raise exception 'BAD_VALUE: bands' using errcode = '22023'; end if;
  -- sir's 5-points-per-bucket rule is checked for the Buckets page; the other rules, the lock and the settings audit
  -- live in vsat_settings_bands_set (the Scholarship & Scoring page keeps 0098's rules)
  perform public.vsat__bands_check(p->'bands', true);
  perform public.vsat_settings_bands_set(jsonb_build_object('exam_date_id', a.v_date, 'campus', a.v_campus, 'bands', p->'bands'));
  select s.arpu_target into old_target from public.vsat_bucket_sets s where s.exam_date_id = a.v_date and s.campus = a.v_campus;
  insert into public.vsat_bucket_sets as s (exam_date_id, campus, arpu_target, updated_at, updated_by)
  values (a.v_date, a.v_campus, v_target, now(), auth.uid())
  on conflict (exam_date_id, campus) do update set arpu_target = excluded.arpu_target, updated_at = now(), updated_by = auth.uid();
  if old_target is distinct from v_target then
    perform public.vsat__settings_log('bands', 'arpu_target:' || a.v_campus || ':' || a.v_date::text,
                                      jsonb_build_object('arpu_target', old_target), jsonb_build_object('arpu_target', v_target));
  end if;
  return jsonb_build_object('ok', true, 'current', public.vsat__bucket_arpu(a.v_date, a.v_campus, public.vsat__bands_in_use(a.v_campus, a.v_date)));
end $$;

-- ── vsat_buckets_lock: lock / unlock a VSAT's buckets for a campus ─────────
create or replace function public.vsat_buckets_lock(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare me record; a record; v_lock boolean; v_reason text; bs public.vsat_bucket_sets;
begin
  select * into me from public.vsat__bucket_viewer();
  if not me.is_admin then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into a from public.vsat__bucket_args(p, array['exam_date_id', 'campus', 'locked', 'reason']);
  v_lock := public.vsat__bool(p, 'locked', true);
  v_reason := public.vsat__txt(p, 'reason', 500, false);
  select * into bs from public.vsat_bucket_sets s where s.exam_date_id = a.v_date and s.campus = a.v_campus for update;

  if v_lock then
    if bs.locked_at is not null then raise exception 'ALREADY_LOCKED' using errcode = '22023'; end if;
    -- a locked VSAT keeps its own copy, so later changes to the default do not touch it (copied as it is: locking
    -- freezes what is in use, it does not re-check the set)
    if not exists (select 1 from public.vsat_scholarship_bands b where b.campus = a.v_campus and b.exam_date_id = a.v_date) then
      insert into public.vsat_scholarship_bands (exam_date_id, campus, category, min_score, max_score, steps, min_award, max_award)
      select a.v_date, d.campus, d.category, d.min_score, d.max_score, d.steps, d.min_award, d.max_award
        from public.vsat_scholarship_bands d where d.campus = a.v_campus and d.exam_date_id is null;
      perform public.vsat__settings_log('bands', a.v_campus || ':' || a.v_date::text, '[]'::jsonb, public.vsat__bands_in_use(a.v_campus, a.v_date));
    end if;
    insert into public.vsat_bucket_sets as s (exam_date_id, campus, locked_at, locked_by, updated_at, updated_by)
    values (a.v_date, a.v_campus, now(), auth.uid(), now(), auth.uid())
    on conflict (exam_date_id, campus) do update set locked_at = now(), locked_by = auth.uid(), updated_at = now(), updated_by = auth.uid();
    perform public.vsat__settings_log('bands', 'lock:' || a.v_campus || ':' || a.v_date::text, jsonb_build_object('locked', false),
                                      jsonb_build_object('locked', true, 'reason', v_reason));
  else
    if bs.locked_at is null then raise exception 'NOT_LOCKED' using errcode = '22023'; end if;
    if v_reason is null or char_length(v_reason) < 3 then raise exception 'BAD_VALUE: reason' using errcode = '22023'; end if;
    update public.vsat_bucket_sets s set locked_at = null, locked_by = null, updated_at = now(), updated_by = auth.uid()
     where s.exam_date_id = a.v_date and s.campus = a.v_campus;
    perform public.vsat__settings_log('bands', 'lock:' || a.v_campus || ':' || a.v_date::text,
                                      jsonb_build_object('locked', true, 'locked_at', bs.locked_at, 'locked_by', bs.locked_by),
                                      jsonb_build_object('locked', false, 'reason', v_reason));
  end if;
  return jsonb_build_object('ok', true, 'locked', v_lock);
end $$;

-- ── grants: browsers call the five page functions only ─────────────────────
do $g$ declare f text; begin
  foreach f in array array['public.vsat_buckets_get(jsonb)', 'public.vsat_buckets_preview(jsonb)', 'public.vsat_buckets_suggest(jsonb)',
                           'public.vsat_buckets_save(jsonb)', 'public.vsat_buckets_lock(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;
