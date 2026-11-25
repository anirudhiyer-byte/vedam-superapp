-- Rollback 0178 · restore the grants vsat__app_prepaid_reflect had after 0172 (PUBLIC, anon, authenticated, service_role).
grant execute on function public.vsat__app_prepaid_reflect() to public, anon, authenticated, service_role;
