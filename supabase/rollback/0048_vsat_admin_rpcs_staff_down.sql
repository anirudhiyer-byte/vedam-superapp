-- Rollback 0048 · restore the VSAT admin RPCs' guard from vsat_is_staff() back to
-- is_admin(). Exact inverse of the up migration's text replacement.

do $mig$
declare s text; def text;
begin
  foreach s in array array[
    'public.vsat_forms_admin_list()',
    'public.vsat_form_get(uuid)',
    'public.vsat_form_upsert(jsonb)',
    'public.vsat_form_set_status(jsonb)',
    'public.vsat_form_active_for_fill()',
    'public.vsat_exam_settings_get()',
    'public.vsat_exam_settings_set(jsonb)',
    'public.vsat_exam_date_upsert(jsonb)',
    'public.vsat_exam_date_set_enabled(jsonb)',
    'public.vsat_exam_dates_admin_list()',
    'public.vsat_exam_bulk_result(jsonb)'
  ]
  loop
    def := pg_get_functiondef(s::regprocedure);
    def := replace(def, 'public.vsat_is_staff()', 'public.is_admin()');
    execute def;
  end loop;
end $mig$;
