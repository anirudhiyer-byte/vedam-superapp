-- 0159 · VSAT Leads grid — the Applications-grid experience for the VSAT Leads panel.
--
-- Brings VSAT Leads to parity with the VSAT Applications grid (0097 / 0124): a Columns drawer,
-- per-column advanced filters, multi-value field-scoped search, row selection and bulk Export /
-- Send Communication across the whole filtered set. Data comes only from these RPCs; the database
-- re-checks role, campus scope and which columns a person may see on every call.
--
-- ISOLATED BY DESIGN: brand-new functions over public.lead_manager only. Nothing here touches the
-- application grid engine (vsat__grid / vsat__grid_catalog) or the existing vsat_leads_list /
-- vsat_leads_export, so neither the Applications grid nor the current Leads panel can regress.
--
-- Security (checked here, never only in the browser) — same model as vsat__grid:
--   • Who sees which leads: admin everything; active admissions by campus (vsat__campus_key of
--     campus_preference). No interviewer / counsellor access (leads are a manager surface).
--   • Which COLUMNS a person may see: vsat__leads_grid_catalog() classifies every real column of
--     lead_manager by name pattern. contact / finance → managers only (reusing vsat__grid_may_see);
--     uuid / internal → hidden. New columns on lead_manager are classified the day they appear.
--   • Advanced filters: only REAL, allowed columns; operator must match the column type; the only
--     dynamic SQL is built with %I for the catalogue column name and %L for every value (explicit
--     ::type cast), wrapped so a bad cast becomes BAD_VALUE: filters and never leaks.
--   • Export / recipients: admin or active admissions only; hard cap 5,000 rows; audited in
--     vsat_grid_audit (0097).
--
-- Rollback: supabase/rollback/0159_vsat_leads_grid_down.sql
-- Tests:    supabase/tests/vsat_leads_grid.test.sql

-- ── the lead column catalogue (private) ────────────────────────────────────────────────
-- Every real column of lead_manager (read from the catalogue so new columns appear on their own)
-- plus one virtual column: `campus` (the normalised Pune / Gurugram key).
create or replace function public.vsat__leads_grid_catalog()
returns table (key text, grp text, typ text, sens text, virt boolean)
language sql stable security definer set search_path to '' as $$
  with real_cols as (
    select a.attname::text as key, a.atttypid::regtype::text as pgtype
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.lead_manager'::regclass and a.attnum > 0 and not a.attisdropped
  )
  select 'campus'::text, 'Lead'::text, 'text'::text, 'open'::text, true
  union all
  select c.key,
         case
           when c.key like '%utm%' or c.key like '%attribution%' or c.key like '%traffic_channel%'
                or c.key like '%registration_campaign%' or c.key in ('publisher_name', 'lead_origin', 'gclid', 'fbclid',
                   'registration_device', 'registration_channel', 'widget_name', 'current_url', 'agent_code', 'ip_address') then 'Marketing'
           when c.key like 'parent%' or c.key like 'guardian%'                                     then 'Parents'
           when c.key like 'class_12%' or c.key in ('board', 'school_name', 'passing_year', 'jee_percentile',
                   'preferred_engineering_specialization', 'current_education_level')               then 'Academics'
           when c.key like 'lead_owner%' or c.key like 'assigned%' or c.key like 'reassigned%'
                or c.key like '%lead_owner%' or c.key in ('disposition', 'created_by', 'consultant_id', 'affiliate_id', 'lead_assignment_date') then 'Ownership'
           when c.key like 'outbound%' or c.key like 'inbound%' or c.key like 'campaign_%'
                or c.key like 'total_%' or c.key like 'followup%' or c.key like 'notes%' or c.key like 'stage_change%'
                or c.key like 'registration_attempt%' or c.key like '%contacted%' or c.key like '%activity_date%' or c.key like 'next_followup%' then 'Activity'
           when c.key like 'lead_stage%' or c.key like '%lead_stage' or c.key in ('lead_status', 'account_status', 'conversion_status',
                   'enrolment_status', 'application_submitted', 'form_initiated', 'disposition')     then 'Pipeline'
           when c.key in ('lead_score', 'lead_strength_percentile', 'duplicate_flag', 'consent_optin') then 'Scoring'
           when c.key like '%_date' or c.key like '%_at'                                            then 'Dates'
           else 'Lead' end,
         case c.pgtype
           when 'numeric' then 'num' when 'integer' then 'num' when 'bigint' then 'num' when 'boolean' then 'bool'
           when 'date' then 'date' when 'timestamp with time zone' then 'ts' when 'jsonb' then 'json' when 'uuid' then 'uuid'
           else 'text' end,
         case
           when c.pgtype in ('jsonb', 'uuid')                                                       then 'hidden'
           when c.key ~ '(mobile|phone|email|contact|whatsapp)' or c.key = 'ip_address'             then 'contact'
           when c.key ~ '(income|amount|payment)'                                                   then 'finance'
           else 'open' end,
         false
    from real_cols c
   order by 2, 1
$$;
revoke all on function public.vsat__leads_grid_catalog() from public, anon, authenticated;

-- ── the engine (private): parse + check the request, run the query ─────────────────────
-- p: {campuses?, lead_stages?, applied?('yes'|'no'), sources?, filters?:[{column,op,v}],
--     search?:{column, values:[..]}, columns?:[..], lead_ids?:[uuid], limit?, offset?}
-- p_max caps the page; p_facets adds the campus / stage / applied / source counts.
create or replace function public.vsat__leads_grid(p jsonb, p_max int, p_facets boolean)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  uid uuid := auth.uid(); f_admin boolean; f_adm boolean; f_adm_all boolean; adm_campuses text[]; mgr boolean;
  v_campuses text[]; v_stages text[]; v_sources text[]; v_applied text; v_app_bool boolean; v_cols text[]; v_ids text[];
  v_limit int; v_offset int; k text; s text;
  fl jsonb; fcol text; fop text; ftyp text; fwhere text := ''; frag text; fsym text; farr text[]; fcat record; fsql text;
  has_filters boolean := false; f_ids text[];
  s_col text; s_vals text[]; s_pat text[]; s_dig text[]; s_ids text[]; s_any boolean := false; s_cat record;
  total int; rows jsonb; facets jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb),
    array['campuses', 'lead_stages', 'applied', 'sources', 'filters', 'search', 'columns', 'lead_ids', 'limit', 'offset']);
  foreach k in array array['campuses', 'lead_stages', 'sources', 'filters', 'columns', 'lead_ids'] loop
    if p ? k and jsonb_typeof(p->k) not in ('array', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;
  foreach k in array array['limit', 'offset'] loop
    if p ? k and jsonb_typeof(p->k) not in ('number', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;
  if p ? 'search' and jsonb_typeof(p->'search') not in ('object', 'null') then raise exception 'BAD_VALUE: search' using errcode = '22023'; end if;

  -- roles: admin or active admissions (campus-scoped). Leads is a manager surface.
  f_admin := coalesce(public.is_admin(), false);
  select bool_or(true), bool_or(t.campus is null), array_agg(t.campus) filter (where t.campus is not null)
    into f_adm, f_adm_all, adm_campuses
    from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active;
  f_adm := coalesce(f_adm, false); f_adm_all := coalesce(f_adm_all, false);
  if not (f_admin or f_adm) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  mgr := true;  -- every reader here is admin / admissions

  -- dropdown filters
  select array_agg(x) into v_campuses from jsonb_array_elements_text(coalesce(p->'campuses', '[]'::jsonb)) x;
  if v_campuses is not null then foreach s in array v_campuses loop
    if s not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campuses' using errcode = '22023'; end if; end loop; end if;

  select array_agg(x) into v_stages from jsonb_array_elements_text(coalesce(p->'lead_stages', '[]'::jsonb)) x;
  if v_stages is not null then
    if coalesce(array_length(v_stages, 1), 0) > 20 then raise exception 'BAD_VALUE: lead_stages' using errcode = '22023'; end if;
    foreach s in array v_stages loop
      if not (s = any(enum_range(null::public.vm_lead_stage)::text[])) then raise exception 'BAD_VALUE: lead_stages' using errcode = '22023'; end if;
    end loop;
  end if;

  v_applied := nullif(p->>'applied', '');
  if v_applied is not null and v_applied not in ('yes', 'no') then raise exception 'BAD_VALUE: applied' using errcode = '22023'; end if;
  v_app_bool := case v_applied when 'yes' then true when 'no' then false else null end;

  select array_agg(x) into v_sources from jsonb_array_elements_text(coalesce(p->'sources', '[]'::jsonb)) x where btrim(x) <> '';
  if v_sources is not null then
    if coalesce(array_length(v_sources, 1), 0) > 50 then raise exception 'BAD_VALUE: sources' using errcode = '22023'; end if;
    foreach s in array v_sources loop if char_length(s) > 100 then raise exception 'BAD_VALUE: sources' using errcode = '22023'; end if; end loop;
  end if;

  -- advanced filter builder: AND-ed clauses on real columns → a set of lead_ids that narrows everything
  if p ? 'filters' and jsonb_typeof(p->'filters') = 'array' then
    if jsonb_array_length(p->'filters') > 20 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
    for fl in select value from jsonb_array_elements(p->'filters') loop
      if jsonb_typeof(fl) <> 'object' then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      perform public.vsat__check_keys(fl, array['column', 'op', 'v']);
      fcol := nullif(btrim(coalesce(fl->>'column', '')), '');
      fop  := nullif(btrim(coalesce(fl->>'op', '')), '');
      if fcol is null or fop is null then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      select * into fcat from public.vsat__leads_grid_catalog() c where c.key = fcol and not c.virt;
      if not found then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      if not public.vsat__grid_may_see(fcat.sens, mgr) then raise exception 'FORBIDDEN_COLUMN: %', fcol using errcode = '42501'; end if;
      ftyp := fcat.typ;
      if fop = 'isnull' then frag := format('l.%I is null', fcol);
      elsif fop = 'notnull' then frag := format('l.%I is not null', fcol);
      elsif ftyp = 'bool' and fop = 'true' then frag := format('l.%I::boolean is true', fcol);
      elsif ftyp = 'bool' and fop = 'false' then frag := format('l.%I::boolean is false', fcol);
      elsif fop = 'in' then
        if ftyp not in ('num', 'text') then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        if jsonb_typeof(fl->'v') <> 'array' then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        select array_agg(x) into farr from jsonb_array_elements_text(fl->'v') x where btrim(x) <> '';
        if farr is null or array_length(farr, 1) > 200 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        foreach s in array farr loop if char_length(s) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if; end loop;
        frag := case ftyp when 'num' then format('(l.%I)::numeric = any(%L::numeric[])', fcol, farr::text)
                          else format('l.%I::text = any(%L::text[])', fcol, farr::text) end;
      elsif fop = 'between' then
        if ftyp not in ('num', 'date', 'ts') then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        if jsonb_typeof(fl->'v') <> 'array' or jsonb_array_length(fl->'v') <> 2
           or btrim(coalesce(fl->'v'->>0, '')) = '' or btrim(coalesce(fl->'v'->>1, '')) = ''
           or char_length(fl->'v'->>0) > 100 or char_length(fl->'v'->>1) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        frag := case ftyp when 'num' then format('(l.%I)::numeric between %L::numeric and %L::numeric', fcol, fl->'v'->>0, fl->'v'->>1)
                          else format('l.%I::date between %L::date and %L::date', fcol, fl->'v'->>0, fl->'v'->>1) end;
      else
        s := fl->>'v';
        if s is null or char_length(s) = 0 or char_length(s) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        fsym := case fop when 'eq' then '=' when 'ne' then '<>' when 'lt' then '<' when 'lte' then '<=' when 'gt' then '>' when 'gte' then '>='
                         when 'before' then '<' when 'after' then '>' else null end;
        if ftyp = 'num' and fop in ('eq', 'ne', 'lt', 'lte', 'gt', 'gte') then
          frag := format('(l.%I)::numeric %s %L::numeric', fcol, fsym, s);
        elsif ftyp in ('date', 'ts') and fop in ('eq', 'before', 'after') then
          frag := format('l.%I::date %s %L::date', fcol, case fop when 'eq' then '=' else fsym end, s);
        elsif ftyp = 'text' and fop = 'eq' then frag := format('l.%I::text = %L', fcol, s);
        elsif ftyp = 'text' and fop = 'ne' then frag := format('l.%I::text is distinct from %L', fcol, s);
        elsif ftyp = 'text' and fop = 'contains' then
          frag := format('lower(l.%I::text) like %L', fcol, '%' || replace(replace(replace(lower(s), '\', '\\'), '%', '\%'), '_', '\_') || '%');
        else raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      end if;
      fwhere := fwhere || case when fwhere = '' then '' else ' and ' end || '(' || frag || ')';
    end loop;
    has_filters := true;
    fsql := 'select coalesce(array_agg(l.lead_id::text), ''{}'') from public.lead_manager l where ' || coalesce(nullif(fwhere, ''), 'true');
    begin
      execute fsql into f_ids;
    exception when others then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end;
    f_ids := coalesce(f_ids, '{}'::text[]);
  end if;

  -- explicit rows (the selection) — lead_ids only, capped
  select array_agg(x) into v_ids from jsonb_array_elements_text(coalesce(p->'lead_ids', '[]'::jsonb)) x where char_length(x) between 1 and 64;
  if coalesce(array_length(v_ids, 1), 0) > 5000 then raise exception 'BAD_VALUE: lead_ids' using errcode = '22023'; end if;

  -- requested columns: each must exist in the catalogue and be allowed for this role
  select array_agg(distinct x) into v_cols from jsonb_array_elements_text(coalesce(p->'columns', '[]'::jsonb)) x;
  if coalesce(array_length(v_cols, 1), 0) > 200 then raise exception 'BAD_VALUE: columns' using errcode = '22023'; end if;
  if v_cols is not null then foreach s in array v_cols loop
    select * into s_cat from public.vsat__leads_grid_catalog() c where c.key = s;
    if not found then raise exception 'BAD_VALUE: columns' using errcode = '22023'; end if;
    if not public.vsat__grid_may_see(s_cat.sens, mgr) then raise exception 'FORBIDDEN_COLUMN: %', s using errcode = '42501'; end if;
  end loop; end if;

  -- multi-value search on one column ('_any' = name / email / mobile)
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
    select array_agg('%' || d || '%') into s_dig
      from (select case when length(d0) = 12 and d0 like '91%' then substr(d0, 3) when length(d0) = 11 and d0 like '0%' then substr(d0, 2) else d0 end d
              from (select regexp_replace(x, '\D', '', 'g') d0 from unnest(s_vals) x) y) z
     where length(d) >= 4;
    if s_col = '_any' then
      s_any := true;
    else
      select * into s_cat from public.vsat__leads_grid_catalog() c where c.key = s_col and not c.virt and c.typ in ('text', 'num', 'date', 'ts');
      if not found then raise exception 'BAD_VALUE: column' using errcode = '22023'; end if;
      if not public.vsat__grid_may_see(s_cat.sens, mgr) then raise exception 'FORBIDDEN_COLUMN: %', s_col using errcode = '42501'; end if;
      -- the only dynamic SQL in search: the column name comes from the catalogue above and is quoted with %I; values are bound
      if s_col ~ '(mobile|phone|contact)' then
        execute format('select coalesce(array_agg(l.lead_id::text), ''{}'') from public.lead_manager l where regexp_replace(coalesce(l.%I::text, ''''), ''\D'', '''', ''g'') like any($1)', s_col)
          using coalesce(s_dig, '{}'::text[]) into s_ids;
      else
        execute format('select coalesce(array_agg(l.lead_id::text), ''{}'') from public.lead_manager l where lower(l.%I::text) like any($1)', s_col)
          using s_pat into s_ids;
      end if;
    end if;
  end if;

  v_limit  := least(greatest(coalesce((p->>'limit')::numeric, 50), 1), p_max)::int;
  v_offset := greatest(coalesce((p->>'offset')::numeric, 0), 0)::int;

  with vis as materialized (
    select l.lead_id, l.user_registration_date,
           public.vsat__campus_key(l.campus_preference) k_campus, l.lead_stage::text k_stage,
           coalesce(l.application_submitted, false) k_applied, l.lead_source k_source,
           to_jsonb(l) lj
      from public.lead_manager l
     where (f_admin or f_adm_all
            or public.vsat__campus_key(l.campus_preference) is null
            or public.vsat__campus_key(l.campus_preference) = any(adm_campuses))
       and (not has_filters or l.lead_id::text = any(f_ids))
       and (s_ids is null or l.lead_id::text = any(s_ids))
       and (v_ids is null or l.lead_id::text = any(v_ids))
       and (not s_any
            or lower(coalesce(l.registered_name, '')) like any(s_pat)
            or lower(coalesce(l.registered_email, '')) like any(s_pat)
            or regexp_replace(coalesce(l.registered_mobile, ''), '\D', '', 'g') like any(coalesce((select array_agg(d) from unnest(s_dig) d where length(d) >= 6), '{}'::text[])))
  ), base as materialized (
    select * from vis
     where (v_campuses is null or vis.k_campus = any(v_campuses))
       and (v_stages is null or vis.k_stage = any(v_stages))
       and (v_app_bool is null or vis.k_applied = v_app_bool)
       and (v_sources is null or vis.k_source = any(v_sources))
  ), page as (
    select * from base order by base.user_registration_date desc nulls last, base.lead_id limit v_limit offset v_offset
  ), pagev as materialized (
    select pg.lead_id, pg.user_registration_date, pg.k_campus,
           pg.lj || jsonb_build_object('campus', pg.k_campus) v
      from page pg
  )
  select (select count(*) from base),
         case when p_facets then jsonb_build_object(
           'campus', (select coalesce(jsonb_object_agg(coalesce(x.k_campus, 'none'), x.n), '{}'::jsonb) from (
                        select vis.k_campus, count(*) n from vis
                         where (v_stages is null or vis.k_stage = any(v_stages)) and (v_app_bool is null or vis.k_applied = v_app_bool)
                           and (v_sources is null or vis.k_source = any(v_sources)) group by vis.k_campus) x),
           'lead_stage', (select coalesce(jsonb_object_agg(coalesce(x.k_stage, 'none'), x.n), '{}'::jsonb) from (
                        select vis.k_stage, count(*) n from vis
                         where (v_campuses is null or vis.k_campus = any(v_campuses)) and (v_app_bool is null or vis.k_applied = v_app_bool)
                           and (v_sources is null or vis.k_source = any(v_sources)) group by vis.k_stage) x),
           'applied', (select jsonb_build_object('yes', count(*) filter (where x.k_applied), 'no', count(*) filter (where not x.k_applied)) from (
                        select vis.k_applied from vis
                         where (v_campuses is null or vis.k_campus = any(v_campuses)) and (v_stages is null or vis.k_stage = any(v_stages))
                           and (v_sources is null or vis.k_source = any(v_sources))) x),
           'source', (select coalesce(jsonb_object_agg(coalesce(x.k_source, 'none'), x.n), '{}'::jsonb) from (
                        select vis.k_source, count(*) n from vis
                         where (v_campuses is null or vis.k_campus = any(v_campuses)) and (v_stages is null or vis.k_stage = any(v_stages))
                           and (v_app_bool is null or vis.k_applied = v_app_bool) group by vis.k_source) x)) end,
         (select coalesce(jsonb_agg(
                   jsonb_build_object('lead_id', pv.lead_id, 'name', pv.v->'registered_name', 'email', pv.v->'registered_email', 'mobile', pv.v->'registered_mobile')
                   || coalesce((select jsonb_object_agg(c, pv.v -> c) from unnest(v_cols) c), '{}'::jsonb)
                   order by pv.user_registration_date desc nulls last, pv.lead_id), '[]'::jsonb)
            from pagev pv)
    into total, facets, rows;

  return jsonb_build_object('total', total, 'facets', facets, 'rows', rows, 'limit', v_limit, 'offset', v_offset, 'can_manage', mgr);
end $$;
revoke all on function public.vsat__leads_grid(jsonb, int, boolean) from public, anon, authenticated;

-- ── browser-callable RPCs ─────────────────────────────────────────────────────────────

-- the lead columns this person may show, grouped (labels are added by the app)
create or replace function public.vsat_leads_grid_columns()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare uid uuid := auth.uid(); mgr boolean;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  mgr := coalesce(public.is_admin(), false)
      or exists (select 1 from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active);
  if not mgr then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object('can_manage', true, 'columns', coalesce((
    select jsonb_agg(jsonb_build_object('key', c.key, 'group', c.grp, 'type', c.typ, 'virtual', c.virt, 'restricted', c.sens <> 'open'))
      from public.vsat__leads_grid_catalog() c where public.vsat__grid_may_see(c.sens, true)), '[]'::jsonb));
end $$;
revoke all on function public.vsat_leads_grid_columns() from public, anon;
grant execute on function public.vsat_leads_grid_columns() to authenticated;

-- one page of the leads grid + dropdown counts (campus / stage / applied / source). Admin / admissions.
create or replace function public.vsat_leads_grid_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  return public.vsat__leads_grid(p, 200, true);
end $$;
revoke all on function public.vsat_leads_grid_list(jsonb) from public, anon;
grant execute on function public.vsat_leads_grid_list(jsonb) to authenticated;

-- the whole filtered set (max 5,000) for a CSV or for Send Communication. Admin / admissions only; audited.
-- p = the list request + purpose: 'csv' (uses p.columns) | 'comms' (fixed contact columns)
create or replace function public.vsat_leads_grid_export(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare purpose text; q jsonb; r jsonb; n int; cols text[];
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  purpose := p->>'purpose';
  if purpose is null or purpose not in ('csv', 'comms') then raise exception 'BAD_VALUE: purpose' using errcode = '22023'; end if;
  q := (p - 'purpose' - 'limit' - 'offset');
  if purpose = 'comms' then
    q := q || jsonb_build_object('columns', '["registered_name", "registered_email", "registered_mobile", "campus", "lead_stage"]'::jsonb);
  end if;
  q := q || jsonb_build_object('limit', 5000, 'offset', 0);
  -- the engine checks role, every filter and every column
  r := public.vsat__leads_grid(q, 5000, false);
  n := (r->>'total')::int;
  if n > 5000 then raise exception 'TOO_MANY_ROWS' using errcode = '54000'; end if;
  select array_agg(x) into cols from jsonb_array_elements_text(coalesce(q->'columns', '[]'::jsonb)) x;
  insert into public.vsat_grid_audit (user_id, purpose, filters, columns, row_count)
  values (auth.uid(), purpose, q - 'columns' - 'limit' - 'offset', coalesce(cols, '{}'::text[]), n);
  return jsonb_build_object('total', n, 'rows', r->'rows', 'purpose', purpose);
end $$;
revoke all on function public.vsat_leads_grid_export(jsonb) from public, anon;
grant execute on function public.vsat_leads_grid_export(jsonb) to authenticated;

comment on function public.vsat_leads_grid_list(jsonb) is
  'VSAT Leads grid: one page + dropdown counts (campus / stage / applied / source). Admin / active admissions; campus and column visibility checked here.';
comment on function public.vsat_leads_grid_export(jsonb) is
  'Whole filtered leads set (max 5,000) for CSV or Send Communication. Admin / active admissions only; every call is logged in vsat_grid_audit.';
