-- Apply the question → application_manager column/cast mapping to a VSAT form's schema.
--
-- Purely additive: it sets "column" and "cast" on each mapped question in vsat_forms.schema
-- (questions the applicant sees are unchanged). vsat_form_save_category (0102) then writes
-- each mapped answer into its real column on save; form_data stays the source of truth.
--
-- Deploy order: 0101 (adds jee_percentile, olympiad1_year) → 0102 (sync function) → this.
-- Set :form_id to the target form before running, and run the verification SELECT (see
-- docs) in a rolled-back transaction first. Re-running is safe (idempotent).
-- Applied to production form fb1ea260-4c16-45fc-bc92-6e9116904676 ("VSAT 2027 Applications").

create or replace function pg_temp.map_qs(qs jsonb, m jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(
    case when m ? (q->>'key')
      then q || jsonb_build_object('column', m->(q->>'key')->>'column', 'cast', m->(q->>'key')->>'cast')
      else q end), '[]'::jsonb)
  from jsonb_array_elements(qs) q
$$;
create or replace function pg_temp.apply_map(sch jsonb, m jsonb) returns jsonb language sql as $$
  select jsonb_set(sch, '{categories}', (
    select jsonb_agg(
      (c || jsonb_build_object('questions', pg_temp.map_qs(coalesce(c->'questions','[]'::jsonb), m)))
      || case when c ? 'subcategories'
           then jsonb_build_object('subcategories', (
             select jsonb_agg(sc || jsonb_build_object('questions', pg_temp.map_qs(coalesce(sc->'questions','[]'::jsonb), m)))
             from jsonb_array_elements(c->'subcategories') sc))
           else '{}'::jsonb end)
    from jsonb_array_elements(sch->'categories') c))
$$;

update public.vsat_forms set schema = pg_temp.apply_map(schema, $qmap$
{
 "gender":{"column":"gender","cast":"text"},
 "dob":{"column":"date_of_birth","cast":"date"},
 "guardian_mobile_number":{"column":"guardian_mobile_number","cast":"text"},
 "currently_residing_in_city":{"column":"residing_city","cast":"text"},
 "country":{"column":"country","cast":"text"},
 "state":{"column":"state","cast":"text"},
 "city":{"column":"city","cast":"text"},
 "have_you_registered_for_jee_mains":{"column":"jee_registered","cast":"bool"},
 "q_mn87sdi":{"column":"jee_main_maths_percentile","cast":"number"},
 "enter_your_jee_mains_percentile":{"column":"jee_percentile","cast":"number"},
 "when_did_you_register_for_jee_mains":{"column":"jee_appeared_when","cast":"text"},
 "year_of_passing_10th_class":{"column":"class10_year","cast":"year"},
 "marking_scheme_10th_class":{"column":"class10_marking_scheme","cast":"text"},
 "score_slabs_cgpa":{"column":"class10_score","cast":"text"},
 "score_slabs_percentage":{"column":"class10_score","cast":"text"},
 "score_slabs_grade":{"column":"class10_score","cast":"text"},
 "year_of_passing_12th_class":{"column":"class12_year","cast":"year"},
 "q_iwquu6f":{"column":"class12_marking_scheme","cast":"text"},
 "q_l9jj3tv":{"column":"class12_score","cast":"text"},
 "q_g77t9fr":{"column":"class12_score","cast":"text"},
 "q_xrhvuv4":{"column":"class12_score","cast":"text"},
 "have_you_studied_pcm":{"column":"studied_pcm","cast":"bool"},
 "10th_class_maths_score":{"column":"class10_maths_score","cast":"text"},
 "10th_class_maths_percentage":{"column":"class10_maths_percentage","cast":"number"},
 "10th_class_percentage":{"column":"class10_percentage","cast":"number"},
 "board_name":{"column":"class10_board","cast":"text"},
 "school_name":{"column":"class10_school","cast":"text"},
 "12th_class_chemistry_marks":{"column":"marks_chemistry_12","cast":"number"},
 "12th_class_percentage":{"column":"class12_percentage","cast":"number"},
 "if_yes_how_was_your_experience_describe_it_briefly":{"column":"cs_experience","cast":"text"},
 "school_name_1":{"column":"class12_school","cast":"text"},
 "board_name_2":{"column":"class12_board","cast":"text"},
 "have_you_studied_computer_science":{"column":"studied_cs","cast":"bool"},
 "12th_class_maths_percentage":{"column":"class12_maths_percentage","cast":"number"},
 "12th_class_maths_marks":{"column":"marks_maths_12","cast":"number"},
 "12th_class_physics_marks":{"column":"marks_physics_12","cast":"number"},
 "q_u2zcajm":{"column":"coding1_rank","cast":"text"},
 "q_1":{"column":"participated_olympiad","cast":"bool"},
 "q_6tlmds0":{"column":"olympiad1_name","cast":"text"},
 "q_n1ku4dr":{"column":"olympiad1_year","cast":"year"},
 "q_9wt6of9":{"column":"olympiad1_marks","cast":"text"},
 "q_12grkuo":{"column":"olympiad1_intl_rank","cast":"text"},
 "q_3jb84dq":{"column":"taken_coding_exam","cast":"bool"},
 "q_852eo2u":{"column":"coding1_name","cast":"text"},
 "q_wvs5mb2":{"column":"coding1_year","cast":"year"},
 "q_zrqtnqb":{"column":"coding1_percentile","cast":"number"},
 "mother_s_email_id":{"column":"mother_email","cast":"text"},
 "mother_s_mobile_number":{"column":"mother_mobile","cast":"text"},
 "mother_s_name":{"column":"mother_name","cast":"text"},
 "mother_s_title":{"column":"mother_title","cast":"text"},
 "father_s_occupation":{"column":"father_occupation","cast":"text"},
 "father_s_email_id":{"column":"father_email","cast":"text"},
 "father_s_mobile_number":{"column":"father_mobile","cast":"text"},
 "father_s_name":{"column":"father_name","cast":"text"},
 "father_s_title":{"column":"father_title","cast":"text"},
 "family_income_yearly":{"column":"family_income","cast":"text"},
 "mother_s_occupation":{"column":"mother_occupation","cast":"text"},
 "select_the_id_you_want_to_upload":{"column":"selected_id_type","cast":"text"},
 "i_hereby_declare_that_the_above_information_is_true_and_complete_to_the_best_of_my_knowledge_i_am_aware_that_if_any_information_herein_is_found_to_be_incorect_or_incomplete_at_any_stage_of_admission_process_my_application_form_will_be_rejected_and_my_claim_for_this_admission_will_be_forfeited":{"column":"declaration_accepted","cast":"bool"}
}
$qmap$::jsonb)
where id = :'form_id';
