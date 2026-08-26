-- ============================================================
-- Vedam Superapp — Login tracking RPC
-- Increments login_count + stamps last_login_at for the current user.
-- Called from the app on successful login (and re-used anywhere a
-- "session started" should be recorded). SECURITY DEFINER so it can
-- update the caller's own profile row under RLS.
-- Paired rollback: login-tracking-rollback.sql
-- ============================================================

create or replace function public.record_login()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set login_count   = login_count + 1,
         last_login_at = now()
   where id = auth.uid();
$$;

grant execute on function public.record_login() to authenticated;
