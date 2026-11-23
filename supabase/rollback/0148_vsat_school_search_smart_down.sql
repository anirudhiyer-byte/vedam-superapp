-- Rollback 0148 · restore the 0042 vsat_school_search (plain ILIKE on schname) and drop the compact index.
drop index if exists public.school_database_compact_trgm;

create or replace function public.vsat_school_search(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  v_q text; v_lim int; v_rows jsonb; k text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('q','limit') then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  end loop;
  v_q := btrim(coalesce(p->>'q',''));
  if char_length(v_q) < 2 then return jsonb_build_object('ok', true, 'schools', '[]'::jsonb); end if;
  v_lim := least(greatest(coalesce((p->>'limit')::int, 20), 1), 30);

  select coalesce(jsonb_agg(r order by r->>'name'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'code', s.schcd,
             'name', s.schname,
             'district', coalesce(nullif(s.dtname,''), s.dtname_1),
             'state', coalesce(nullif(s.stname,''), s.stname_1)) as r
    from public.school_database s
    where s.schname is not null and s.schname ilike '%' || v_q || '%'
    order by (s.schname ilike v_q || '%') desc, length(s.schname), s.schname
    limit v_lim
  ) q;

  return jsonb_build_object('ok', true, 'schools', v_rows);
end $fn$;

revoke all on function public.vsat_school_search(jsonb) from public, anon;
grant execute on function public.vsat_school_search(jsonb) to authenticated;
