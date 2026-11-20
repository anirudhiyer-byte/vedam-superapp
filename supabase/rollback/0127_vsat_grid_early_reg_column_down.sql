-- Rollback for 0127 — restore public.vsat__grid_catalog to its 0097 definition (no early_registration)
-- and public.vsat__grid to its 0124 definition. Byte-identical to those committed bodies.

create or replace function public.vsat__grid_catalog()
returns table (key text, grp text, typ text, sens text, virt boolean)
language sql stable security definer set search_path to '' as $$
  with real_cols as (
    select a.attname::text as key, a.atttypid::regtype::text as pgtype, a.attnum
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.application_manager'::regclass and a.attnum > 0 and not a.attisdropped
  ), virt as (
    select * from (values
      ('stage',                      'Pipeline',    'stage',  10), ('status',               'Pipeline',    'status', 11),
      ('stage_changed_at',           'Pipeline',    'ts',     12), ('attempt_no',           'Pipeline',    'num',    13),
      ('campus',                     'Pipeline',    'text',   14), ('vsat',                 'Exam',        'text',   15),
      ('vps_effective',              'Exam',        'num',    16), ('vps_override',         'Exam',        'num',    17),
      ('eligible_effective',         'Exam',        'bool',   18), ('eligible_override',    'Exam',        'bool',   19),
      ('interviewer',                'Interview',   'text',   20), ('interview_slot',       'Interview',   'ts',     21),
      ('interview_attendance',       'Interview',   'text',   22), ('interview_score',      'Interview',   'num',    23),
      ('interview_calc_verdict',     'Interview',   'text',   24), ('interviewer_verdict',  'Interview',   'text',   25),
      ('cheating_seen',              'Interview',   'bool',   26),
      ('counsellor',                 'Counselling', 'text',   30), ('counselling_slot',     'Counselling', 'ts',     31),
      ('counselling_attendance',     'Counselling', 'text',   32), ('counselling_category', 'Counselling', 'num',    33),
      ('counselling_pct',            'Counselling', 'num',    34), ('counselling_calculated_pct', 'Counselling', 'num', 35)
    ) v(key, grp, typ, ord)
  )
  select v.key, v.grp, v.typ, 'open'::text, true from virt v
  union all
  select c.key,
         case
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
$$;
revoke all on function public.vsat__grid_catalog() from public, anon, authenticated;

create or replace function public.vsat__grid(p jsonb, p_max int, p_facets boolean, p_manager_only boolean)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  uid uuid := auth.uid(); f_admin boolean; f_adm boolean; f_adm_all boolean; adm_campuses text[]; f_int boolean; f_cou boolean; mgr boolean;
  v_scope text[]; v_stages text[]; v_statuses text[]; v_dates uuid[]; v_campuses text[]; v_cols text[]; v_ids text[];
  v_form text[]; v_pay text[];
  f_ids text[]; has_filters boolean := false; fl jsonb; fcol text; fop text; ftyp text; fwhere text := ''; frag text; fsym text; farr text[]; fcat record; fsql text;
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

  -- advanced filter builder: AND-ed clauses on real columns → a set of application_ids that narrows everything
  if p ? 'filters' and jsonb_typeof(p->'filters') = 'array' then
    if jsonb_array_length(p->'filters') > 20 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
    for fl in select value from jsonb_array_elements(p->'filters') loop
      if jsonb_typeof(fl) <> 'object' then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      perform public.vsat__check_keys(fl, array['column', 'op', 'v']);
      fcol := nullif(btrim(coalesce(fl->>'column', '')), '');
      fop  := nullif(btrim(coalesce(fl->>'op', '')), '');
      if fcol is null or fop is null then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      select * into fcat from public.vsat__grid_catalog() c where c.key = fcol and not c.virt;
      if not found then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      if not public.vsat__grid_may_see(fcat.sens, mgr) then raise exception 'FORBIDDEN_COLUMN: %', fcol using errcode = '42501'; end if;
      ftyp := fcat.typ;
      -- null / boolean predicates take no value
      if fop = 'isnull' then frag := format('am.%I is null', fcol);
      elsif fop = 'notnull' then frag := format('am.%I is not null', fcol);
      elsif ftyp = 'bool' and fop = 'true' then frag := format('am.%I::boolean is true', fcol);
      elsif ftyp = 'bool' and fop = 'false' then frag := format('am.%I::boolean is false', fcol);
      elsif fop = 'in' then
        if ftyp not in ('num', 'text') then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        if jsonb_typeof(fl->'v') <> 'array' then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        select array_agg(x) into farr from jsonb_array_elements_text(fl->'v') x where btrim(x) <> '';
        if farr is null or array_length(farr, 1) > 200 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        foreach s in array farr loop if char_length(s) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if; end loop;
        frag := case ftyp when 'num' then format('(am.%I)::numeric = any(%L::numeric[])', fcol, farr::text)
                          else format('am.%I::text = any(%L::text[])', fcol, farr::text) end;
      elsif fop = 'between' then
        if ftyp not in ('num', 'date', 'ts') then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        if jsonb_typeof(fl->'v') <> 'array' or jsonb_array_length(fl->'v') <> 2
           or btrim(coalesce(fl->'v'->>0, '')) = '' or btrim(coalesce(fl->'v'->>1, '')) = ''
           or char_length(fl->'v'->>0) > 100 or char_length(fl->'v'->>1) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        frag := case ftyp when 'num' then format('(am.%I)::numeric between %L::numeric and %L::numeric', fcol, fl->'v'->>0, fl->'v'->>1)
                          else format('am.%I::date between %L::date and %L::date', fcol, fl->'v'->>0, fl->'v'->>1) end;
      else
        -- single-value operators
        s := fl->>'v';
        if s is null or char_length(s) = 0 or char_length(s) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        fsym := case fop when 'eq' then '=' when 'ne' then '<>' when 'lt' then '<' when 'lte' then '<=' when 'gt' then '>' when 'gte' then '>='
                         when 'before' then '<' when 'after' then '>' else null end;
        if ftyp = 'num' and fop in ('eq', 'ne', 'lt', 'lte', 'gt', 'gte') then
          frag := format('(am.%I)::numeric %s %L::numeric', fcol, fsym, s);
        elsif ftyp in ('date', 'ts') and fop in ('eq', 'before', 'after') then
          frag := format('am.%I::date %s %L::date', fcol, case fop when 'eq' then '=' else fsym end, s);
        elsif ftyp = 'text' and fop = 'eq' then frag := format('am.%I::text = %L', fcol, s);
        elsif ftyp = 'text' and fop = 'ne' then frag := format('am.%I::text is distinct from %L', fcol, s);
        elsif ftyp = 'text' and fop = 'contains' then
          frag := format('lower(am.%I::text) like %L', fcol, '%' || replace(replace(replace(lower(s), '\', '\\'), '%', '\%'), '_', '\_') || '%');
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
  need_eff := coalesce(v_cols && array['vps_effective', 'vps_override', 'eligible_effective', 'eligible_override'], false);

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
           to_jsonb(am) am_j,
           ia.who ia_who, ia.slot_datetime ia_slot, ia.attendance ia_att, ia.weighted_avg ia_score, coalesce(ia.calc_verdict, ia.result) ia_calc,
           ia.interviewer_verdict ia_verdict, ia.cheating_seen ia_cheat,
           ca.who ca_who, ca.slot_datetime ca_slot, ca.attendance ca_att, ca.scholarship_category ca_cat, ca.scholarship_pct ca_pct, ca.calculated_pct ca_calc
      from page pg
      join public.application_manager am on am.application_id = pg.application_id
      left join public.vsat_exam_dates d on d.id = am.exam_date_id
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
             'campus', pj.campus, 'vsat', pj.vsat,
             'vps_effective', pj.eff -> 'vps' -> 'value', 'vps_override', pj.eff -> 'vps' -> 'override',
             'eligible_effective', pj.eff -> 'eligible' -> 'value', 'eligible_override', pj.eff -> 'eligible' -> 'override',
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
end $$;
revoke all on function public.vsat__grid(jsonb, int, boolean, boolean) from public, anon, authenticated;
