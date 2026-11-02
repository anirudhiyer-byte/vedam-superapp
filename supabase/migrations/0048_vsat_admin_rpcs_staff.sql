-- 0048 · VSAT admin RPCs honor vsat_is_staff() (not only the is_admin role)
--
-- So a confirmed @vedam.org login can use the VSAT Admin Panel cards (Form Builder,
-- Exam Center, Exam Dates) and the bulk-result action WITHOUT an is_admin role grant
-- — the same staff definition introduced in 0047, matching the page gates. These
-- functions previously returned FORBIDDEN for @vedam.org users who aren't is_admin.
--
-- Mechanism: regenerate each listed function from its current definition, replacing
-- its `public.is_admin()` guard with `public.vsat_is_staff()`. CREATE OR REPLACE
-- keeps the body and the existing grants/revokes. Idempotent (no is_admin() left to
-- replace on a second run). Requires vsat_is_staff() from 0047.
--
-- Rollback: supabase/rollback/0048_vsat_admin_rpcs_staff_down.sql

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
    def := replace(def, 'public.is_admin()', 'public.vsat_is_staff()');
    execute def;
  end loop;
end $mig$;
