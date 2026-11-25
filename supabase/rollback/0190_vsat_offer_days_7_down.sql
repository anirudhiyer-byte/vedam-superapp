-- Rollback of 0190 · puts back each campus's offer_days as it was before 0190 (read from the column comment that 0190
-- wrote), then removes the comment. If the comment is missing, nothing is changed.

do $m$
declare v_c text; v_prev jsonb;
begin
  v_c := col_description('public.vsat_campus_settings'::regclass,
           (select a.attnum from pg_catalog.pg_attribute a
             where a.attrelid = 'public.vsat_campus_settings'::regclass and a.attname = 'offer_days')::int);
  if v_c is null or position('Before 0190: ' in v_c) = 0 then
    raise notice '0190 rollback: no 0190 comment, nothing to do';
    return;
  end if;
  v_prev := substr(v_c, position('Before 0190: ' in v_c) + length('Before 0190: '))::jsonb;
  update public.vsat_campus_settings s
     set offer_days = (v_prev->>s.campus)::int, updated_at = now()
   where v_prev ? s.campus and s.offer_days is distinct from (v_prev->>s.campus)::int;
  comment on column public.vsat_campus_settings.offer_days is null;
end $m$;
