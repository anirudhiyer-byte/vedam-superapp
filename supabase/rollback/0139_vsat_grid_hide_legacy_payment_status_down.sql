-- Rollback 0139 · restore the 0135 catalogue (payment_status back to 'finance').
CREATE OR REPLACE FUNCTION public.vsat__grid_catalog()
 RETURNS TABLE(key text, grp text, typ text, sens text, virt boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with real_cols as (
    select a.attname::text as key, a.atttypid::regtype::text as pgtype, a.attnum
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.application_manager'::regclass and a.attnum > 0 and not a.attisdropped
  ), virt as (
    select * from (values
      ('stage',                      'Pipeline',    'stage',  10), ('status',               'Pipeline',    'status', 11),
      ('stage_changed_at',           'Pipeline',    'ts',     12), ('attempt_no',           'Pipeline',    'num',    13),
      ('campus',                     'Pipeline',    'text',   14), ('early_registration',   'Pipeline',    'bool',   15),
      ('vsat',                       'Exam',        'text',   16),
      ('vps_effective',              'Exam',        'num',    17), ('vps_override',         'Exam',        'num',    18),
      ('eligible_effective',         'Exam',        'bool',   19), ('eligible_override',    'Exam',        'bool',   20),
      ('vps_calculated',             'Exam',        'num',    36), ('exam_percentage',      'Exam',        'num',    37),
      ('exam_section_maths',         'Exam',        'num',    38), ('exam_section_lr',      'Exam',        'num',    39),
      ('exam_section_cs',            'Exam',        'num',    40), ('proctoring',           'Exam',        'text',   41),
      ('class12_result',             'Academics',   'text',   42), ('class10_eligible',     'Academics',   'bool',   43),
      ('class12_eligible',           'Academics',   'bool',   44),
      ('interviewer',                'Interview',   'text',   21), ('interview_slot',       'Interview',   'ts',     22),
      ('interview_attendance',       'Interview',   'text',   23), ('interview_score',      'Interview',   'num',    24),
      ('interview_calc_verdict',     'Interview',   'text',   25), ('interviewer_verdict',  'Interview',   'text',   26),
      ('cheating_seen',              'Interview',   'bool',   27),
      ('counsellor',                 'Counselling', 'text',   30), ('counselling_slot',     'Counselling', 'ts',     31),
      ('counselling_attendance',     'Counselling', 'text',   32), ('counselling_category', 'Counselling', 'num',    33),
      ('counselling_pct',            'Counselling', 'num',    34), ('counselling_calculated_pct', 'Counselling', 'num', 35)
    ) v(key, grp, typ, ord)
  )
  select v.key, v.grp, v.typ, 'open'::text, true from virt v
  union all
  select c.key,
         case
           -- the old sheet's per-attempt copies (vsat_*_1/_2, vps_score_1/_2): kept for history, out of the Exam group
           when c.key ~ '^(vsat_(score_(lr|maths|cs)|total|percentile|result|attempt_date|appeared|slot_datetime|campaign_id)|vps_score)_[12]$' then 'Old sheet (per attempt)'
           when c.key like '%utm%'                                                        then 'Marketing'
           when c.key like 'payment%' or c.key in ('application_fee_amount', 'currency', 'order_id', 'transaction_id', 'cash_receipt_date')
                or c.key like 'discount%' or c.key like 'seat_booking%' or c.key like 'enrollment%'   then 'Payment'
           when c.key like 'offer%'                                                       then 'Offer'
           when c.key like 'counselling%' or c.key like 'scholarship%'                    then 'Counselling'
           when c.key like 'interview%'                                                   then 'Interview'
           when c.key like 'vsat%' or c.key like 'vps%' or c.key like 'wheebox%' or c.key like 'exam%' or c.key like 'mock%'
                or c.key like '%card_download_date'                                        then 'Exam'
           when c.key like '%verification%' or c.key like '%\_url' or c.key = 'selected_id_type' then 'Documents'
           when c.key like 'father%' or c.key like 'mother%' or c.key like 'guardian%' or c.key = 'family_income' then 'Parents'
           when c.key like 'coding%' or c.key = 'taken_coding_exam'                       then 'Coding exams'
           when c.key like 'olympiad%' or c.key = 'participated_olympiad'                 then 'Olympiads'
           when c.key like 'jee%' or c.key like 'entrance%'                               then 'JEE & entrance'
           when c.key like 'class1%' or c.key like 'marks\_%' or c.key in ('studied_pcm', 'studied_cs', 'cs_experience', 'pcm_eligible') then 'Academics'
           when c.key in ('registered_name', 'registered_email', 'registered_mobile', 'gender', 'date_of_birth', 'residing_city',
                          'country', 'state', 'city', 'campus_applied', 'program', 'partner_university', 'current_education_level',
                          'class_12_stream', 'preferred_engineering_specialization', 'hostel_selection', 'campus_tour_date', 'campus_tour_time') then 'Personal'
           else 'Application' end,
         case c.pgtype
           when 'numeric' then 'num' when 'integer' then 'num' when 'bigint' then 'num' when 'boolean' then 'bool'
           when 'date' then 'date' when 'timestamp with time zone' then 'ts' when 'jsonb' then 'json' when 'uuid' then 'uuid'
           else 'text' end,
         case
           when c.pgtype in ('jsonb', 'uuid') or c.key in ('application_id')                      then 'hidden'
           when c.key like '%\_url'                                                               then 'doc'
           when c.key ~ '(mobile|phone|email|contact|whatsapp)' or c.key = 'wheebox_login_id'      then 'contact'
           when c.key ~ '(payment|amount|order_id|txn|transaction|income|coupon|receipt|discount|currency|seat_booking)' then 'finance'
           else 'open' end,
         false
    from real_cols c
   where c.key not in (select key from virt)
   order by 5 desc, 1
$function$;
revoke all on function public.vsat__grid_catalog() from public, anon, authenticated;
