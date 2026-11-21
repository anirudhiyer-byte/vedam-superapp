-- 0135 · VSAT Phase 1 — exam results, VPS from the curve, proctoring (DQ), VSAT analysis, Select for PI.
--
-- What changes (staging first; production only with the owner's OK):
--
--  1. Eligibility. vsat_calc_eligibility gets a 7-argument form that also takes the 12th overall %
--     (rule key class12_min_overall; absent = off, unknown % = not checked). The 6-argument form stays
--     as a thin wrapper that passes no %, so it answers exactly as before. Settings: 10th must be
--     2024–2025 (was 2023–2025) and 12th overall ≥ 50%.
--  2. One calculation, used everywhere. Private helpers vsat__elig / vsat__vps_calculated /
--     vsat__override_of / vsat__exam_pct / vsat__section_marks / vsat__proctoring_of.
--     VPS (calculated) = the stored vps_score when one exists (imported / frozen), else the VSAT's
--     curve applied to exam_percentile (per-VSAT anchors, else the Exam Center default). An admin
--     override still wins. vsat__effective now reports where the number came from ('stored' | 'curve').
--  3. Grid. New virtual columns: vps_calculated, exam_percentage, exam_section_maths / _lr / _cs
--     (from exam_sections, Wheebox names matched loosely), proctoring, class12_result,
--     class10_eligible, class12_eligible. The advanced filter accepts these and vps_effective /
--     eligible_effective (expressions come from vsat__grid_virt_expr — a fixed list, never the
--     request). vsat_grid_columns says which columns are filterable. The old sheet's per-attempt
--     copies (vsat_*_1/_2, vps_score_1/_2) move to their own group "Old sheet (per attempt)".
--  4. Proctoring. vsat_proctoring (one verdict per application + attempt: disqualified | cleared)
--     + vsat_proctoring_log. vsat_set_proctoring_bulk — admin / admissions (campus-checked per row);
--     a reason is needed to disqualify and to change or remove an existing verdict.
--  5. vsat_exam_analysis — the sheet's analysis box for one or more VSATs (admin / admissions,
--     campus-limited like the grid): takers, average %, > 70, non-DQ percentile slabs, non-DQ gender
--     split, and at a chosen percentile the non-DQ count by campus × gender.
--  6. vsat_select_for_pi — admin only. Preview (default) or apply. Selected = has a result, not
--     disqualified, percentile ≥ the cut-off, active, before "VSAT cleared", not marked ineligible.
--     Apply moves each one to vsat_cleared through vsat__move_checked (history + reason) and records
--     the VPS at that percentile as the VSAT's cleared_vps_cutoff (settings audit).
--
-- Security: every new table has RLS on, no policies and no grants for browsers; every new function is
-- SECURITY DEFINER (RPCs) or private, with search_path ''. RPCs: revoked from public / anon, granted to
-- authenticated; helpers: revoked from public / anon / authenticated.
-- Rollback: supabase/rollback/0135_vsat_exam_results_pi_down.sql

-- ═════════════ 1. eligibility ═════════════

create or replace function public.vsat_calc_eligibility(p_year10 integer, p_year12 integer, p_physics numeric, p_chemistry numeric, p_maths numeric, p_class12_pct numeric, p_rules jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $function$
declare
  r jsonb := coalesce(p_rules, '{}'::jsonb); total numeric; c12 text; e10 boolean; e12 boolean;
  v_each numeric := coalesce((r->>'pcm_min_each')::numeric, 0);   -- per-subject floor; 0 = off
  v_overall numeric := (r->>'class12_min_overall')::numeric;      -- 12th overall % floor; null = off
  v_each_ok boolean; v_overall_ok boolean;
begin
  total := coalesce(p_physics, 0) + coalesce(p_chemistry, 0) + coalesce(p_maths, 0);
  v_each_ok := coalesce(p_physics, 0) >= v_each and coalesce(p_chemistry, 0) >= v_each and coalesce(p_maths, 0) >= v_each;
  -- an unknown overall % is not held against the student (the PCM rule still applies)
  v_overall_ok := v_overall is null or p_class12_pct is null or p_class12_pct >= v_overall;
  if p_year12 is not null and p_year12 = (r->>'pending_year')::int and total = 0 then c12 := 'yet_to_graduate';
  elsif p_year12 is not null and to_jsonb(p_year12) <@ coalesce(r->'class12_years', '[]'::jsonb)
        and total >= coalesce((r->>'pcm_min_total')::numeric, 150)
        and v_each_ok and v_overall_ok then c12 := 'pass';
  else c12 := 'fail';
  end if;
  e10 := p_year10 is not null and p_year10 >= coalesce((r->>'min_year10')::int, 2023)
         and p_year10 <= coalesce((r->>'max_year10')::int, 2025);
  e12 := p_year12 is not null and c12 <> 'fail'
         and p_year12 >= coalesce((select min(y::int) from jsonb_array_elements_text(r->'class12_years') y), 2025);
  return jsonb_build_object('class12', c12, 'class10_ok', e10, 'class12_ok', e12, 'eligible', e10 and e12, 'pcm_total', total);
end $function$;

-- the old 6-argument form: same answers as before (no overall % → that rule is not checked)
create or replace function public.vsat_calc_eligibility(p_year10 integer, p_year12 integer, p_physics numeric, p_chemistry numeric, p_maths numeric, p_rules jsonb)
returns jsonb language sql immutable set search_path to '' as $function$
  select public.vsat_calc_eligibility(p_year10, p_year12, p_physics, p_chemistry, p_maths, null::numeric, p_rules)
$function$;

revoke all on function public.vsat_calc_eligibility(integer, integer, numeric, numeric, numeric, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.vsat_calc_eligibility(integer, integer, numeric, numeric, numeric, jsonb) from public, anon, authenticated;

-- policy for this cycle: 10th 2024–2025 (12th 2026 / 2027) and 12th overall ≥ 50%; everything else unchanged
update public.vsat_exam_settings
   set eligibility = eligibility || jsonb_build_object('min_year10', 2024, 'class12_min_overall', 50),
       updated_at = now(), updated_by = 'migration 0135'
 where id = 1;

-- ═════════════ 2. one calculation, used everywhere (private helpers) ═════════════

create table public.vsat_proctoring (
  application_id text not null references public.application_manager (application_id) on delete cascade,
  attempt_no integer not null check (attempt_no between 1 and 2),
  verdict text not null check (verdict in ('disqualified', 'cleared')),
  reason text check (reason is null or char_length(reason) <= 500),
  set_by uuid,
  set_at timestamptz not null default now(),
  primary key (application_id, attempt_no)
);
create table public.vsat_proctoring_log (
  id bigint generated always as identity primary key,
  application_id text not null,
  attempt_no integer not null,
  from_verdict text,
  to_verdict text,
  reason text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index vsat_proctoring_log_app_idx on public.vsat_proctoring_log (application_id, created_at desc);
alter table public.vsat_proctoring enable row level security;
alter table public.vsat_proctoring_log enable row level security;
revoke all on table public.vsat_proctoring, public.vsat_proctoring_log from public, anon, authenticated;
revoke all on sequence public.vsat_proctoring_log_id_seq from public, anon, authenticated;
comment on table public.vsat_proctoring is 'VSAT proctoring verdict per application + attempt (disqualified | cleared). Written only by vsat_set_proctoring_bulk.';
comment on table public.vsat_proctoring_log is 'Every proctoring verdict change: who, when, from → to, reason.';

-- eligibility of one student under the current rules (vsat_exam_settings.eligibility)
create or replace function public.vsat__elig(p_year10 integer, p_year12 integer, p_physics numeric, p_chemistry numeric, p_maths numeric, p_class12_pct numeric)
returns jsonb language sql stable set search_path to '' as $function$
  select public.vsat_calc_eligibility(p_year10, p_year12, p_physics, p_chemistry, p_maths, p_class12_pct,
           (select s.eligibility from public.vsat_exam_settings s order by s.id limit 1))
$function$;

-- calculated VPS: a stored vps_score wins (imported / frozen); else the VSAT's curve (else the default curve) on the percentile
create or replace function public.vsat__vps_calculated(p_stored numeric, p_percentile numeric, p_exam_date_id uuid)
returns numeric language sql stable set search_path to '' as $function$
  select coalesce(p_stored, case when p_percentile is not null then public.vsat_calc_vps(p_percentile, coalesce(
           (select d.vps_anchors from public.vsat_exam_dates d where d.id = p_exam_date_id),
           (select s.vps_anchors from public.vsat_exam_settings s order by s.id limit 1))) end)
$function$;

create or replace function public.vsat__override_of(p_app text, p_field text)
returns jsonb language sql stable set search_path to '' as $function$
  select o.value from public.vsat_overrides o where o.application_id = p_app and o.field = p_field and o.cleared_at is null
$function$;

create or replace function public.vsat__exam_pct(p_obtained numeric, p_max numeric)
returns numeric language sql immutable set search_path to '' as $function$
  select case when p_max > 0 and p_obtained is not null then round(p_obtained / p_max * 100, 2) end
$function$;

-- one section's marks from exam_sections ({name: marks}); Wheebox names are matched loosely:
--   maths = "Maths VSAT" / "Quantitative Aptitude" · lr = "Logical Reasoning" / "Logical and Aptitude" · cs = "CS" / "Computer Science"
create or replace function public.vsat__section_marks(p_sections jsonb, p_which text)
returns numeric language sql immutable set search_path to '' as $function$
  select x.n from (
    select e.key,
           case
             when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric
             when jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(e.value #>> '{}')::numeric
             when jsonb_typeof(e.value) = 'object'
                  and btrim(coalesce(e.value->>'markObtainInSection', e.value->>'marks', e.value->>'score', '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
               then btrim(coalesce(e.value->>'markObtainInSection', e.value->>'marks', e.value->>'score'))::numeric
           end n
      from jsonb_each(case when jsonb_typeof(p_sections) = 'object' then p_sections else '{}'::jsonb end) e
     where case p_which
             when 'maths' then lower(e.key) ~ '(math|quant)'
             when 'lr'    then lower(e.key) ~ '(logic|reason|aptitude)' and lower(e.key) !~ '(math|quant)'
             when 'cs'    then lower(e.key) ~ '(computer|\mcs\M|learnab|coding|program)'
             else false end
  ) x
  where x.n is not null
  order by x.key
  limit 1
$function$;

create or replace function public.vsat__proctoring_of(p_app text)
returns text language sql stable set search_path to '' as $function$
  select pr.verdict from public.vsat_proctoring pr
    join public.vsat_pipeline vp on vp.application_id = pr.application_id and vp.attempt_no = pr.attempt_no
   where pr.application_id = p_app
$function$;

-- SQL for the virtual columns the filter builder accepts (row alias "am" = application_manager). Fixed text only.
create or replace function public.vsat__grid_virt_expr(p_key text)
returns text language sql immutable set search_path to '' as $function$
  with a(el, vps) as (select
    'public.vsat__elig(am.class10_year, am.class12_year, am.marks_physics_12, am.marks_chemistry_12, am.marks_maths_12, am.class12_percentage)'::text,
    'public.vsat__vps_calculated(am.vps_score, am.exam_percentile, am.exam_date_id)'::text)
  select case p_key
    when 'vps_calculated'     then a.vps
    when 'vps_effective'      then 'coalesce((public.vsat__override_of(am.application_id, ''vps'') #>> ''{}'')::numeric, ' || a.vps || ')'
    when 'eligible_effective' then 'coalesce((public.vsat__override_of(am.application_id, ''eligible'') #>> ''{}'')::boolean, (' || a.el || ' ->> ''eligible'')::boolean)'
    when 'class12_result'     then '(' || a.el || ' ->> ''class12'')'
    when 'class10_eligible'   then '(' || a.el || ' ->> ''class10_ok'')::boolean'
    when 'class12_eligible'   then '(' || a.el || ' ->> ''class12_ok'')::boolean'
    when 'exam_percentage'    then 'public.vsat__exam_pct(am.exam_obtained_marks, am.exam_max_marks)'
    when 'exam_section_maths' then 'public.vsat__section_marks(am.exam_sections, ''maths'')'
    when 'exam_section_lr'    then 'public.vsat__section_marks(am.exam_sections, ''lr'')'
    when 'exam_section_cs'    then 'public.vsat__section_marks(am.exam_sections, ''cs'')'
    when 'proctoring'         then 'public.vsat__proctoring_of(am.application_id)'
  end
  from a
$function$;

revoke all on function public.vsat__elig(integer, integer, numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.vsat__vps_calculated(numeric, numeric, uuid) from public, anon, authenticated;
revoke all on function public.vsat__override_of(text, text) from public, anon, authenticated;
revoke all on function public.vsat__exam_pct(numeric, numeric) from public, anon, authenticated;
revoke all on function public.vsat__section_marks(jsonb, text) from public, anon, authenticated;
revoke all on function public.vsat__proctoring_of(text) from public, anon, authenticated;
revoke all on function public.vsat__grid_virt_expr(text) from public, anon, authenticated;

-- effective VPS / eligibility (same shape as before + vps.source and vps.percentile)
create or replace function public.vsat__effective(p_app text)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare am public.application_manager; el jsonb; calc numeric; ov_vps jsonb; ov_el jsonb;
begin
  select * into am from public.application_manager where application_id = p_app;
  if not found then return null; end if;
  el := public.vsat__elig(am.class10_year, am.class12_year, am.marks_physics_12, am.marks_chemistry_12, am.marks_maths_12, am.class12_percentage);
  calc := public.vsat__vps_calculated(am.vps_score, am.exam_percentile, am.exam_date_id);
  ov_vps := public.vsat__override_of(p_app, 'vps');
  ov_el  := public.vsat__override_of(p_app, 'eligible');
  return jsonb_build_object(
    'vps',      jsonb_build_object('calculated', calc, 'source', case when am.vps_score is not null then 'stored' when calc is not null then 'curve' end,
                                   'percentile', am.exam_percentile, 'override', ov_vps, 'value', coalesce(ov_vps, to_jsonb(calc))),
    'eligible', jsonb_build_object('calculated', el->'eligible', 'detail', el, 'override', ov_el, 'value', coalesce(ov_el, el->'eligible')));
end $function$;

-- ═════════════ 3. grid: catalogue, columns, engine ═════════════

-- catalogue: the new virtual columns; the old sheet's per-attempt copies get their own group
CREATE OR REPLACE FUNCTION public.vsat__grid_catalog()
 RETURNS TABLE(key text, grp text, typ text, sens text, virt boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with real_cols as (
    select a.attname::text as key, a.atttypid::regtype::text as pgtype, a.attnum
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.application_manager'::regclass and a.attnum > 0 and not a.attisdropped
  ), virt as (
    select * from (values
      ('stage',                      'Pipeline',    'stage',  10), ('status',               'Pipeline',    'status', 11),
      ('stage_changed_at',           'Pipeline',    'ts',     12), ('attempt_no',           'Pipeline',    'num',    13),
      ('campus',                     'Pipeline',    'text',   14), ('early_registration',   'Pipeline',    'bool',   15),
      ('vsat',                       'Exam',        'text',   16),
      ('vps_effective',              'Exam',        'num',    17), ('vps_override',         'Exam',        'num',    18),
      ('eligible_effective',         'Exam',        'bool',   19), ('eligible_override',    'Exam',        'bool',   20),
      ('vps_calculated',             'Exam',        'num',    36), ('exam_percentage',      'Exam',        'num',    37),
      ('exam_section_maths',         'Exam',        'num',    38), ('exam_section_lr',      'Exam',        'num',    39),
      ('exam_section_cs',            'Exam',        'num',    40), ('proctoring',           'Exam',        'text',   41),
      ('class12_result',             'Academics',   'text',   42), ('class10_eligible',     'Academics',   'bool',   43),
      ('class12_eligible',           'Academics',   'bool',   44),
      ('interviewer',                'Interview',   'text',   21), ('interview_slot',       'Interview',   'ts',     22),
      ('interview_attendance',       'Interview',   'text',   23), ('interview_score',      'Interview',   'num',    24),
      ('interview_calc_verdict',     'Interview',   'text',   25), ('interviewer_verdict',  'Interview',   'text',   26),
      ('cheating_seen',              'Interview',   'bool',   27),
      ('counsellor',                 'Counselling', 'text',   30), ('counselling_slot',     'Counselling', 'ts',     31),
      ('counselling_attendance',     'Counselling', 'text',   32), ('counselling_category', 'Counselling', 'num',    33),
      ('counselling_pct',            'Counselling', 'num',    34), ('counselling_calculated_pct', 'Counselling', 'num', 35)
    ) v(key, grp, typ, ord)
  )
  select v.key, v.grp, v.typ, 'open'::text, true from virt v
  union all
  select c.key,
         case
           -- the old sheet's per-attempt copies (vsat_*_1/_2, vps_score_1/_2): kept for history, out of the Exam group
           when c.key ~ '^(vsat_(score_(lr|maths|cs)|total|percentile|result|attempt_date|appeared|slot_datetime|campaign_id)|vps_score)_[12]$' then 'Old sheet (per attempt)'
           when c.key like '%utm%'                                                        then 'Marketing'
           when c.key like 'payment%' or c.key in ('application_fee_amount', 'currency', 'order_id', 'transaction_id', 'cash_receipt_date')
                or c.key like 'discount%' or c.key like 'seat_booking%' or c.key like 'enrollment%'   then 'Payment'
           when c.key like 'offer%'                                                       then 'Offer'
           when c.key like 'counselling%' or c.key like 'scholarship%'                    then 'Counselling'
           when c.key like 'interview%'                                                   then 'Interview'
           when c.key like 'vsat%' or c.key like 'vps%' or c.key like 'wheebox%' or c.key like 'exam%' or c.key like 'mock%'
                or c.key like '%card_download_date'                                        then 'Exam'
           when c.key like '%verification%' or c.key like '%\_url' or c.key = 'selected_id_type' then 'Documents'
           when c.key like 'father%' or c.key like 'mother%' or c.key like 'guardian%' or c.key = 'family_income' then 'Parents'
           when c.key like 'coding%' or c.key = 'taken_coding_exam'                       then 'Coding exams'
           when c.key like 'olympiad%' or c.key = 'participated_olympiad'                 then 'Olympiads'
           when c.key like 'jee%' or c.key like 'entrance%'                               then 'JEE & entrance'
           when c.key like 'class1%' or c.key like 'marks\_%' or c.key in ('studied_pcm', 'studied_cs', 'cs_experience', 'pcm_eligible') then 'Academics'
           when c.key in ('registered_name', 'registered_email', 'registered_mobile', 'gender', 'date_of_birth', 'residing_city',
                          'country', 'state', 'city', 'campus_applied', 'program', 'partner_university', 'current_education_level',
                          'class_12_stream', 'preferred_engineering_specialization', 'hostel_selection', 'campus_tour_date', 'campus_tour_time') then 'Personal'
           else 'Application' end,
         case c.pgtype
           when 'numeric' then 'num' when 'integer' then 'num' when 'bigint' then 'num' when 'boolean' then 'bool'
           when 'date' then 'date' when 'timestamp with time zone' then 'ts' when 'jsonb' then 'json' when 'uuid' then 'uuid'
           else 'text' end,
         case
           when c.pgtype in ('jsonb', 'uuid') or c.key in ('application_id')                      then 'hidden'
           when c.key like '%\_url'                                                               then 'doc'
           when c.key ~ '(mobile|phone|email|contact|whatsapp)' or c.key = 'wheebox_login_id'      then 'contact'
           when c.key ~ '(payment|amount|order_id|txn|transaction|income|coupon|receipt|discount|currency|seat_booking)' then 'finance'
           else 'open' end,
         false
    from real_cols c
   where c.key not in (select key from virt)
   order by 5 desc, 1
$function$;

-- the column list tells the panel which columns the filter builder may offer
CREATE OR REPLACE FUNCTION public.vsat_grid_columns()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare mgr boolean;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__any_role() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  mgr := public.vsat__can_manage(null);
  return jsonb_build_object('can_manage', mgr, 'columns', coalesce((
    select jsonb_agg(jsonb_build_object('key', c.key, 'group', c.grp, 'type', c.typ, 'virtual', c.virt, 'restricted', c.sens <> 'open',
             'filterable', case when c.virt then public.vsat__grid_virt_expr(c.key) is not null else c.typ in ('num', 'date', 'ts', 'text', 'bool') end))
      from public.vsat__grid_catalog() c where public.vsat__grid_may_see(c.sens, mgr)), '[]'::jsonb));
end $function$;

-- engine: virtual-column filters (fixed expressions), the new columns on each row
CREATE OR REPLACE FUNCTION public.vsat__grid(p jsonb, p_max integer, p_facets boolean, p_manager_only boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid(); f_admin boolean; f_adm boolean; f_adm_all boolean; adm_campuses text[]; f_int boolean; f_cou boolean; mgr boolean;
  v_scope text[]; v_stages text[]; v_statuses text[]; v_dates uuid[]; v_campuses text[]; v_cols text[]; v_ids text[];
  v_form text[]; v_pay text[];
  f_ids text[]; has_filters boolean := false; fl jsonb; fcol text; fop text; ftyp text; fwhere text := ''; frag text; fsym text; farr text[]; fcat record; fsql text;
  fexpr text;
  v_limit int; v_offset int; k text; s text;
  s_col text; s_vals text[]; s_pat text[]; s_dig text[]; s_ids text[]; s_any boolean := false; s_cat record;
  need_eff boolean; total int; rows jsonb; facets jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb),
    array['scope', 'stages', 'statuses', 'exam_date_ids', 'campuses', 'form_stages', 'payment_stages', 'filters', 'search', 'columns', 'application_ids', 'limit', 'offset']);
  foreach k in array array['scope', 'stages', 'statuses', 'exam_date_ids', 'campuses', 'form_stages', 'payment_stages', 'filters', 'columns', 'application_ids'] loop
    if p ? k and jsonb_typeof(p->k) not in ('array', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;
  foreach k in array array['limit', 'offset'] loop
    if p ? k and jsonb_typeof(p->k) not in ('number', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;
  if p ? 'search' and jsonb_typeof(p->'search') not in ('object', 'null') then raise exception 'BAD_VALUE: search' using errcode = '22023'; end if;

  -- roles (same as vsat_pipeline_list)
  f_admin := coalesce(public.is_admin(), false);
  select bool_or(true), bool_or(t.campus is null), array_agg(t.campus) filter (where t.campus is not null)
    into f_adm, f_adm_all, adm_campuses
    from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active;
  f_adm := coalesce(f_adm, false); f_adm_all := coalesce(f_adm_all, false);
  f_int := exists (select 1 from public.vsat_team t where t.user_id = uid and t.role = 'interviewer' and t.active);
  f_cou := exists (select 1 from public.vsat_team t where t.user_id = uid and t.role = 'counsellor' and t.active);
  if not (f_admin or f_adm or f_int or f_cou) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  mgr := f_admin or f_adm;
  if p_manager_only and not mgr then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  -- dropdown filters
  select array_agg(x) into v_scope from jsonb_array_elements_text(coalesce(p->'scope', '[]'::jsonb)) x;
  select array_agg(x) into v_stages from jsonb_array_elements_text(coalesce(p->'stages', '[]'::jsonb)) x;
  select array_agg(x) into v_statuses from jsonb_array_elements_text(coalesce(p->'statuses', '[]'::jsonb)) x;
  select array_agg(x) into v_campuses from jsonb_array_elements_text(coalesce(p->'campuses', '[]'::jsonb)) x;
  if v_scope is not null then foreach s in array v_scope loop
    if public.vsat__stage_order(s) is null then raise exception 'BAD_STAGE' using errcode = '22023'; end if; end loop; end if;
  if v_stages is not null then foreach s in array v_stages loop
    if public.vsat__stage_order(s) is null then raise exception 'BAD_STAGE' using errcode = '22023'; end if; end loop; end if;
  if v_statuses is not null then foreach s in array v_statuses loop
    if s not in ('active', 'not_selected', 'absent', 'on_hold') then raise exception 'BAD_STATUS' using errcode = '22023'; end if; end loop; end if;
  if v_campuses is not null then foreach s in array v_campuses loop
    if s not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campuses' using errcode = '22023'; end if; end loop; end if;
  begin
    select array_agg(x::uuid) into v_dates from jsonb_array_elements_text(coalesce(p->'exam_date_ids', '[]'::jsonb)) x;
  exception when others then raise exception 'BAD_VALUE: exam_date_ids' using errcode = '22023'; end;
  if coalesce(array_length(v_scope, 1), 0) > 20 or coalesce(array_length(v_stages, 1), 0) > 20 or coalesce(array_length(v_dates, 1), 0) > 50 then
    raise exception 'BAD_VALUE: filters' using errcode = '22023';
  end if;

  -- form-stage / payment-stage dropdowns (enum columns on application_manager; values checked against the label set)
  select array_agg(x) into v_form from jsonb_array_elements_text(coalesce(p->'form_stages', '[]'::jsonb)) x;
  if v_form is not null then
    if coalesce(array_length(v_form, 1), 0) > 20 then raise exception 'BAD_VALUE: form_stages' using errcode = '22023'; end if;
    foreach s in array v_form loop
      if not (s = any(enum_range(null::public.vm_form_stage)::text[])) then raise exception 'BAD_VALUE: form_stages' using errcode = '22023'; end if;
    end loop;
  end if;
  select array_agg(x) into v_pay from jsonb_array_elements_text(coalesce(p->'payment_stages', '[]'::jsonb)) x;
  if v_pay is not null then
    if not mgr then raise exception 'FORBIDDEN_COLUMN: payment_stage_1' using errcode = '42501'; end if;
    if coalesce(array_length(v_pay, 1), 0) > 20 then raise exception 'BAD_VALUE: payment_stages' using errcode = '22023'; end if;
    foreach s in array v_pay loop
      if not (s = any(enum_range(null::public.vm_payment_stage)::text[])) then raise exception 'BAD_VALUE: payment_stages' using errcode = '22023'; end if;
    end loop;
  end if;

  -- advanced filter builder: AND-ed clauses on real columns and on the whitelisted virtual ones (0135: VPS, eligibility,
  -- exam %, sections, proctoring — their SQL comes from vsat__grid_virt_expr, never from the request) → a set of
  -- application_ids that narrows everything
  if p ? 'filters' and jsonb_typeof(p->'filters') = 'array' then
    if jsonb_array_length(p->'filters') > 20 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
    for fl in select value from jsonb_array_elements(p->'filters') loop
      if jsonb_typeof(fl) <> 'object' then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      perform public.vsat__check_keys(fl, array['column', 'op', 'v']);
      fcol := nullif(btrim(coalesce(fl->>'column', '')), '');
      fop  := nullif(btrim(coalesce(fl->>'op', '')), '');
      if fcol is null or fop is null then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      select * into fcat from public.vsat__grid_catalog() c where c.key = fcol;
      if not found then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      if fcat.virt then
        -- stage / status / VSAT / campus … keep their dropdowns: only virtual columns with a fixed expression are filterable
        fexpr := public.vsat__grid_virt_expr(fcol);
        if fexpr is null then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        fexpr := '(' || fexpr || ')';
      else
        fexpr := format('am.%I', fcol);
      end if;
      if not public.vsat__grid_may_see(fcat.sens, mgr) then raise exception 'FORBIDDEN_COLUMN: %', fcol using errcode = '42501'; end if;
      ftyp := fcat.typ;
      -- null / boolean predicates take no value
      if fop = 'isnull' then frag := format('%s is null', fexpr);
      elsif fop = 'notnull' then frag := format('%s is not null', fexpr);
      elsif ftyp = 'bool' and fop = 'true' then frag := format('%s::boolean is true', fexpr);
      elsif ftyp = 'bool' and fop = 'false' then frag := format('%s::boolean is false', fexpr);
      elsif fop = 'in' then
        if ftyp not in ('num', 'text') then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        if jsonb_typeof(fl->'v') <> 'array' then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        select array_agg(x) into farr from jsonb_array_elements_text(fl->'v') x where btrim(x) <> '';
        if farr is null or array_length(farr, 1) > 200 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        foreach s in array farr loop if char_length(s) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if; end loop;
        frag := case ftyp when 'num' then format('(%s)::numeric = any(%L::numeric[])', fexpr, farr::text)
                          else format('%s::text = any(%L::text[])', fexpr, farr::text) end;
      elsif fop = 'between' then
        if ftyp not in ('num', 'date', 'ts') then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        if jsonb_typeof(fl->'v') <> 'array' or jsonb_array_length(fl->'v') <> 2
           or btrim(coalesce(fl->'v'->>0, '')) = '' or btrim(coalesce(fl->'v'->>1, '')) = ''
           or char_length(fl->'v'->>0) > 100 or char_length(fl->'v'->>1) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        frag := case ftyp when 'num' then format('(%s)::numeric between %L::numeric and %L::numeric', fexpr, fl->'v'->>0, fl->'v'->>1)
                          else format('%s::date between %L::date and %L::date', fexpr, fl->'v'->>0, fl->'v'->>1) end;
      else
        -- single-value operators
        s := fl->>'v';
        if s is null or char_length(s) = 0 or char_length(s) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        fsym := case fop when 'eq' then '=' when 'ne' then '<>' when 'lt' then '<' when 'lte' then '<=' when 'gt' then '>' when 'gte' then '>='
                         when 'before' then '<' when 'after' then '>' else null end;
        if ftyp = 'num' and fop in ('eq', 'ne', 'lt', 'lte', 'gt', 'gte') then
          frag := format('(%s)::numeric %s %L::numeric', fexpr, fsym, s);
        elsif ftyp in ('date', 'ts') and fop in ('eq', 'before', 'after') then
          frag := format('%s::date %s %L::date', fexpr, case fop when 'eq' then '=' else fsym end, s);
        elsif ftyp = 'text' and fop = 'eq' then frag := format('%s::text = %L', fexpr, s);
        elsif ftyp = 'text' and fop = 'ne' then frag := format('%s::text is distinct from %L', fexpr, s);
        elsif ftyp = 'text' and fop = 'contains' then
          frag := format('lower(%s::text) like %L', fexpr, '%' || replace(replace(replace(lower(s), '\', '\\'), '%', '\%'), '_', '\_') || '%');
        else raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      end if;
      fwhere := fwhere || case when fwhere = '' then '' else ' and ' end || '(' || frag || ')';
    end loop;
    has_filters := true;
    fsql := 'select coalesce(array_agg(am.application_id), ''{}'') from public.application_manager am where ' || coalesce(nullif(fwhere, ''), 'true');
    begin
      execute fsql into f_ids;
    exception when others then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end;
    f_ids := coalesce(f_ids, '{}'::text[]);
  end if;

  -- explicit rows (the selection) — ids only, capped
  select array_agg(x) into v_ids from jsonb_array_elements_text(coalesce(p->'application_ids', '[]'::jsonb)) x where char_length(x) between 1 and 64;
  if coalesce(array_length(v_ids, 1), 0) > 5000 then raise exception 'BAD_VALUE: application_ids' using errcode = '22023'; end if;

  -- requested columns: each must exist in the catalogue and be allowed for this role
  select array_agg(distinct x) into v_cols from jsonb_array_elements_text(coalesce(p->'columns', '[]'::jsonb)) x;
  if coalesce(array_length(v_cols, 1), 0) > 150 then raise exception 'BAD_VALUE: columns' using errcode = '22023'; end if;
  if v_cols is not null then foreach s in array v_cols loop
    select * into s_cat from public.vsat__grid_catalog() c where c.key = s;
    if not found then raise exception 'BAD_VALUE: columns' using errcode = '22023'; end if;
    if not public.vsat__grid_may_see(s_cat.sens, mgr) then raise exception 'FORBIDDEN_COLUMN: %', s using errcode = '42501'; end if;
  end loop; end if;
  need_eff := coalesce(v_cols && array['vps_effective', 'vps_override', 'vps_calculated', 'eligible_effective', 'eligible_override',
                                        'class12_result', 'class10_eligible', 'class12_eligible'], false);

  -- multi-value search on one column ('_any' = name / app no, + email / mobile for managers)
  if p->'search' is not null and jsonb_typeof(p->'search') = 'object' then
    perform public.vsat__check_keys(p->'search', array['column', 'values']);
    s_col := nullif(btrim(coalesce(p->'search'->>'column', '')), '');
    if s_col is null then raise exception 'BAD_VALUE: column' using errcode = '22023'; end if;
    if jsonb_typeof(p->'search'->'values') <> 'array' then raise exception 'BAD_VALUE: values' using errcode = '22023'; end if;
    select array_agg(distinct btrim(x)) into s_vals from jsonb_array_elements_text(p->'search'->'values') x where btrim(x) <> '';
    if s_vals is null or array_length(s_vals, 1) > 200 then raise exception 'BAD_VALUE: values' using errcode = '22023'; end if;
    foreach s in array s_vals loop
      if char_length(s) < 2 or char_length(s) > 100 then raise exception 'BAD_VALUE: values' using errcode = '22023'; end if;
    end loop;
    select array_agg('%' || replace(replace(replace(lower(x), '\', '\\'), '%', '\%'), '_', '\_') || '%') into s_pat from unnest(s_vals) x;
    -- digits only, with a leading +91 / 0 dropped so "+91 98765 00002" finds "9876500002"; short digit runs are not phone searches
    select array_agg('%' || d || '%') into s_dig
      from (select case when length(d0) = 12 and d0 like '91%' then substr(d0, 3) when length(d0) = 11 and d0 like '0%' then substr(d0, 2) else d0 end d
              from (select regexp_replace(x, '\D', '', 'g') d0 from unnest(s_vals) x) y) z
     where length(d) >= 4;
    if s_col = '_any' then
      s_any := true;
    else
      select * into s_cat from public.vsat__grid_catalog() c where c.key = s_col and not c.virt and c.typ in ('text', 'num', 'date', 'ts');
      if not found then raise exception 'BAD_VALUE: column' using errcode = '22023'; end if;
      if not public.vsat__grid_may_see(s_cat.sens, mgr) then raise exception 'FORBIDDEN_COLUMN: %', s_col using errcode = '42501'; end if;
      -- the only dynamic SQL: the column name comes from the catalogue above and is quoted with %I; values are bound
      if s_col ~ '(mobile|phone|contact)' then
        execute format('select coalesce(array_agg(am.application_id), ''{}'') from public.application_manager am where regexp_replace(coalesce(am.%I::text, ''''), ''\D'', '''', ''g'') like any($1)', s_col)
          using coalesce(s_dig, '{}'::text[]) into s_ids;
      else
        execute format('select coalesce(array_agg(am.application_id), ''{}'') from public.application_manager am where lower(am.%I::text) like any($1)', s_col)
          using s_pat into s_ids;
      end if;
    end if;
  end if;

  v_limit  := least(greatest(coalesce((p->>'limit')::numeric, 50), 1), p_max)::int;
  v_offset := greatest(coalesce((p->>'offset')::numeric, 0), 0)::int;

  with vis as materialized (
    select vp.application_id, vp.attempt_no, vp.stage, vp.status, vp.stage_changed_at, am.exam_date_id,
           public.vsat__campus_key(am.campus_applied) campus, am.form_stage_1::text form_stage, am.payment_stage_1::text pay_stage
      from public.vsat_pipeline vp join public.application_manager am on am.application_id = vp.application_id
     where (f_admin
            or (f_adm and (f_adm_all or public.vsat__campus_key(am.campus_applied) is null
                           or public.vsat__campus_key(am.campus_applied) = any(adm_campuses)))
            or (f_int and exists (select 1 from public.interview_assignments a where a.application_id = vp.application_id
                                     and a.attempt_no = vp.attempt_no and a.interviewer_id = uid))
            or (f_cou and exists (select 1 from public.counselling_assignments a where a.application_id = vp.application_id
                                     and a.attempt_no = vp.attempt_no and a.counsellor_id = uid)))
       and (v_scope is null or vp.stage = any(v_scope))
       and (v_ids is null or vp.application_id = any(v_ids))
       and (not has_filters or vp.application_id = any(f_ids))
       and (s_ids is null or vp.application_id = any(s_ids))
       and (not s_any or lower(coalesce(am.registered_name, '')) like any(s_pat) or am.application_no = any(s_vals) or am.application_id = any(s_vals)
            or (mgr and (lower(coalesce(am.registered_email, '')) like any(s_pat)
                         -- "all fields" only treats a value as a phone search when it carries at least 6 digits ("%…%" is 2 extra)
                         or regexp_replace(coalesce(am.registered_mobile, ''), '\D', '', 'g') like any(coalesce((select array_agg(d) from unnest(s_dig) d where length(d) >= 8), '{}'::text[])))))
  ), base as materialized (
    select * from vis
     where (v_stages is null or vis.stage = any(v_stages))
       and (v_statuses is null or vis.status = any(v_statuses))
       and (v_dates is null or vis.exam_date_id = any(v_dates))
       and (v_campuses is null or vis.campus = any(v_campuses))
       and (v_form is null or vis.form_stage = any(v_form))
       and (v_pay is null or vis.pay_stage = any(v_pay))
  ), page as (
    select * from base order by base.stage_changed_at desc, base.application_id limit v_limit offset v_offset
  ), pagej as materialized (
    -- one row per page row, computed ONCE (materialized): the effective VPS / eligibility call, the latest
    -- interview and counselling rows and the student's own columns as json
    select pg.application_id, pg.stage, pg.status, pg.attempt_no, pg.stage_changed_at, pg.campus, d.label vsat,
           case when need_eff then public.vsat__effective(pg.application_id) end eff,
           exists (select 1 from public.vsat_registrations vr where vr.user_id = am.lead_id and vr.registered) early_reg,
           to_jsonb(am) am_j,
           public.vsat__exam_pct(am.exam_obtained_marks, am.exam_max_marks) ex_pct, am.exam_sections ex_sec, pr.verdict proct,
           ia.who ia_who, ia.slot_datetime ia_slot, ia.attendance ia_att, ia.weighted_avg ia_score, coalesce(ia.calc_verdict, ia.result) ia_calc,
           ia.interviewer_verdict ia_verdict, ia.cheating_seen ia_cheat,
           ca.who ca_who, ca.slot_datetime ca_slot, ca.attendance ca_att, ca.scholarship_category ca_cat, ca.scholarship_pct ca_pct, ca.calculated_pct ca_calc
      from page pg
      join public.application_manager am on am.application_id = pg.application_id
      left join public.vsat_exam_dates d on d.id = am.exam_date_id
      left join public.vsat_proctoring pr on pr.application_id = pg.application_id and pr.attempt_no = pg.attempt_no
      left join lateral (select ia.slot_datetime, ia.attendance, ia.weighted_avg, ia.calc_verdict, ia.result, ia.interviewer_verdict, ia.cheating_seen,
                                coalesce(ip.full_name, ip.email) who
                           from public.interview_assignments ia left join public.profiles ip on ip.id = ia.interviewer_id
                          where ia.application_id = pg.application_id and ia.attempt_no = pg.attempt_no order by ia.created_at desc limit 1) ia on true
      left join lateral (select ca.slot_datetime, ca.attendance, ca.scholarship_category, ca.scholarship_pct, ca.calculated_pct,
                                coalesce(cp.full_name, cp.email) who
                           from public.counselling_assignments ca left join public.profiles cp on cp.id = ca.counsellor_id
                          where ca.application_id = pg.application_id and ca.attempt_no = pg.attempt_no order by ca.created_at desc limit 1) ca on true
  ), pagev as materialized (
    -- every column a row can offer, under its catalogue key; the requested ones are picked from this below
    select pj.application_id, pj.stage, pj.status, pj.attempt_no, pj.stage_changed_at,
           pj.am_j || jsonb_build_object(
             'stage', pj.stage, 'status', pj.status, 'stage_changed_at', pj.stage_changed_at, 'attempt_no', pj.attempt_no,
             'campus', pj.campus, 'early_registration', pj.early_reg, 'vsat', pj.vsat,
             'vps_effective', pj.eff -> 'vps' -> 'value', 'vps_override', pj.eff -> 'vps' -> 'override',
             'eligible_effective', pj.eff -> 'eligible' -> 'value', 'eligible_override', pj.eff -> 'eligible' -> 'override',
             'vps_calculated', pj.eff -> 'vps' -> 'calculated',
             'class12_result', pj.eff -> 'eligible' -> 'detail' -> 'class12',
             'class10_eligible', pj.eff -> 'eligible' -> 'detail' -> 'class10_ok', 'class12_eligible', pj.eff -> 'eligible' -> 'detail' -> 'class12_ok',
             'exam_percentage', pj.ex_pct, 'proctoring', pj.proct,
             'exam_section_maths', public.vsat__section_marks(pj.ex_sec, 'maths'), 'exam_section_lr', public.vsat__section_marks(pj.ex_sec, 'lr'),
             'exam_section_cs', public.vsat__section_marks(pj.ex_sec, 'cs'),
             'interviewer', pj.ia_who, 'interview_slot', pj.ia_slot, 'interview_attendance', pj.ia_att, 'interview_score', pj.ia_score,
             'interview_calc_verdict', pj.ia_calc, 'interviewer_verdict', pj.ia_verdict, 'cheating_seen', pj.ia_cheat,
             'counsellor', pj.ca_who, 'counselling_slot', pj.ca_slot, 'counselling_attendance', pj.ca_att,
             'counselling_category', pj.ca_cat, 'counselling_pct', pj.ca_pct, 'counselling_calculated_pct', pj.ca_calc) v
      from pagej pj
  )
  select (select count(*) from base),
         case when p_facets then jsonb_build_object(
           'stage',  (select coalesce(jsonb_object_agg(x.stage, x.n), '{}'::jsonb) from (
                        select vis.stage, count(*) n from vis
                         where (v_statuses is null or vis.status = any(v_statuses)) and (v_dates is null or vis.exam_date_id = any(v_dates))
                           and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) group by vis.stage) x),
           'status', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (
                        select vis.status, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_dates is null or vis.exam_date_id = any(v_dates))
                           and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) group by vis.status) x),
           'vsat',   (select coalesce(jsonb_object_agg(coalesce(x.exam_date_id::text, 'none'), x.n), '{}'::jsonb) from (
                        select vis.exam_date_id, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) group by vis.exam_date_id) x),
           'campus', (select coalesce(jsonb_object_agg(coalesce(x.campus, 'none'), x.n), '{}'::jsonb) from (
                        select vis.campus, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) group by vis.campus) x),
           'form_stage', (select coalesce(jsonb_object_agg(coalesce(x.form_stage, 'none'), x.n), '{}'::jsonb) from (
                        select vis.form_stage, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates)) and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_pay is null or vis.pay_stage = any(v_pay)) group by vis.form_stage) x),
           'payment_stage', case when mgr then (select coalesce(jsonb_object_agg(coalesce(x.pay_stage, 'none'), x.n), '{}'::jsonb) from (
                        select vis.pay_stage, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates)) and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) group by vis.pay_stage) x) else '{}'::jsonb end) end,
         (select coalesce(jsonb_agg(
                   jsonb_build_object('application_id', pv.application_id, 'stage', pv.stage, 'status', pv.status, 'attempt_no', pv.attempt_no)
                   || coalesce((select jsonb_object_agg(c, pv.v -> c) from unnest(v_cols) c), '{}'::jsonb)
                   order by pv.stage_changed_at desc, pv.application_id), '[]'::jsonb)
            from pagev pv)
    into total, facets, rows;

  return jsonb_build_object('total', total, 'facets', facets, 'rows', rows, 'limit', v_limit, 'offset', v_offset, 'can_manage', mgr);
end $function$;

-- ═════════════ 4. proctoring verdicts (bulk) ═════════════
-- p = { application_ids: [...≤500], verdict: 'disqualified' | 'cleared' | null (= remove), reason? }
create or replace function public.vsat_set_proctoring_bulk(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  ids text[]; id text; v_verdict text; v_reason text; cur public.vsat_pipeline; v_campus text; old text;
  changed int := 0; unchanged int := 0; skipped jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_manage(null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_ids', 'verdict', 'reason']);
  if jsonb_typeof(p->'application_ids') is distinct from 'array' or jsonb_array_length(p->'application_ids') = 0
     or jsonb_array_length(p->'application_ids') > 500
     or exists (select 1 from jsonb_array_elements(p->'application_ids') e where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') not between 1 and 64) then
    raise exception 'BAD_VALUE: application_ids' using errcode = '22023';
  end if;
  if not (p ? 'verdict') or jsonb_typeof(p->'verdict') not in ('string', 'null') then raise exception 'BAD_VALUE: verdict' using errcode = '22023'; end if;
  v_verdict := p->>'verdict';
  if v_verdict is not null and v_verdict not in ('disqualified', 'cleared') then raise exception 'BAD_VALUE: verdict' using errcode = '22023'; end if;
  if p ? 'reason' and jsonb_typeof(p->'reason') not in ('string', 'null') then raise exception 'BAD_VALUE: reason' using errcode = '22023'; end if;
  v_reason := nullif(btrim(coalesce(p->>'reason', '')), '');
  if char_length(coalesce(v_reason, '')) > 500 then raise exception 'REASON_TOO_LONG' using errcode = '22023'; end if;
  if v_verdict = 'disqualified' and char_length(coalesce(v_reason, '')) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  select array_agg(distinct e) into ids from jsonb_array_elements_text(p->'application_ids') e;

  foreach id in array ids loop
    select vp.* into cur from public.vsat_pipeline vp where vp.application_id = id for update;
    if not found then skipped := skipped || jsonb_build_object('application_id', id, 'code', 'NOT_IN_PIPELINE'); continue; end if;
    select public.vsat__campus_key(am.campus_applied) into v_campus from public.application_manager am where am.application_id = id;
    if not public.vsat__can_manage(v_campus) then skipped := skipped || jsonb_build_object('application_id', id, 'code', 'FORBIDDEN'); continue; end if;
    select pr.verdict into old from public.vsat_proctoring pr where pr.application_id = id and pr.attempt_no = cur.attempt_no for update;
    if old is not distinct from v_verdict then unchanged := unchanged + 1; continue; end if;
    -- changing or removing a verdict someone already gave needs a reason
    if old is not null and char_length(coalesce(v_reason, '')) < 3 then
      skipped := skipped || jsonb_build_object('application_id', id, 'code', 'REASON_REQUIRED'); continue;
    end if;
    if v_verdict is null then
      delete from public.vsat_proctoring where application_id = id and attempt_no = cur.attempt_no;
    else
      insert into public.vsat_proctoring (application_id, attempt_no, verdict, reason, set_by, set_at)
      values (id, cur.attempt_no, v_verdict, v_reason, auth.uid(), now())
      on conflict (application_id, attempt_no) do update set verdict = excluded.verdict, reason = excluded.reason, set_by = excluded.set_by, set_at = excluded.set_at;
    end if;
    insert into public.vsat_proctoring_log (application_id, attempt_no, from_verdict, to_verdict, reason, actor_id)
    values (id, cur.attempt_no, old, v_verdict, v_reason, auth.uid());
    changed := changed + 1;
  end loop;
  return jsonb_build_object('changed', changed, 'unchanged', unchanged, 'skipped', skipped);
end $function$;

-- ═════════════ 5. VSAT analysis (the sheet's analysis box) ═════════════
-- p = { exam_date_ids: [uuid, … ≤20], percentile?: 0–100 }
-- takers = has a percentile. Average % and "> 70" count every taker (as the sheet does); slabs, gender and the
-- cut-off table leave out the disqualified. Gender: male / female / other (anything else, or blank).
create or replace function public.vsat_exam_analysis(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  uid uuid := auth.uid(); f_admin boolean; f_adm boolean; f_adm_all boolean; adm_campuses text[];
  v_dates uuid[]; v_cut numeric; v_vps numeric; r jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['exam_date_ids', 'percentile']);
  f_admin := coalesce(public.is_admin(), false);
  select bool_or(true), bool_or(t.campus is null), array_agg(t.campus) filter (where t.campus is not null)
    into f_adm, f_adm_all, adm_campuses
    from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active;
  f_adm := coalesce(f_adm, false); f_adm_all := coalesce(f_adm_all, false);
  if not (f_admin or f_adm) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  if jsonb_typeof(p->'exam_date_ids') is distinct from 'array' or jsonb_array_length(p->'exam_date_ids') not between 1 and 20 then
    raise exception 'BAD_VALUE: exam_date_ids' using errcode = '22023';
  end if;
  begin
    select array_agg(x::uuid) into v_dates from jsonb_array_elements_text(p->'exam_date_ids') x;
  exception when others then raise exception 'BAD_VALUE: exam_date_ids' using errcode = '22023'; end;
  v_cut := public.vsat__settings_num(p, 'percentile', 0, 100, false);
  if v_cut is not null and array_length(v_dates, 1) = 1 then
    select public.vsat_calc_vps(v_cut, coalesce(d.vps_anchors, s.vps_anchors)) into v_vps
      from public.vsat_exam_dates d cross join (select * from public.vsat_exam_settings order by id limit 1) s where d.id = v_dates[1];
  end if;

  with pop as materialized (
    select am.exam_percentile pctl, public.vsat__exam_pct(am.exam_obtained_marks, am.exam_max_marks) pct,
           case when lower(btrim(coalesce(am.gender, ''))) in ('male', 'm') then 'male'
                when lower(btrim(coalesce(am.gender, ''))) in ('female', 'f') then 'female' else 'other' end g,
           coalesce(public.vsat__campus_key(am.campus_applied), 'none') campus,
           coalesce(pr.verdict = 'disqualified', false) dq
      from public.vsat_pipeline vp
      join public.application_manager am on am.application_id = vp.application_id
      left join public.vsat_proctoring pr on pr.application_id = vp.application_id and pr.attempt_no = vp.attempt_no
     where am.exam_date_id = any(v_dates)
       and (f_admin or f_adm_all or public.vsat__campus_key(am.campus_applied) is null
            or public.vsat__campus_key(am.campus_applied) = any(adm_campuses))
  ), t as (select * from pop where pctl is not null), ok as (select * from t where not dq),
  cut as (select * from ok where v_cut is not null and pctl >= v_cut)
  select jsonb_build_object(
    'booked',         (select count(*) from pop),
    'takers',         (select count(*) from t),
    'disqualified',   (select count(*) from t where dq),
    'avg_percentage', (select round(avg(pct), 2) from t),
    'avg_percentile', (select round(avg(pctl), 2) from t),
    'above_70',       (select count(*) from t where pctl > 70),
    'slabs', jsonb_build_array(
      jsonb_build_object('label', '0–20',  'n', (select count(*) from ok where pctl < 20)),
      jsonb_build_object('label', '20–40', 'n', (select count(*) from ok where pctl >= 20 and pctl < 40)),
      jsonb_build_object('label', '40–60', 'n', (select count(*) from ok where pctl >= 40 and pctl < 60)),
      jsonb_build_object('label', '60–80', 'n', (select count(*) from ok where pctl >= 60 and pctl < 80)),
      jsonb_build_object('label', '80+',   'n', (select count(*) from ok where pctl >= 80))),
    'gender', jsonb_build_object('male', (select count(*) from ok where g = 'male'), 'female', (select count(*) from ok where g = 'female'),
                                 'other', (select count(*) from ok where g = 'other')),
    'cutoff', case when v_cut is null then null else jsonb_build_object(
      'percentile', v_cut, 'vps', v_vps,
      'total', (select count(*) from cut),
      'by_campus', (select coalesce(jsonb_object_agg(c.campus, c.v), '{}'::jsonb) from (
                      select cut.campus, jsonb_build_object('male', count(*) filter (where g = 'male'), 'female', count(*) filter (where g = 'female'),
                                                            'other', count(*) filter (where g = 'other'), 'total', count(*)) v
                        from cut group by cut.campus) c),
      'overall', jsonb_build_object('male', (select count(*) from cut where g = 'male'), 'female', (select count(*) from cut where g = 'female'),
                                    'other', (select count(*) from cut where g = 'other'))) end)
    into r;
  return r;
end $function$;

-- ═════════════ 6. Select for PI ═════════════
-- p = { exam_date_id, percentile (0–100), apply?: bool (default preview), note?: text ≤ 300, expected_count?: int }
-- Each student lands in exactly one bucket, checked in this order:
--   no_result → disqualified → below_cutoff → already_selected (at or past "VSAT cleared") → not_active → not_eligible → selected
create or replace function public.vsat_select_for_pi(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_date uuid; v_cut numeric; v_apply boolean := false; v_note text; v_expected int; v_label text; v_anchors jsonb; v_vps numeric;
  v_old jsonb; v_reason text; rec record; r jsonb; n_sel int; picks jsonb;
  moved int := 0; unchanged int := 0; skipped jsonb := '[]'::jsonb; summary jsonb;
begin
  perform public.vsat__settings_admin();   -- NOT_SIGNED_IN / FORBIDDEN (admins only: it sets the VSAT's cut-off)
  perform public.vsat__check_keys(p, array['exam_date_id', 'percentile', 'apply', 'note', 'expected_count']);
  begin v_date := (p->>'exam_date_id')::uuid; exception when others then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end;
  select d.label, coalesce(d.vps_anchors, s.vps_anchors), jsonb_build_object('vps_anchors', d.vps_anchors, 'cleared_vps_cutoff', d.cleared_vps_cutoff)
    into v_label, v_anchors, v_old
    from public.vsat_exam_dates d cross join (select * from public.vsat_exam_settings order by id limit 1) s where d.id = v_date;
  if v_date is null or v_label is null then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end if;
  v_cut := public.vsat__settings_num(p, 'percentile', 0, 100, true);
  if p ? 'apply' then
    if jsonb_typeof(p->'apply') <> 'boolean' then raise exception 'BAD_VALUE: apply' using errcode = '22023'; end if;
    v_apply := (p->>'apply')::boolean;
  end if;
  if p ? 'note' and jsonb_typeof(p->'note') not in ('string', 'null') then raise exception 'BAD_VALUE: note' using errcode = '22023'; end if;
  v_note := nullif(btrim(coalesce(p->>'note', '')), '');
  if char_length(coalesce(v_note, '')) > 300 then raise exception 'BAD_VALUE: note' using errcode = '22023'; end if;
  if p ? 'expected_count' then
    if jsonb_typeof(p->'expected_count') <> 'number' then raise exception 'BAD_VALUE: expected_count' using errcode = '22023'; end if;
    v_expected := (p->>'expected_count')::numeric::int;
  end if;
  v_vps := public.vsat_calc_vps(v_cut, v_anchors);

  -- every student of this VSAT, with the one bucket they fall in (kept as json so preview and apply read the same list)
  select coalesce(jsonb_agg(jsonb_build_object('application_id', x.application_id, 'application_no', x.application_no, 'name', x.name,
           'stage', x.stage, 'pctl', x.pctl, 'g', x.g, 'campus', x.campus,
           'bucket', case when x.pctl is null then 'no_result'
                          when x.dq then 'disqualified'
                          when x.pctl < v_cut then 'below_cutoff'
                          when public.vsat__stage_order(x.stage) >= public.vsat__stage_order('vsat_cleared') then 'already_selected'
                          when x.status <> 'active' then 'not_active'
                          when x.eligible is false then 'not_eligible'
                          else 'selected' end)), '[]'::jsonb)
    into picks
    from (
      select vp.application_id, am.application_no, am.registered_name name, vp.stage, vp.status, am.exam_percentile pctl,
             case when lower(btrim(coalesce(am.gender, ''))) in ('male', 'm') then 'male'
                  when lower(btrim(coalesce(am.gender, ''))) in ('female', 'f') then 'female' else 'other' end g,
             public.vsat__campus_key(am.campus_applied) campus,
             coalesce(pr.verdict = 'disqualified', false) dq,
             coalesce((public.vsat__override_of(am.application_id, 'eligible') #>> '{}')::boolean,
                      (public.vsat__elig(am.class10_year, am.class12_year, am.marks_physics_12, am.marks_chemistry_12, am.marks_maths_12,
                                         am.class12_percentage)->>'eligible')::boolean) eligible
        from public.vsat_pipeline vp
        join public.application_manager am on am.application_id = vp.application_id
        left join public.vsat_proctoring pr on pr.application_id = vp.application_id and pr.attempt_no = vp.attempt_no
       where am.exam_date_id = v_date) x;

  with k as (select * from jsonb_to_recordset(picks) as t(application_id text, application_no text, name text, stage text, pctl numeric,
                                                          g text, campus text, bucket text)),
       s as (select * from k where k.bucket = 'selected')
  select count(*)::int, jsonb_build_object(
    'vsat', v_label, 'exam_date_id', v_date, 'percentile', v_cut, 'vps_cutoff', v_vps,
    'counts', (select jsonb_object_agg(b.bucket, (select count(*) from k where k.bucket = b.bucket))
                 from unnest(array['selected', 'below_cutoff', 'disqualified', 'no_result', 'already_selected', 'not_active', 'not_eligible']) b(bucket)),
    'selected', jsonb_build_object(
      'total', count(*),
      'male', count(*) filter (where s.g = 'male'), 'female', count(*) filter (where s.g = 'female'), 'other', count(*) filter (where s.g = 'other'),
      'pune', count(*) filter (where s.campus = 'pune'), 'gurugram', count(*) filter (where s.campus = 'gurugram')),
    'candidates', (select coalesce(jsonb_agg(jsonb_build_object('application_id', c.application_id, 'application_no', c.application_no, 'name', c.name,
                                                               'percentile', c.pctl, 'gender', c.g, 'campus', c.campus, 'stage', c.stage)
                                             order by c.pctl desc, c.application_id), '[]'::jsonb)
                     from (select * from s order by s.pctl desc, s.application_id limit 1000) c))
    into n_sel, summary
    from s;

  if not v_apply then return summary || jsonb_build_object('applied', false); end if;

  if v_expected is not null and v_expected <> n_sel then raise exception 'COUNT_CHANGED' using errcode = '40001'; end if;
  if n_sel > 1000 then raise exception 'TOO_MANY_ROWS' using errcode = '54000'; end if;
  v_reason := left(format('Selected for PI · %s · percentile ≥ %s (VPS ≥ %s)', v_label, v_cut, coalesce(v_vps::text, '—'))
                   || coalesce(' · ' || v_note, ''), 500);
  for rec in select t.application_id, t.stage from jsonb_to_recordset(picks) as t(application_id text, stage text, pctl numeric, bucket text)
              where t.bucket = 'selected' order by t.pctl desc, t.application_id loop
    begin
      r := public.vsat__move_checked(rec.application_id, 'vsat_cleared', 'active', v_reason, rec.stage, 'bulk');
      if (r->>'changed')::boolean then moved := moved + 1; else unchanged := unchanged + 1; end if;
    exception when others then
      skipped := skipped || jsonb_build_object('application_id', rec.application_id, 'code', sqlerrm);
    end;
  end loop;
  -- the VSAT remembers the VPS cut-off it was cleared at (reference; audited like a settings change)
  if v_old->'cleared_vps_cutoff' is distinct from to_jsonb(v_vps) then
    update public.vsat_exam_dates set cleared_vps_cutoff = v_vps, updated_at = now() where id = v_date;
    perform public.vsat__settings_log('vsat', v_date::text, v_old,
      jsonb_build_object('vps_anchors', v_old->'vps_anchors', 'cleared_vps_cutoff', v_vps, 'source', 'select_for_pi', 'percentile', v_cut));
  end if;
  return summary || jsonb_build_object('applied', true, 'moved', moved, 'unchanged', unchanged, 'skipped', skipped);
end $function$;

revoke all on function public.vsat_set_proctoring_bulk(jsonb) from public, anon;
revoke all on function public.vsat_exam_analysis(jsonb) from public, anon;
revoke all on function public.vsat_select_for_pi(jsonb) from public, anon;
grant execute on function public.vsat_set_proctoring_bulk(jsonb) to authenticated;
grant execute on function public.vsat_exam_analysis(jsonb) to authenticated;
grant execute on function public.vsat_select_for_pi(jsonb) to authenticated;
