-- Rollback for 0062_insights_dashboards.sql
-- Drops exactly the functions 0062 added. 0062 changed nothing else, so nothing else is restored.

drop function if exists public.ins_active(int);
drop function if exists public.ins_people(timestamptz, timestamptz, text[], int, text, text, text, boolean);
drop function if exists public.ins_cross(timestamptz, timestamptz);
drop function if exists public.ins_states(timestamptz, timestamptz, text);
drop function if exists public.ins_sources(timestamptz, timestamptz, text);
drop function if exists public.ins_products(timestamptz, timestamptz);
drop function if exists public.ins_overview(timestamptz, timestamptz);

drop function if exists public.ins__spend_by_source();
drop function if exists public.ins__spend(text);
drop function if exists public.ins__visitors(text, timestamptz, timestamptz);
drop function if exists public.ins__product_users(text, timestamptz, timestamptz);
drop function if exists public.ins__facts();
drop function if exists public.ins__src(text);
drop function if exists public.ins__guard(timestamptz, timestamptz);
