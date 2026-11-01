-- Register Singapore's Overseas Networks & Expertise Pass -- the top of the
-- ladder, and the third rung of a comparison no MOM page draws.
--
-- THE LADDER, NOW COMPLETE
--
--   S Pass              $3,300/month   quota + levy   employer applies
--   Employment Pass     $5,600/month   COMPASS 40 pts employer applies
--   ONE Pass           S$30,000/month  no COMPASS     CANDIDATE applies
--
-- Nine times the S Pass floor, five times the Employment Pass floor, and the
-- exemptions run the opposite way to the cost: the highest-paid pass is the one
-- freed from COMPASS, from Fair Consideration Framework job advertising, and
-- from having to reapply when changing jobs.
--
-- THE ONE PASS UNDOES THE EMPLOYMENT PASS'S CENTRAL CONSTRAINT
--
-- An Employment Pass binds a person to one employer -- a new job is a new
-- application. The ONE Pass holder has "flexibility to concurrently start,
-- operate and work for multiple companies at any one time" and "no need to
-- reapply for a pass if you change jobs". That is a different relationship to
-- the state, not a better-paid version of the same one.
--
-- AND IT RESTORES THE LETTER OF CONSENT
--
-- Tonight's Dependant's Pass extraction recorded that the Letter of Consent is
-- gone: a DP holder who wants to work needs an Employment Pass, S Pass or
-- DP-Work Permit. That is true for dependants of EP and S Pass holders, which
-- is who that page covers. The ONE Pass key facts say "your spouse will be able
-- to apply to work on a letter of consent."
--
-- So the LOC did not disappear; it was RESTRICTED to this pass. Registering the
-- two routes on the same night is the only reason that reads as a distinction
-- rather than as a contradiction, and the Dependant's Pass extraction already
-- says its page does not cover ONE Pass families.
--
-- SALARY FROM ONE EMPLOYER, AND MOM PRINTS THE ARITHMETIC
--
-- S$20,000 + S$10,000 = S$30,000 -> NOT eligible.
-- S$30,000 + S$5,000  = S$35,000 -> eligible.
--
-- MOM publishes that table rather than leaving it to be inferred. Ireland's
-- family route says incomes cannot be combined between people; this says they
-- cannot be combined between JOBS held by the same person.
--
-- THE EMPLOYER HAS TO BE BIG, AND IT IS MEASURED IN US DOLLARS
--
-- Market capitalisation of at least US$500 million, or annual revenue of at
-- least US$200 million. A salary threshold in SGD and a company threshold in
-- USD on the same page, which is why fee_currency alone was never going to be
-- enough and every figure here carries its own currency.
--
-- ONE APPLICATION AT A TIME
--
-- "you may only submit 1 work pass application per candidate at a time." A
-- candidate cannot hedge between a ONE Pass and an Employment Pass.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SG'),
  'sg-one-pass', 'work',
  'Overseas Networks & Expertise Pass',
  'overseas-networks-expertise-pass',
  'Work, found and run multiple companies in Singapore as top talent in business, arts and culture, sports, academia or research.',
  'active', 'unverified', '2026-08-23'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, v.role, 'Ministry of Manpower (MOM)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.mom.gov.sg/passes-and-permits/overseas-networks-expertise-pass/eligibility',
   'Eligibility for Overseas Networks & Expertise Pass'),
  ('eligibility',
   'https://www.mom.gov.sg/passes-and-permits/overseas-networks-expertise-pass/key-facts',
   'Key facts on Overseas Networks & Expertise Pass'),
  ('documents',
   'https://www.mom.gov.sg/passes-and-permits/overseas-networks-expertise-pass/documents-required',
   'Documents required for Overseas Networks & Expertise Pass'),
  ('application',
   'https://www.mom.gov.sg/passes-and-permits/overseas-networks-expertise-pass/apply-for-a-pass',
   'Apply for an Overseas Networks & Expertise Pass')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'sg-one-pass'
join public.visa_countries c on c.id = t.country_id and c.code = 'SG'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'sg-one-pass' and s.active;
  if n <> 4 then raise exception 'Expected 4 active MOM sources, found %.', n; end if;
end $$;
