-- 0169_vsat_admin_tools.sql
-- Admin tooling for the VSAT Application Manager:
--   * vsat_admin_audit        — append-only log of privileged admin writes below
--   * vsat_mock_reset         — re-enable the mock for one applicant (clears mock_* state)
--   * vsat_exam_scores_admin_list — admin-only view of exam/VSAT scores (never student-visible)
--   * vsat_application_admin_get   — full application row for the editor
--   * vsat_application_admin_update — edit any field of one application (IDs gated by confirmIds)
--
-- Security model (per CLAUDE.md): RLS on, no policies, all access through SECURITY
-- DEFINER functions with `set search_path to ''`, execute revoked from public/anon.
-- Writes are gated on is_admin() (full admin only — these are privileged mutations).
-- jsonb_populate_record() does type coercion against the real column types, so a
-- bad value (e.g. a non-enum string for a stage column) raises instead of corrupting.

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.vsat_admin_audit (
  id             bigint generated always as identity primary key,
  actor_id       uuid,
  actor_email    text,
  action         text not null,
  application_id text,
  lead_id        uuid,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists vsat_admin_audit_app_idx on public.vsat_admin_audit (application_id);
create index if not exists vsat_admin_audit_created_idx on public.vsat_admin_audit (created_at desc);

alter table public.vsat_admin_audit enable row level security;
revoke all on public.vsat_admin_audit from public, anon, authenticated;

-- Internal: record one audit row as the acting admin. Not browser-callable.
create or replace function public.vsat__admin_audit(p_action text, p_app text, p_lead uuid, p_detail jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare uid uuid := auth.uid(); em text;
begin
  select email into em from auth.users where id = uid;
  insert into public.vsat_admin_audit (actor_id, actor_email, action, application_id, lead_id, detail)
  values (uid, em, p_action, p_app, p_lead, coalesce(p_detail, '{}'::jsonb));
end $$;
revoke all on function public.vsat__admin_audit(text, text, uuid, jsonb) from public, anon, authenticated;

-- Columns that must NEVER be written through admin edit / bulk import — ownership
-- and immutable audit fields. Everything else is editable.
create or replace function public.vsat__am_locked_cols()
returns text[] language sql immutable set search_path to '' as $$
  select array['lead_id', 'created_at']::text[]
$$;
revoke all on function public.vsat__am_locked_cols() from public, anon, authenticated;

-- Internal: true when `col` is a real, writable column of application_manager.
create or replace function public.vsat__am_writable(col text)
returns boolean language sql stable set search_path to '' as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'application_manager' and column_name = col
  ) and not (col = any (public.vsat__am_locked_cols()))
$$;
revoke all on function public.vsat__am_writable(text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Re-enable the mock for one applicant
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.vsat_mock_reset(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  uid uuid := auth.uid();
  v_app text; v_lead uuid; v_prev jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb), array['applicationId', 'leadId']);

  v_app := nullif(p->>'applicationId', '');
  v_lead := nullif(p->>'leadId', '')::uuid;
  if v_app is null and v_lead is null then raise exception 'MISSING_TARGET' using errcode = '22023'; end if;

  select lead_id, application_id,
         jsonb_build_object('mock_given', mock_given, 'mock_assigned', mock_assigned,
                            'mock_launched_at', mock_launched_at, 'mock_result', mock_result,
                            'mock_percentile', mock_percentile, 'mock_sections', mock_sections)
    into v_lead, v_app, v_prev
    from public.application_manager
   where (v_app is not null and application_id = v_app) or (v_lead is not null and lead_id = v_lead)
   limit 1;
  if v_lead is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  update public.application_manager
     set mock_given = false, mock_assigned = false, mock_launched_at = null,
         mock_result = null, mock_percentile = null, mock_sections = null
   where lead_id = v_lead;

  -- Ledger rows in vsat_exam_results are kept on purpose (audit trail of past attempts).
  perform public.vsat__admin_audit('mock_reset', v_app, v_lead, jsonb_build_object('previous', v_prev));
  return jsonb_build_object('ok', true, 'applicationId', v_app);
end $$;
revoke all on function public.vsat_mock_reset(jsonb) from public, anon;
grant execute on function public.vsat_mock_reset(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Admin-only exam / VSAT score view (raw marks are never sent to students)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.vsat_exam_scores_admin_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  uid uuid := auth.uid();
  v_q text; v_like text; v_limit int; v_offset int; total int; rows jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb), array['q', 'limit', 'offset']);

  v_q := nullif(btrim(p->>'q'), '');
  v_like := '%' || lower(v_q) || '%';
  v_limit := least(greatest(coalesce((p->>'limit')::int, 50), 1), 200);
  v_offset := greatest(coalesce((p->>'offset')::int, 0), 0);

  select count(*) into total
    from public.application_manager am
   where v_q is null
      or lower(am.application_id) like v_like
      or lower(coalesce(am.registered_name, '')) like v_like
      or lower(coalesce(am.registered_email, '')) like v_like
      or coalesce(am.registered_mobile, '') like '%' || v_q || '%'
      or lower(coalesce(am.wheebox_login_id, '')) like v_like;

  select coalesce(jsonb_agg(r order by r_sort desc), '[]'::jsonb) into rows from (
    select to_jsonb(x) - 'r_sort' as r, x.r_sort from (
      select am.application_id, am.registered_name, am.registered_email, am.registered_mobile,
             am.wheebox_login_id, am.campus_applied,
             am.mock_given, am.mock_percentile, am.mock_result,
             am.exam_given, am.exam_overall, am.exam_obtained_marks, am.exam_max_marks,
             am.exam_percentile, am.exam_sections,
             am.vsat_appeared_1, am.vsat_score_lr_1, am.vsat_score_maths_1, am.vsat_score_cs_1,
             am.vsat_total_1, am.vsat_percentile_1, am.vps_score_1, am.vsat_result_1,
             am.vsat_appeared_2, am.vsat_score_lr_2, am.vsat_score_maths_2, am.vsat_score_cs_2,
             am.vsat_total_2, am.vsat_percentile_2, am.vps_score_2, am.vsat_result_2,
             am.vps_score,
             coalesce(am.last_updated_date, am.created_at) as r_sort
        from public.application_manager am
       where v_q is null
          or lower(am.application_id) like v_like
          or lower(coalesce(am.registered_name, '')) like v_like
          or lower(coalesce(am.registered_email, '')) like v_like
          or coalesce(am.registered_mobile, '') like '%' || v_q || '%'
          or lower(coalesce(am.wheebox_login_id, '')) like v_like
       order by r_sort desc
       limit v_limit offset v_offset
    ) x
  ) y;

  return jsonb_build_object('ok', true, 'total', total, 'limit', v_limit, 'offset', v_offset, 'rows', rows);
end $$;
revoke all on function public.vsat_exam_scores_admin_list(jsonb) from public, anon;
grant execute on function public.vsat_exam_scores_admin_list(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Full application row for the editor
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.vsat_application_admin_get(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  uid uuid := auth.uid();
  v_app text; v_lead uuid; v_row jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb), array['applicationId', 'leadId']);

  v_app := nullif(p->>'applicationId', '');
  v_lead := nullif(p->>'leadId', '')::uuid;
  if v_app is null and v_lead is null then raise exception 'MISSING_TARGET' using errcode = '22023'; end if;

  select to_jsonb(am) into v_row from public.application_manager am
   where (v_app is not null and am.application_id = v_app) or (v_lead is not null and am.lead_id = v_lead)
   limit 1;
  if v_row is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  return jsonb_build_object('ok', true, 'row', v_row, 'locked', to_jsonb(public.vsat__am_locked_cols()));
end $$;
revoke all on function public.vsat_application_admin_get(jsonb) from public, anon;
grant execute on function public.vsat_application_admin_get(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Edit any field(s) of one application
--   p = { applicationId|leadId, changes: { col: value, ... }, confirmIds?: bool }
--   Blank string values are treated as explicit NULL only when the key is present.
--   Changing application_id / wheebox_login_id requires confirmIds=true.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.vsat_application_admin_update(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  uid uuid := auth.uid();
  v_app text; v_lead uuid; v_changes jsonb; v_confirm boolean;
  k text; set_clause text; v_before jsonb; v_before_subset jsonb; n int;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb), array['applicationId', 'leadId', 'changes', 'confirmIds']);

  v_app := nullif(p->>'applicationId', '');
  v_lead := nullif(p->>'leadId', '')::uuid;
  v_changes := p->'changes';
  v_confirm := coalesce((p->>'confirmIds')::boolean, false);
  if v_app is null and v_lead is null then raise exception 'MISSING_TARGET' using errcode = '22023'; end if;
  if v_changes is null or jsonb_typeof(v_changes) <> 'object' or v_changes = '{}'::jsonb then
    raise exception 'NO_CHANGES' using errcode = '22023';
  end if;

  -- Validate every target column; reject unknown / locked columns.
  for k in select jsonb_object_keys(v_changes) loop
    if not public.vsat__am_writable(k) then
      raise exception 'BAD_COLUMN: %', k using errcode = '22023';
    end if;
  end loop;
  -- Identity columns need an explicit confirm.
  if (v_changes ? 'application_id' or v_changes ? 'wheebox_login_id') and not v_confirm then
    raise exception 'CONFIRM_IDS' using errcode = '22023';
  end if;

  select lead_id, application_id, to_jsonb(am) into v_lead, v_app, v_before
    from public.application_manager am
   where (v_app is not null and am.application_id = v_app) or (v_lead is not null and am.lead_id = v_lead)
   limit 1;
  if v_lead is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  set_clause := (select string_agg(format('%I = j.%I', key, key), ', ') from jsonb_object_keys(v_changes) as key);
  execute format(
    'update public.application_manager am set %s, last_updated_date = now()
       from (select (jsonb_populate_record(null::public.application_manager, $1)).*) j
      where am.lead_id = $2', set_clause)
  using v_changes, v_lead;
  get diagnostics n = row_count;

  v_before_subset := (select jsonb_object_agg(key, v_before->key) from jsonb_object_keys(v_changes) as key);
  perform public.vsat__admin_audit('application_update', v_app, v_lead,
    jsonb_build_object('changed', v_changes, 'before', v_before_subset, 'confirmIds', v_confirm));
  return jsonb_build_object('ok', true, 'applicationId', v_app, 'updated', n);
end $$;
revoke all on function public.vsat_application_admin_update(jsonb) from public, anon;
grant execute on function public.vsat_application_admin_update(jsonb) to authenticated;
