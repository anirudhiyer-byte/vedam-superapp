-- Rollback 0183 · vsat__is_staff callable by signed-in users again (the 0104 grants).
revoke all on function public.vsat__is_staff() from public, anon;
grant execute on function public.vsat__is_staff() to authenticated;
grant execute on function public.vsat__is_staff() to service_role;
