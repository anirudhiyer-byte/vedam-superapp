-- Rollback 0108 · Growth Season Dashboard.
-- Removes the two public functions and the five private helpers. No table, column or existing function was changed by 0108.

drop function if exists public.growth_season_drill(jsonb);
drop function if exists public.growth_season_counts(jsonb);
drop function if exists public.growth__season_rows(text, date, date, date);
drop function if exists public.growth__season_ids(text, date, date, date);
drop function if exists public.growth__season_window(jsonb);
drop function if exists public.growth__like_esc(text);
drop function if exists public.growth__season_cols(text);
