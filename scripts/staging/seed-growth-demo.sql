-- STAGING ONLY · seed FAKE data for Growth → Ads / Influencers (migration 0105), so the Listing and
-- Performance screens show real-looking numbers. Remove everything with scripts/staging/cleanup-growth-demo.sql.
--
-- How: run this whole file once in the STAGING SQL editor (project kyhakenhbgcissmaacws), or via the Supabase MCP.
--
-- What it creates (all tagged so the cleanup finds every row):
--   * vsat_campaigns: 'VSAT-7 (Demo)' … 'VSAT-10 (Demo)'
--   * growth_custom_columns: Ads "Creative type", Influencers "Language" (select columns)
--   * growth_influencers: 8 made-up creators (channel links end in -demo / .demo)
--   * growth_ad_rows: 12 ads, growth_infl_posts: 16 posts (all rows of these tables are demo rows on staging)
--   * auth.users: email zzgrowth-NNNNN@example.invalid, raw_user_meta_data.dummy_seed = 'growth-demo-v1'
--     (no password, no phone, .invalid email → nobody can log in, nothing can be delivered)
--     → the normal sign-up trigger creates their profiles + lead rows; the lead gets the ad / post UTM
--       (first touch) and a lead date inside or after the campaign window, tag 'growth_demo'
--   * application_manager 'GDEMO-NNNNN' for the paid leads (some with enrollment_stage = 'approved')
--   * vsat_payments provider 'simulated', payment_ref 'growth-demo-<lead id>'
--
-- Randomness is deterministic (lead number), so a re-seed gives the same numbers.

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;
  if exists (select 1 from auth.users where raw_user_meta_data->>'dummy_seed' = 'growth-demo-v1')
     or exists (select 1 from public.vsat_campaigns where name like '% (Demo)') then
    raise exception 'Growth demo data is already seeded. Run cleanup-growth-demo.sql first.';
  end if;
end $$;

-- ── campaigns, columns, influencers ─────────────────────────────────────────────
insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date, budget, application_target) values
 ('VSAT-7 (Demo)',  '2026-01-05', '2026-01-18', '2026-01-25',  600000, 300),
 ('VSAT-8 (Demo)',  '2026-03-01', '2026-03-15', '2026-03-22',  800000, 400),
 ('VSAT-9 (Demo)',  '2026-05-01', '2026-05-12', '2026-05-20', 1000000, 450),
 ('VSAT-10 (Demo)', '2026-10-20', '2026-11-30', '2026-12-07', 1200000, 500);

insert into public.growth_custom_columns (channel, col_key, label, col_type, required, options, display_order) values
 ('ads', 'x_creative_type', 'Creative type', 'select', false, '["Video","Static","Carousel"]', 1),
 ('influencers', 'x_language', 'Language', 'select', false, '["Hindi","English","Hinglish"]', 1);

insert into public.growth_influencers (name, channel_link) values
 ('CodeWithAarav', 'https://youtube.com/@codewithaarav-demo'), ('TechTalks Riya', 'https://youtube.com/@techtalksriya-demo'),
 ('Neha Codes', 'https://instagram.com/nehacodes.demo'), ('JEE Simplified', 'https://youtube.com/@jeesimplified-demo'),
 ('Dev Diaries', 'https://youtube.com/@devdiaries-demo'), ('Byte Size Kabir', 'https://youtube.com/@bytesizekabir-demo'),
 ('Campus Vlogs Meera', 'https://instagram.com/campusvlogsmeera.demo'), ('Placement Prep Hub', 'https://youtube.com/@placementprephub-demo');

-- ── ads ─────────────────────────────────────────────────────────────────────────
create temp table demo_ads (sn int, camp text, platform text, name text, status text, live date, spend numeric, src text, med text, cmp text, creative text) on commit drop;
insert into demo_ads values
 (1,'VSAT-7 (Demo)','Meta','Reel – Learn coding from day 1','Enabled','2026-01-05',90000,'meta','paid_social','demo_v7_reel_coding','Video'),
 (2,'VSAT-7 (Demo)','Google','Search – BTech CS AI colleges','Enabled','2026-01-05',70000,'google','cpc','demo_v7_search_btech','Static'),
 (3,'VSAT-8 (Demo)','Meta','Reel – JEE droppers','Enabled','2026-03-01',120000,'meta','paid_social','demo_reel_droppers','Video'),
 (4,'VSAT-8 (Demo)','Google','Search – AI engineering','Enabled','2026-03-02',80000,'google','cpc','demo_v8_search_ai','Static'),
 (5,'VSAT-8 (Demo)','Meta','Static – Parents (ROI)','Paused','2026-03-04',30000,'meta','paid_social','demo_v8_static_parents','Static'),
 (6,'VSAT-9 (Demo)','Meta','Reel – JEE droppers (rerun)','Enabled','2026-05-01',110000,'meta','paid_social','demo_reel_droppers','Video'),
 (7,'VSAT-9 (Demo)','Google','PMax – VSAT-9','Enabled','2026-05-01',95000,'google','pmax','demo_v9_pmax',null),
 (8,'VSAT-9 (Demo)','Meta','Carousel – Campus life','Enabled','2026-05-03',60000,'meta','paid_social','demo_v9_carousel_campus','Carousel'),
 (9,'VSAT-9 (Demo)','Google','YouTube pre-roll','Paused','2026-05-05',40000,'google','youtube','demo_v9_yt_preroll','Video'),
 (10,'VSAT-10 (Demo)','Meta','Reel – Build with AI','Enabled','2026-10-20',85000,'meta','paid_social','demo_v10_reel_ai','Video'),
 (11,'VSAT-10 (Demo)','Google','Search – Brand (Vedam)','Enabled','2026-10-20',25000,'google','cpc','demo_v10_search_brand','Static'),
 (12,'VSAT-10 (Demo)','Meta','Story – VSAT-10 deadline','Enabled','2026-11-10',15000,null,null,null,'Static');

insert into public.growth_ad_rows (serial_no, ad_name, platform, campaign_id, campaign_status, live_date, spend, utm_link, notes, extra)
select d.sn, d.name, d.platform, c.id, d.status, d.live, d.spend,
       case when d.src is null then null else 'https://vedam.org/vsat?utm_source=' || d.src || '&utm_medium=' || d.med || '&utm_campaign=' || d.cmp end,
       case when d.src is null then 'Demo row: UTM not added yet' when d.sn = 6 then 'Demo row: same UTM as the VSAT-8 droppers reel' end,
       case when d.creative is null then '{}'::jsonb else jsonb_build_object('x_creative_type', d.creative) end
  from demo_ads d join public.vsat_campaigns c on c.name = d.camp;

-- ── influencer posts ────────────────────────────────────────────────────────────
create temp table demo_posts (sn int, camp text, infl text, platform text, live date, status text, cost numeric, exp bigint, act bigint, src text, cmp text, lang text, note text) on commit drop;
insert into demo_posts values
 (1,'VSAT-8 (Demo)','CodeWithAarav','YouTube - Dedicated','2026-03-03','Live',150000,200000,245000,'youtube','demo_v8_aarav_ded','Hinglish',null),
 (2,'VSAT-8 (Demo)','TechTalks Riya','YouTube - Integrated','2026-03-05','Live',60000,120000,98000,'youtube','demo_v8_riya_int','English',null),
 (3,'VSAT-8 (Demo)','Neha Codes','Instagram Reel','2026-03-06','Live',25000,80000,112000,'instagram','demo_v8_neha_reel','Hinglish',null),
 (4,'VSAT-9 (Demo)','CodeWithAarav','YouTube - Dedicated','2026-05-02','Live',175000,250000,310000,'youtube','demo_v9_aarav_ded','Hinglish',null),
 (5,'VSAT-9 (Demo)','JEE Simplified','YouTube Shorts','2026-05-03','Live',0,150000,180000,'youtube','demo_v9_jee_shorts','Hindi','Bulk deal: 3 Shorts included in the Dedicated video package'),
 (6,'VSAT-9 (Demo)','Dev Diaries','YouTube - Semi-Dedicated','2026-05-04','Live',70000,100000,87000,'youtube','demo_v9_dev_semi','English',null),
 (7,'VSAT-9 (Demo)','Byte Size Kabir','YouTube - Generic','2026-05-05','Live',20000,50000,41000,'youtube','demo_v9_kabir_generic','Hindi',null),
 (8,'VSAT-9 (Demo)','Campus Vlogs Meera','Instagram Story','2026-05-06','Live',15000,40000,52000,'instagram','demo_v9_meera_story','Hinglish',null),
 (9,'VSAT-9 (Demo)','Neha Codes','Instagram Reel','2026-05-07','Live',30000,90000,76000,'instagram','demo_v9_neha_reel','Hinglish',null),
 (10,'VSAT-9 (Demo)','TechTalks Riya','YouTube - Integrated','2026-05-08','Live',65000,120000,134000,'youtube','demo_v9_riya_int','English',null),
 (11,'VSAT-10 (Demo)','Placement Prep Hub','YouTube - Dedicated','2026-10-25','Live',120000,180000,160000,'youtube','demo_v10_pph_ded','English',null),
 (12,'VSAT-10 (Demo)','CodeWithAarav','YouTube Shorts','2026-10-28','Live',40000,100000,125000,'youtube','demo_v10_aarav_shorts','Hinglish',null),
 (13,'VSAT-10 (Demo)','Campus Vlogs Meera','Instagram Story','2026-11-02','Live',12000,40000,35000,'instagram','demo_v10_meera_story','Hinglish',null),
 (14,'VSAT-10 (Demo)','Dev Diaries','YouTube - Integrated','2026-11-12','Live',55000,90000,47000,'youtube','demo_v10_dev_int','English',null),
 (15,'VSAT-10 (Demo)','JEE Simplified','YouTube - Dedicated','2026-12-01','Planned',90000,150000,null,'youtube','demo_v10_jee_ded','Hindi',null),
 (16,'VSAT-10 (Demo)','Neha Codes','Instagram Reel','2026-12-03','Planned',28000,80000,null,'instagram','demo_v10_neha_reel','Hinglish',null);

insert into public.growth_infl_posts (serial_no, influencer_id, platform, live_date, live_link, utm_link, expected_views, actual_views, views_synced_at, cost, live_status, campaign_id, notes, extra)
select d.sn, i.id, d.platform, d.live,
       case when d.status = 'Planned' then null when d.src = 'youtube' then 'https://www.youtube.com/watch?v=demo' || lpad(d.sn::text, 7, '0') else 'https://www.instagram.com/p/demo' || d.sn end,
       'https://vedam.org/vsat?utm_source=' || d.src || '&utm_medium=influencer&utm_campaign=' || d.cmp,
       d.exp, d.act, case when d.src = 'youtube' and d.act is not null then now() - interval '2 hours' end,
       d.cost, d.status, c.id, d.note, jsonb_build_object('x_language', d.lang)
  from demo_posts d join public.growth_influencers i on i.name = d.infl join public.vsat_campaigns c on c.name = d.camp;

-- ── dummy leads: per UTM, n_in inside the campaign window and n_out after it (all-time only) ──
create temp table demo_spec (src text, med text, cmp text, s date, e date, n_in int, n_out int, pay int, enr int) on commit drop;
insert into demo_spec values
 ('meta','paid_social','demo_v7_reel_coding','2026-01-05','2026-01-18',45,10,10,35),
 ('google','cpc','demo_v7_search_btech','2026-01-05','2026-01-18',30,6,13,40),
 ('meta','paid_social','demo_reel_droppers','2026-03-01','2026-03-15',55,12,9,30),
 ('google','cpc','demo_v8_search_ai','2026-03-01','2026-03-15',28,5,14,45),
 ('meta','paid_social','demo_v8_static_parents','2026-03-01','2026-03-15',8,2,0,0),
 ('meta','paid_social','demo_reel_droppers','2026-05-01','2026-05-12',50,0,11,35),
 ('google','pmax','demo_v9_pmax','2026-05-01','2026-05-12',40,8,11,35),
 ('meta','paid_social','demo_v9_carousel_campus','2026-05-01','2026-05-12',22,4,9,30),
 ('google','youtube','demo_v9_yt_preroll','2026-05-01','2026-05-12',12,3,8,0),
 ('meta','paid_social','demo_v10_reel_ai','2026-10-20','2026-11-17',35,0,8,25),
 ('google','cpc','demo_v10_search_brand','2026-10-20','2026-11-17',20,0,15,30),
 ('youtube','influencer','demo_v8_aarav_ded','2026-03-01','2026-03-15',40,10,12,35),
 ('youtube','influencer','demo_v8_riya_int','2026-03-01','2026-03-15',18,3,8,30),
 ('instagram','influencer','demo_v8_neha_reel','2026-03-01','2026-03-15',14,2,7,0),
 ('youtube','influencer','demo_v9_aarav_ded','2026-05-01','2026-05-12',48,9,13,40),
 ('youtube','influencer','demo_v9_jee_shorts','2026-05-01','2026-05-12',22,4,9,30),
 ('youtube','influencer','demo_v9_dev_semi','2026-05-01','2026-05-12',20,3,10,30),
 ('youtube','influencer','demo_v9_kabir_generic','2026-05-01','2026-05-12',6,1,0,0),
 ('instagram','influencer','demo_v9_meera_story','2026-05-01','2026-05-12',9,1,11,0),
 ('instagram','influencer','demo_v9_neha_reel','2026-05-01','2026-05-12',12,2,8,30),
 ('youtube','influencer','demo_v9_riya_int','2026-05-01','2026-05-12',24,4,12,35),
 ('youtube','influencer','demo_v10_pph_ded','2026-10-25','2026-11-17',30,0,10,30),
 ('youtube','influencer','demo_v10_aarav_shorts','2026-10-28','2026-11-17',18,0,11,30),
 ('instagram','influencer','demo_v10_meera_story','2026-11-02','2026-11-17',6,0,0,0),
 ('youtube','influencer','demo_v10_dev_int','2026-11-12','2026-11-17',8,0,12,0);

create temp table demo_leads on commit drop as
select gen_random_uuid() as lead_id, (row_number() over (order by x.cmp, x.at))::int as n, x.*
  from (
    select s.src, s.med, s.cmp, s.pay, s.enr,
           ((s.s + ((g * 7919) % (s.e - s.s + 1)))::timestamp + make_interval(hours => 9 + (g * 13) % 12)) at time zone 'Asia/Kolkata' as at
      from demo_spec s, generate_series(1, s.n_in) g
    union all
    select s.src, s.med, s.cmp, s.pay, s.enr,
           ((least(s.e + 1 + ((g * 31) % 40), date '2026-11-17'))::timestamp + make_interval(hours => 10 + (g * 7) % 10)) at time zone 'Asia/Kolkata'
      from demo_spec s, generate_series(1, s.n_out) g
  ) x;

-- users → the sign-up trigger creates profile (+ lead row); then the lead gets its UTM and date
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', l.lead_id, 'authenticated', 'authenticated',
       'zzgrowth-' || lpad(l.n::text, 5, '0') || '@example.invalid',
       jsonb_build_object('dummy_seed', 'growth-demo-v1', 'dummy_n', l.n, 'full_name', 'Demo Lead ' || l.n || ' (dummy)'),
       '{"provider":"email","providers":["email"]}'::jsonb, l.at, l.at, l.at, false, false
  from demo_leads l;

insert into public.lead_manager (lead_id, registered_name, registered_email, lead_source, utm_source, utm_medium, utm_campaign, tags, notes, created_at, user_registration_date)
select l.lead_id, 'Demo Lead ' || l.n || ' (dummy)', 'zzgrowth-' || lpad(l.n::text, 5, '0') || '@example.invalid', 'growth_demo',
       l.src, l.med, l.cmp, '{growth_demo}', 'Dummy lead for the Growth Ads / Influencers demo (staging)', l.at, l.at
  from demo_leads l
on conflict (lead_id) do update set
  registered_name = excluded.registered_name, registered_email = excluded.registered_email, lead_source = excluded.lead_source,
  utm_source = excluded.utm_source, utm_medium = excluded.utm_medium, utm_campaign = excluded.utm_campaign,
  tags = excluded.tags, notes = excluded.notes, created_at = excluded.created_at, user_registration_date = excluded.user_registration_date;

-- ── payments (some leads) and enrollments (some payers) ─────────────────────────
create temp table demo_paid on commit drop as
select l.lead_id, l.n,
       least(l.at + make_interval(days => (l.n * 3) % 10, hours => 2), now() - interval '1 hour') as paid_at,
       ((l.n * 53 + 11) % 100) < l.enr as enrolled
  from demo_leads l
 where ((l.n * 37 + 7) % 100) < l.pay;

insert into public.application_manager (application_id, lead_id, registered_name, registered_email, enrollment_stage, enrollment_paid_at)
select 'GDEMO-' || lpad(p.n::text, 5, '0'), p.lead_id, 'Demo Lead ' || p.n || ' (dummy)', 'zzgrowth-' || lpad(p.n::text, 5, '0') || '@example.invalid',
       case when p.enrolled then 'approved' else 'not_initiated' end,
       case when p.enrolled then least(p.paid_at + make_interval(days => 5 + (p.n % 15)), now() - interval '1 hour') end
  from demo_paid p;

select set_config('vedam.allow_simulated_payments', 'on', true);
insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount)
select p.lead_id, p.paid_at, 'growth-demo-' || p.lead_id, 'simulated', 1500 from demo_paid p;

-- ── check ───────────────────────────────────────────────────────────────────────
select (select count(*) from public.vsat_campaigns where name like '% (Demo)') as campaigns,
       (select count(*) from public.growth_ad_rows) as ads,
       (select count(*) from public.growth_infl_posts) as posts,
       (select count(*) from public.growth_influencers) as influencers,
       (select count(*) from public.lead_manager where 'growth_demo' = any (tags)) as leads,
       (select count(*) from public.lead_manager where 'growth_demo' = any (tags) and primary_utm is not null) as leads_with_utm,
       (select count(*) from public.vsat_payments where payment_ref like 'growth-demo-%') as payments,
       (select count(*) from public.application_manager where application_id like 'GDEMO-%' and enrollment_stage = 'approved') as enrolled;
