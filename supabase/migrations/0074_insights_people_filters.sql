-- 0074 · Insights — the people list behind a number now matches that number (QA findings M1, M2).
--
-- What was wrong:
--   M1  Overview funnel, "VSAT early registration" step shows MQRs who early-registered, but the
--       list it opened had every early registrant (MQR or not).
--   M2  Sources / States tabs with a product filter: a row counts users of that product IN THE
--       PERIOD, but the list it opened had that product's users of ALL TIME.
--
-- What changes: only public.ins_people gets two optional filters, added at the END so every
-- existing call (named or positional) behaves exactly as before:
--   p_mqr  boolean  true = MQRs only, false = non-MQRs only, null = everyone (as before)
--   p_used text     a product key (codesprint | bootcamp | pyq | cp | vsat). When set, [p_from, p_to)
--                   is the period in which the person USED that product (the same people as
--                   ins_products / ins_sources / ins_states count), instead of the sign-up period.
--                   null = sign-up period (as before).
-- A function's parameter list cannot be extended with CREATE OR REPLACE (it would add a second
-- version, which the API cannot choose between), so the old version is dropped and the new one
-- created in the same transaction, with the same security: SECURITY DEFINER, search_path '',
-- admin check first, execute for authenticated only.
-- Nothing else changes: no table, no other function, no grant.
--
-- Rollback: supabase/rollback/0074_insights_people_filters_down.sql (restores the 0062 version).
-- Tests:    supabase/tests/insights_people_filters.test.sql; the 0062 and 0068 suites must still pass.

drop function if exists public.ins_people(timestamptz, timestamptz, text[], int, text, text, text, boolean);

create function public.ins_people(
  p_from timestamptz, p_to timestamptz,
  p_products text[] default null,  -- must have used ALL of these (codesprint, bootcamp, pyq, cp)
  p_min_products int default null, -- at least this many products
  p_level text default null,       -- low | medium | high
  p_source text default null,      -- normalised source key
  p_state text default null,       -- state name (case-insensitive); 'Unknown' = blank
  p_vsat boolean default null,     -- true = VSAT early registered, false = not
  p_mqr boolean default null,      -- true = MQR only, false = not MQR (0074)
  p_used text default null         -- product whose use must fall in [p_from, p_to) (0074)
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
  if p_used is not null and p_used not in ('codesprint', 'bootcamp', 'pyq', 'cp', 'vsat') then
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
  where (
          -- sign-up period (default), or the period of using one product (p_used)
          (p_used is null and f.signup_at >= coalesce(p_from, '-infinity') and f.signup_at < coalesce(p_to, 'infinity'))
          or (p_used is not null and f.user_id in (select u.user_id from public.ins__product_users(p_used, p_from, p_to) u))
        )
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
    and (p_mqr is null or f.is_mqr = p_mqr)
  order by f.n_products desc, f.last_activity_at desc nulls last, f.user_id;
end $$;

revoke all on function public.ins_people(timestamptz, timestamptz, text[], int, text, text, text, boolean, boolean, text) from public, anon;
grant execute on function public.ins_people(timestamptz, timestamptz, text[], int, text, text, text, boolean, boolean, text) to authenticated;

-- let the API see the new parameter list straight away
notify pgrst, 'reload schema';
