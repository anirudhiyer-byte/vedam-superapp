-- 0129 · Insights — source × product split and the path from products to the VSAT application
--
-- Asked for (manager, 20 Nov 2026): (1) every product's split by source, with the count and the share,
-- and the same for Vedam One as a whole; (2) how many people use 1 / 2 / 3+ products and how many of
-- them then filled the VSAT form or registered; (3) as much depth as the data allows.
--
-- What this adds: ONE new read-only function, public.ins_funnel(p_from, p_to). Nothing existing is
-- changed: no table, column, index, policy, trigger, grant or existing function is touched.
-- It reads ins__facts() ONCE for all three views (the existing ins_sources would need 6 calls, each
-- one rebuilding the facts, to make the same matrix).
--
-- Definitions (the same as the existing Insights functions, so the numbers reconcile):
--   * cohort  = people who signed up in the period (= ins_cross / ins_sources 'all')
--   * source  = first-touch profiles.utm_source through ins__src ('unknown' when blank)
--   * product users in the period = ins__product_users (= ins_sources with that product);
--     CodeSprint uses ins__facts.cs_at, exactly the codesprint branch of ins__product_users
--   * n_products = ins__facts.n_products (CodeSprint, Bootcamp, PYQ, College Predictor)
--   * VSAT steps for the cohort, reached at ANY time (like vsat_early in ins_cross):
--       vsat_early     = ins__facts.vsat_at (VSAT early registration)
--       applied        = has an application_manager row (started a VSAT application)
--       form_submitted = an application with form_stage_1 = 'form_submitted'
--       fee_paid       = has a vsat_payments row (the only source of truth for "paid", see CLAUDE.md)
--       exam_taken     = an application with exam_given = true
--       enrolled       = an application with enrollment_paid_at set (enrolment fee paid)
--
-- Returns: { cohort,
--            matrix:      [{source, all, codesprint, bootcamp, pyq, cp, vsat}],   -- counts per source
--            by_products: [{n, users, mqr, vsat_early, applied, form_submitted, fee_paid, exam_taken, enrolled}],
--            by_source:   [{source, users, mqr, vsat_early, applied, form_submitted, fee_paid, exam_taken, enrolled}] }
--
-- Security (same as every ins_* function, 0062): SECURITY DEFINER, search_path '', first statement
-- ins__guard (admin only → 42501; period checks → 22023), STABLE (cannot write),
-- execute revoked from public / anon, granted to authenticated only.
--
-- Rollback: supabase/rollback/0129_insights_funnel_down.sql
-- Tests:    supabase/tests/insights_funnel.test.sql (staging only, rolls itself back)

create or replace function public.ins_funnel(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
declare v jsonb;
begin
  perform public.ins__guard(p_from, p_to);

  with f as materialized (select * from public.ins__facts()),
  app as (  -- furthest VSAT application step per person (any attempt, any time)
    select a.lead_id as user_id,
           bool_or(a.form_stage_1::text = 'form_submitted') as form_submitted,
           bool_or(coalesce(a.exam_given, false)) as exam_taken,
           bool_or(a.enrollment_paid_at is not null) as enrolled
    from public.application_manager a
    group by a.lead_id
  ),
  paid as (select distinct p.lead_id as user_id from public.vsat_payments p),
  c as materialized (  -- the cohort: signed up in the period
    select f.user_id, f.src, f.is_mqr, f.n_products,
           (f.vsat_at is not null) as vsat_early,
           (app.user_id is not null) as applied,
           coalesce(app.form_submitted, false) as form_submitted,
           (paid.user_id is not null) as fee_paid,
           coalesce(app.exam_taken, false) as exam_taken,
           coalesce(app.enrolled, false) as enrolled
    from f
    left join app on app.user_id = f.user_id
    left join paid on paid.user_id = f.user_id
    where f.signup_at >= coalesce(p_from, '-infinity') and f.signup_at < coalesce(p_to, 'infinity')
  ),
  used as (  -- product users in the period (same people as ins_sources with that product)
    select f.user_id, 'codesprint'::text as product from f
     where f.cs_at >= coalesce(p_from, '-infinity') and f.cs_at < coalesce(p_to, 'infinity')
    union all select u.user_id, 'bootcamp' from public.ins__product_users('bootcamp', p_from, p_to) u
    union all select u.user_id, 'pyq'      from public.ins__product_users('pyq', p_from, p_to) u
    union all select u.user_id, 'cp'       from public.ins__product_users('cp', p_from, p_to) u
    union all select u.user_id, 'vsat'     from public.ins__product_users('vsat', p_from, p_to) u
  ),
  used_src as (  -- only people with a profile, like ins_sources (it filters ins__facts)
    select f.src, u.product, count(*) as users
    from used u join f on f.user_id = u.user_id
    group by f.src, u.product
  ),
  all_src as (select c.src, count(*) as users from c group by c.src),
  srcs as (select src from all_src union select src from used_src)
  select jsonb_build_object(
    'cohort', (select count(*) from c),
    'matrix', (
      -- biggest Vedam One sources first; product-only sources (no sign-ups in the period) after, by product users
      select coalesce(jsonb_agg(m.row order by m.all_users desc, m.product_users desc, m.src), '[]'::jsonb) from (
        select s.src,
               coalesce(a.users, 0) as all_users,
               coalesce(sum(us.users), 0) as product_users,
               jsonb_build_object(
                 'source', s.src,
                 'all', coalesce(a.users, 0),
                 'codesprint', coalesce(sum(us.users) filter (where us.product = 'codesprint'), 0),
                 'bootcamp',   coalesce(sum(us.users) filter (where us.product = 'bootcamp'), 0),
                 'pyq',        coalesce(sum(us.users) filter (where us.product = 'pyq'), 0),
                 'cp',         coalesce(sum(us.users) filter (where us.product = 'cp'), 0),
                 'vsat',       coalesce(sum(us.users) filter (where us.product = 'vsat'), 0)) as row
        from srcs s
        left join all_src a on a.src = s.src
        left join used_src us on us.src = s.src
        group by s.src, a.users
      ) m),
    'by_products', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'n', k.n, 'users', k.users, 'mqr', k.mqr, 'vsat_early', k.vsat_early, 'applied', k.applied,
               'form_submitted', k.form_submitted, 'fee_paid', k.fee_paid, 'exam_taken', k.exam_taken, 'enrolled', k.enrolled)
             order by k.n), '[]'::jsonb)
      from (select c.n_products as n, count(*) as users,
                   count(*) filter (where c.is_mqr) as mqr,
                   count(*) filter (where c.vsat_early) as vsat_early,
                   count(*) filter (where c.applied) as applied,
                   count(*) filter (where c.form_submitted) as form_submitted,
                   count(*) filter (where c.fee_paid) as fee_paid,
                   count(*) filter (where c.exam_taken) as exam_taken,
                   count(*) filter (where c.enrolled) as enrolled
            from c group by c.n_products) k),
    'by_source', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'source', k.src, 'users', k.users, 'mqr', k.mqr, 'vsat_early', k.vsat_early, 'applied', k.applied,
               'form_submitted', k.form_submitted, 'fee_paid', k.fee_paid, 'exam_taken', k.exam_taken, 'enrolled', k.enrolled)
             order by k.users desc, k.src), '[]'::jsonb)
      from (select c.src, count(*) as users,
                   count(*) filter (where c.is_mqr) as mqr,
                   count(*) filter (where c.vsat_early) as vsat_early,
                   count(*) filter (where c.applied) as applied,
                   count(*) filter (where c.form_submitted) as form_submitted,
                   count(*) filter (where c.fee_paid) as fee_paid,
                   count(*) filter (where c.exam_taken) as exam_taken,
                   count(*) filter (where c.enrolled) as enrolled
            from c group by c.src) k)
  ) into v;
  return v;
end $$;

revoke all on function public.ins_funnel(timestamptz, timestamptz) from public, anon;
grant execute on function public.ins_funnel(timestamptz, timestamptz) to authenticated;
