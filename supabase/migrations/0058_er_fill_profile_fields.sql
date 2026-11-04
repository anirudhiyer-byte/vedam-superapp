-- 0058 · Safety net: every event_registration carries the registrant's own profile
-- stream + passout year. A BEFORE INSERT trigger fills er.stream / er.passout_year
-- from public.profiles when the inserted row leaves them blank, so the registrants
-- view and the Growth → Events MQL can never silently go blank again, whatever code
-- path (registration form, paid-event webhook, direct API) creates the row.
--
-- It only ever FILLS blanks — a value explicitly supplied on the insert is left as-is.

create or replace function public.er_fill_profile_fields()
returns trigger
language plpgsql
security definer
set search_path to ''
as $fn$
begin
  if new.user_id is not null then
    if nullif(btrim(coalesce(new.stream, '')), '') is null then
      select p.stream into new.stream
      from public.profiles p where p.id = new.user_id;
    end if;
    if nullif(btrim(coalesce(new.passout_year, '')), '') is null then
      select case when p.grad_year is not null then p.grad_year::text else null end
      into new.passout_year
      from public.profiles p where p.id = new.user_id;
    end if;
  end if;
  return new;
end;
$fn$;

revoke execute on function public.er_fill_profile_fields() from public, anon, authenticated;

drop trigger if exists trg_er_fill_profile on public.event_registrations;
create trigger trg_er_fill_profile
  before insert on public.event_registrations
  for each row execute function public.er_fill_profile_fields();
