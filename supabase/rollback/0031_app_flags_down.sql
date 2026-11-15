-- Rollback for 0031_app_flags.sql
-- Run 0033 and 0032 rollbacks first (0033's functions read this table).
drop table if exists public.app_flags;
