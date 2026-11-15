-- Rollback 0060 · Communication Manager Slice 1 (read-only functions).
-- Drops exactly the functions 0060 created. 0060 changed nothing that already existed,
-- so nothing has to be restored. Page functions first, then the private helpers they use.

drop function if exists public.comm_suppressions_counts(text, timestamptz, timestamptz, text);
drop function if exists public.comm_suppressions_list(text, text, timestamptz, timestamptz, text, text, text, int, int);
drop function if exists public.comm_performance(timestamptz, timestamptz, text, text);
drop function if exists public.comm_log_failures(uuid);
drop function if exists public.comm_log_recipients(uuid, text, timestamptz, timestamptz, text, text, text, int, int);
drop function if exists public.comm_log_get(uuid);
drop function if exists public.comm_logs_options(timestamptz, timestamptz);
drop function if exists public.comm_logs_list(timestamptz, timestamptz, text, text, text, text, text, text, text, text, int, int);

drop function if exists public.comm__optouts(text);
drop function if exists public.comm__jobs(timestamptz, timestamptz, uuid[]);
drop function if exists public.comm__messages(uuid[]);
drop function if exists public.comm__like(text);
drop function if exists public.comm__guard(timestamptz, timestamptz, int, int);
