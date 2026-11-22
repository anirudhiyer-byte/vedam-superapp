-- Rollback 0141 · restore the original vsat_payments write-once guard, then drop the admin
-- purge surface and the internal-email helper.
-- Guard body below is byte-for-byte the pre-0141 definition (md5 ed9b5c991bb3c3a39e8070fc14c4477e);
-- CREATE OR REPLACE preserves its ACL (postgres=X/postgres | service_role=X/postgres).
create or replace function public.vsat_payments_guard()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  v_sim boolean := coalesce(current_setting('vedam.allow_simulated_payments', true), '') = 'on'
                   and coalesce((select f.value from public.app_flags f where f.key = 'environment'), '') = 'staging';
begin
  if tg_op = 'INSERT' then
    if new.provider = 'simulated' and not v_sim then
      raise exception 'simulated payments are not allowed here' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.provider = 'simulated' and v_sim then
      return old;
    end if;
  end if;
  raise exception 'vsat_payments is write-once (% blocked)', tg_op using errcode = '42501';
end $function$;

drop function if exists public.vsat_admin_delete_application(uuid);
drop function if exists public.vsat_admin_delete_lead(uuid);
drop function if exists public.vsat__purge_person(uuid);
drop table if exists public.vsat_admin_deletions;
drop function if exists public.app__is_internal_email(text);
