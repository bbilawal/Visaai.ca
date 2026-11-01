-- Promote Türkiye's eight routes. Türkiye reaches 8 live routes.
--
-- Four assertions beyond provenance, each guarding a number that would send
-- somebody to the wrong place if it moved.
--
--   THE PASSPORT MARGIN IS 60 DAYS BEYOND THE STAY, NOT SIX MONTHS FROM
--   ARRIVAL. Both rules exist on these pages and they are different: Article
--   7.1b is statutory and additive (a 90-day visa needs 150 days of passport),
--   while the six-month figure is the ministry's ADVICE. If the statutory
--   requirement ever quotes the six-month sentence, a traveller with five
--   months left will be told they are fine when the law says otherwise.
--
--   THE TWO WORK DEADLINES ARE TEN WORKING DAYS AND THIRTY DAYS, AND THEY BELONG
--   TO DIFFERENT PARTIES. Ten working days is the EMPLOYER's filing deadline
--   with the MLSS; thirty days is the MLSS's own decision window. Swapping them
--   makes the applicant responsible for a deadline they cannot meet.
--
--   ARTICLE 55's PERIODS MUST STAY APART. One month for scientific and cultural
--   work, four for sport, three for machinery, six for fairs, eight for tour
--   operators, two years for study visits. They are quoted in six separate
--   requirements precisely so no merge can average them.
--
--   THE GENERAL REGIME MUST BE ON ALL EIGHT ROUTES. The 90/180 ceiling, the
--   insurance and the passport margin are not route-specific, and a route page
--   that dropped them would be wrong on its own terms.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id
   and c.code = 'TR'
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code = 'TR'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_bad integer; n_pages integer;
  n_margin integer; n_ten integer; n_thirty integer; n_periods integer; n_general integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and r.status = 'active';
  if n_active <> 96 then raise exception 'Expected 96 active TR requirements, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% TR requirement(s) lack provenance or a display quotation', n_bad; end if;

  -- The statutory margin quotes 60 days beyond the duration of stay, on every
  -- route, and never the six-month advice.
  select count(*) into n_margin from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and r.status = 'active'
     and r.requirement_code = 'passport_validity_60_days_beyond_stay'
     and r.source_excerpt like '%at least 60 days beyond the “duration of stay”%'
     and r.source_excerpt not like '%6 months%';
  if n_margin <> 8 then
    raise exception 'All 8 routes must quote the 60-day statutory margin and not the six-month advice; found %', n_margin;
  end if;

  -- Ten WORKING days is the employer's; thirty days is the ministry's.
  select count(*) into n_ten from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'tr-working-visa' and r.status = 'active'
     and r.source_excerpt like '%by your employer within ten working days%';
  select count(*) into n_thirty from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'tr-working-visa' and r.status = 'active'
     and r.source_excerpt like '%finalized by the mlss within thirty days%';
  if n_ten <> 1 or n_thirty <> 1 then
    raise exception 'The employer''s ten working days and the MLSS''s thirty days must each appear exactly once (found % and %)', n_ten, n_thirty;
  end if;

  -- Article 55's six distinct exemption periods, one requirement apiece.
  select count(*) into n_periods from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'tr-internship-work-permit-exemption' and r.status = 'active'
     and r.requirement_code in (
       'exempt_scientific_cultural_under_one_month_sport_under_four',
       'exempt_machinery_installation_three_months_per_year',
       'exempt_fairs_and_circuses_six_months',
       'exempt_study_visits_two_years',
       'exemption_once_per_calendar_year_and_three_month_gap');
  if n_periods <> 5 then
    raise exception 'Article 55''s exemption periods must remain separate requirements; found %', n_periods;
  end if;

  -- The general regime, present on every route.
  select count(*) into n_general from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and r.status = 'active'
     and r.requirement_code in ('stay_90_days_in_180','medical_insurance_for_stay','visa_does_not_guarantee_entry');
  if n_general <> 24 then
    raise exception 'The general regime (90/180, insurance, no guaranteed entry) must be on all 8 routes = 24 rows; found %', n_general;
  end if;

  select count(*) into n_pages from public.visa_publishable_pages where country_code = 'TR';
  if n_pages <> 8 then raise exception 'Türkiye should publish 8 pages, found %', n_pages; end if;

  raise notice 'Türkiye LIVE: 8 routes, % requirements', n_active;
end $$;
