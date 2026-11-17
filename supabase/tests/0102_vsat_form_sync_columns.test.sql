-- 0102 · vsat_form_save_category column-sync tests
-- Paste into the STAGING SQL editor (or run via the Supabase MCP). Self-rolling-back:
-- it wraps everything in a transaction, prints one row per test (test | pass | detail),
-- and ROLLBACKs so nothing persists. It borrows one real applicant (any row in
-- application_manager) so the lead_id -> lead_manager -> profiles FK chain is satisfied,
-- neutralises the columns it checks, drives the function as that applicant, asserts, rolls back.
--
-- Covers: DD/MM/YYYY -> date, "Yes" -> bool, exact percentage -> class10_percentage vs
-- score slab -> class10_score (the two must NOT collide), year-as-int, numeric, a bad
-- number being skipped, and form_data still being written.

begin;

-- borrow a real applicant + make a test form the active one
select set_config('vedam.test_lead', (select lead_id::text from public.application_manager limit 1), true);

update public.vsat_forms set status = 'draft' where status = 'active';

insert into public.vsat_forms(id, name, status, schema)
values (
  'aaaaaaaa-0000-4000-8000-0000000102aa',
  'ZTEST 0102 COLUMN SYNC',
  'active',
  $json$
  {
    "categories": [
      {
        "key": "academic_details",
        "title": "Academic",
        "questions": [],
        "subcategories": [
          {
            "key": "edu",
            "title": "Edu",
            "questions": [
              {"key":"q_dob","label":"DOB","type":"dob","column":"date_of_birth","cast":"date"},
              {"key":"q_pcm","label":"PCM","type":"radio","column":"studied_pcm","cast":"bool"},
              {"key":"q_c10p","label":"10th percentage (exact)","type":"number","column":"class10_percentage","cast":"number"},
              {"key":"q_c10s","label":"10th score slab","type":"dropdown","column":"class10_score","cast":"text"},
              {"key":"q_oly","label":"Olympiad year","type":"number","column":"olympiad1_year","cast":"year"},
              {"key":"q_jee","label":"JEE Mains percentile","type":"number","column":"jee_percentile","cast":"number"},
              {"key":"q_bad","label":"Bad number","type":"text","column":"marks_physics_12","cast":"number"}
            ]
          }
        ],
        "next": "__submit__"
      }
    ]
  }
  $json$::jsonb
);

update public.application_manager set
  date_of_birth = null, studied_pcm = null, class10_percentage = null,
  class10_score = null, olympiad1_year = null, jee_percentile = null, marks_physics_12 = null
where lead_id = current_setting('vedam.test_lead')::uuid;

insert into public.vsat_payments(lead_id, paid_at, payment_ref, provider)
values (current_setting('vedam.test_lead')::uuid, now(), 'ZTEST-0102', 'backfill');

-- drive the function as that applicant
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('vedam.test_lead'), 'role', 'authenticated')::text, true);
set local role authenticated;

select public.vsat_form_save_category(jsonb_build_object(
  'formId','aaaaaaaa-0000-4000-8000-0000000102aa',
  'category','academic_details',
  'answers', jsonb_build_object(
    'q_dob','15/08/2006',
    'q_pcm','Yes',
    'q_c10p','92.5',
    'q_c10s','90-100%',
    'q_oly','2023',
    'q_jee','98.7',
    'q_bad','ninety'
  )
)) as call_result;

reset role;

create temp table _tr(test text, pass boolean, detail text) on commit drop;
insert into _tr
select 'date_from_ddmmyyyy', (date_of_birth = date '2006-08-15'), coalesce(date_of_birth::text,'<null>') from public.application_manager where lead_id = current_setting('vedam.test_lead')::uuid
union all
select 'bool_yes_true', (studied_pcm is true), coalesce(studied_pcm::text,'<null>') from public.application_manager where lead_id = current_setting('vedam.test_lead')::uuid
union all
select 'exact_percentage', (class10_percentage = 92.5), coalesce(class10_percentage::text,'<null>') from public.application_manager where lead_id = current_setting('vedam.test_lead')::uuid
union all
select 'slab_text_distinct_from_pct', (class10_score = '90-100%'), coalesce(class10_score,'<null>') from public.application_manager where lead_id = current_setting('vedam.test_lead')::uuid
union all
select 'year_as_int', (olympiad1_year = 2023), coalesce(olympiad1_year::text,'<null>') from public.application_manager where lead_id = current_setting('vedam.test_lead')::uuid
union all
select 'jee_percentile_num', (jee_percentile = 98.7), coalesce(jee_percentile::text,'<null>') from public.application_manager where lead_id = current_setting('vedam.test_lead')::uuid
union all
select 'bad_number_skipped', (marks_physics_12 is null), coalesce(marks_physics_12::text,'<null>') from public.application_manager where lead_id = current_setting('vedam.test_lead')::uuid
union all
select 'form_data_still_written', (form_data #>> '{academic_details,q_jee}') = '98.7', coalesce(form_data #>> '{academic_details,q_jee}','<null>') from public.application_manager where lead_id = current_setting('vedam.test_lead')::uuid;

select test, pass, detail from _tr order by test;

rollback;
