-- Rollback for 0074_insights_people_filters.sql
-- Drops the 0074 version of ins_people (10 parameters) and restores the 0062 version
-- (8 parameters, copied from 0062) with the same grants. Safe to run while the page is open:
-- calls that pass p_mqr / p_used fail until the page code is rolled back too.

drop function if exists public.ins_people(timestamptz, timestamptz, text[], int, text, text, text, boolean, boolean, text);

create function public.ins_people(
  p_from timestamptz, p_to timestamptz,
  p_products text[] default null,  -- must have used ALL of these (codesprint, bootcamp, pyq, cp)
  p_min_products int default null, -- at least this many products
  p_level text default null,       -- low | medium | high
  p_source text default null,      -- normalised source key
  p_state text default null,       -- state name (case-insensitive); 'Unknown' = blank
  p_vsat boolean default null      -- true = VSAT early registered, false = not
)
returns setof jsonb
language plpgsql stable
security definer
set search_path to ''
as $$
begin
  perform public.ins__guard(p_from, p_to);
  if p_level is not null and p_level not in ('low', 'medium', 'high') then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
  if p_products is not null and not (p_products <@ array['codesprint', 'bootcamp', 'pyq', 'cp']) then
    raise exception 'product_invalid' using errcode = '22023';
  end if;

  return query
  select jsonb_build_object(
    'user_id', f.user_id, 'public_id', p.public_id, 'name', p.full_name, 'email', p.email, 'phone', p.phone,
    'signup_at', f.signup_at, 'source', f.src, 'state', coalesce(f.state, 'Unknown'),
    'full', f.is_full, 'mqr', f.is_mqr, 'n_products', f.n_products,
    'level', case when f.n_deep >= 2 then 'high' when f.n_deep = 1 then 'medium' else 'low' end,
    'codesprint', case when f.cs_at is null then null else jsonb_build_object(
        'since', f.cs_at, 'enrolled', f.cs_enrolled, 'lessons', f.cs_lessons, 'certs', f.cs_certs) end,
    'bootcamp', case when f.bc_at is null then null else jsonb_build_object(
        'since', f.bc_at, 'registered', f.bc_regs, 'attended', f.bc_attended, 'stayed', f.bc_stayed, 'projects', f.bc_projects) end,
    'pyq', case when f.pyq_at is null then null else jsonb_build_object(
        'since', f.pyq_at, 'started', f.pyq_attempts, 'submitted', f.pyq_submitted) end,
    'cp', case when f.cp_at is null then null else jsonb_build_object('since', f.cp_at, 'predictions', f.cp_uses) end,
    'vsat_at', f.vsat_at,
    'last_activity_at', f.last_activity_at)
  from public.ins__facts() f
  left join public.profiles p on p.id = f.user_id
  where f.signup_at >= coalesce(p_from, '-infinity') and f.signup_at < coalesce(p_to, 'infinity')
    and (p_products is null or (
          (not ('codesprint' = any(p_products)) or f.cs_at is not null) and
          (not ('bootcamp'   = any(p_products)) or f.bc_at is not null) and
          (not ('pyq'        = any(p_products)) or f.pyq_at is not null) and
          (not ('cp'         = any(p_products)) or f.cp_at is not null)))
    and (p_min_products is null or f.n_products >= p_min_products)
    and (p_level is null or p_level = case when f.n_deep >= 2 then 'high' when f.n_deep = 1 then 'medium' else 'low' end)
    and (p_source is null or f.src = public.ins__src(p_source))
    and (p_state is null or lower(coalesce(f.state, 'unknown')) = lower(btrim(p_state)))
    and (p_vsat is null or (f.vsat_at is not null) = p_vsat)
  order by f.n_products desc, f.last_activity_at desc nulls last, f.user_id;
end $$;

revoke all on function public.ins_people(timestamptz, timestamptz, text[], int, text, text, text, boolean) from public, anon;
grant execute on function public.ins_people(timestamptz, timestamptz, text[], int, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
