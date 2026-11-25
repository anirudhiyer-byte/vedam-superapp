-- 0170_vsat_app_bulk_update.sql
-- Flexible admin bulk importer for the VSAT Application Manager (fallback to the Wheebox
-- callback / manual score entry). Admin uploads a CSV, maps any sheet header to any
-- writable application_manager column, and picks the match-key column per upload.
--
--   p = {
--     matchKey : one of application_id | application_no | registered_email
--                | registered_mobile | wheebox_login_id | lead_id,
--     mode     : 'dry_run' (default, writes nothing) | 'commit',
--     rows     : [ { "key": "<match value>", "values": { "<col>": <val>, ... } }, ... ]
--   }
--
-- Safety: is_admin() only; blank value cells are SKIPPED (never wiped); a blank or
-- duplicated key is reported unmatched/ambiguous (never guessed); unknown/locked
-- target columns are rejected per row; each row's write is isolated so one bad value
-- (e.g. a non-numeric mark) fails only that row. jsonb_populate_record coerces values
-- to the real column types. Every import writes one audit row.

create or replace function public.vsat_app_bulk_update(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  uid uuid := auth.uid();
  v_key text; v_mode text; v_rows jsonb; v_row jsonb;
  allowed_keys text[] := array['application_id','application_no','registered_email','registered_mobile','wheebox_login_id','lead_id'];
  seen jsonb := '{}'::jsonb;
  kv text; v_vals jsonb; v_leads uuid[]; v_lead uuid; set_clause text; k text;
  total int := 0; matched int := 0; updated int := 0; unmatched int := 0; ambiguous int := 0; errored int := 0;
  samples jsonb := '[]'::jsonb; outcome text; bad text; cols text[]; n int;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb), array['matchKey','mode','rows']);

  v_key := p->>'matchKey';
  v_mode := coalesce(nullif(p->>'mode',''), 'dry_run');
  v_rows := p->'rows';
  if v_key is null or not (v_key = any(allowed_keys)) then raise exception 'BAD_MATCH_KEY' using errcode = '22023'; end if;
  if v_mode not in ('dry_run','commit') then raise exception 'BAD_MODE' using errcode = '22023'; end if;
  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then raise exception 'NO_ROWS' using errcode = '22023'; end if;

  -- count key occurrences within the sheet (to flag in-sheet duplicates)
  select coalesce(jsonb_object_agg(kk, c), '{}'::jsonb) into seen from (
    select btrim(e->>'key') kk, count(*) c
      from jsonb_array_elements(v_rows) e
     where btrim(coalesce(e->>'key','')) <> ''
     group by 1
  ) s;

  for v_row in select * from jsonb_array_elements(v_rows) loop
    total := total + 1;
    outcome := null; v_lead := null; v_leads := null;
    kv := btrim(coalesce(v_row->>'key',''));

    -- strip blank / null value cells
    v_vals := (
      select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        from jsonb_each(coalesce(v_row->'values','{}'::jsonb)) as e
       where jsonb_typeof(e.value) <> 'null'
         and not (jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') = '')
    );

    if kv = '' then
      outcome := 'unmatched:blank_key'; unmatched := unmatched + 1;
    elsif (seen->>kv)::int > 1 then
      outcome := 'ambiguous:duplicate_in_sheet'; ambiguous := ambiguous + 1;
    else
      -- resolve the student
      begin
        if v_key = 'registered_email' then
          execute format('select array_agg(lead_id) from public.application_manager where lower(%I) = lower($1)', v_key) using kv into v_leads;
        elsif v_key = 'lead_id' then
          execute 'select array_agg(lead_id) from public.application_manager where lead_id = $1::uuid' using kv into v_leads;
        else
          execute format('select array_agg(lead_id) from public.application_manager where %I = $1', v_key) using kv into v_leads;
        end if;
      exception when others then
        v_leads := null;
      end;

      if v_leads is null or array_length(v_leads,1) is null then
        outcome := 'unmatched:no_match'; unmatched := unmatched + 1;
      elsif array_length(v_leads,1) > 1 then
        outcome := 'ambiguous:multiple_rows'; ambiguous := ambiguous + 1;
      else
        v_lead := v_leads[1];
        -- validate target columns
        bad := null;
        for k in select jsonb_object_keys(v_vals) loop
          if not public.vsat__am_writable(k) then bad := k; exit; end if;
        end loop;
        if bad is not null then
          outcome := 'error:bad_column:' || bad; errored := errored + 1;
        elsif v_vals = '{}'::jsonb then
          outcome := 'matched:no_values'; matched := matched + 1;
        else
          matched := matched + 1;
          if v_mode = 'commit' then
            begin
              set_clause := (select string_agg(format('%I = j.%I', key, key), ', ') from jsonb_object_keys(v_vals) as key);
              execute format(
                'update public.application_manager am set %s, last_updated_date = now()
                   from (select (jsonb_populate_record(null::public.application_manager, $1)).*) j
                  where am.lead_id = $2', set_clause)
              using v_vals, v_lead;
              updated := updated + 1; outcome := 'updated';
            exception when others then
              outcome := 'error:' || sqlerrm; errored := errored + 1; matched := matched - 1;
            end;
          else
            outcome := 'would_update';
          end if;
        end if;
      end if;
    end if;

    if jsonb_array_length(samples) < 50 then
      cols := (select array_agg(key) from jsonb_object_keys(v_vals) as key);
      samples := samples || jsonb_build_object('row', total, 'key', kv, 'outcome', outcome, 'cols', to_jsonb(coalesce(cols,'{}'::text[])));
    end if;
  end loop;

  perform public.vsat__admin_audit('bulk_update', null, null, jsonb_build_object(
    'matchKey', v_key, 'mode', v_mode, 'total', total, 'matched', matched, 'updated', updated,
    'unmatched', unmatched, 'ambiguous', ambiguous, 'errored', errored));

  return jsonb_build_object('ok', true, 'mode', v_mode, 'total', total, 'matched', matched,
    'updated', updated, 'unmatched', unmatched, 'ambiguous', ambiguous, 'errored', errored,
    'samples', samples);
end $$;
revoke all on function public.vsat_app_bulk_update(jsonb) from public, anon;
grant execute on function public.vsat_app_bulk_update(jsonb) to authenticated;
