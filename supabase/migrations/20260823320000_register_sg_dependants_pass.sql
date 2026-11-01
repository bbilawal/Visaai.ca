-- Register Singapore's Dependant's Pass -- the registry's first `dependant`
-- route, and the one where THE FAMILY'S STATUS IS NOT THE FAMILY'S.
--
-- A SALARY TEST ON SOMEBODY ELSE, AND EXPLICITLY NOT ON THE HOUSEHOLD
--
-- "earn a minimum fixed monthly salary of $6,000 . this is based on your
-- salary, and not based on your combined household income."
--
-- MOM writes that second sentence because the first reads like a household
-- test and is not one. Ireland's family reunification route already established
-- that incomes cannot be combined between spouses; Singapore goes further --
-- the test is on the WORK PASS HOLDER alone, and a dependant who works and
-- earns does not contribute to it at all.
--
-- $6,000 IS ABOVE THE PASS THAT QUALIFIES FOR IT
--
-- The Employment Pass floor starts at $5,600. So an EP holder at the bottom of
-- the salary schedule holds a valid pass and cannot bring a spouse. The two
-- numbers are set on different pages by the same ministry and never appear
-- together, which is exactly why both are in this registry.
--
-- THE PASS EXPIRES WHEN SOMEBODY ELSE'S DOES
--
-- "the duration is tied to the validity of the main work pass or up to the
-- duration requested, whichever is shorter." A dependant's right to remain ends
-- with a job they do not hold. That is the mechanism behind the Student's Pass
-- rule registered earlier tonight -- a child studying on a Dependant's Pass
-- must apply for their own Student's Pass, assessed on the prevailing criteria,
-- if the parent's pass lapses mid-course.
--
-- AND THE LETTER OF CONSENT IS GONE
--
-- The widely repeated belief is that a Dependant's Pass holder may work on a
-- Letter of Consent. MOM's own page now says otherwise: a DP holder who wants
-- to work needs an Employment Pass, an S Pass or a DP-Work Permit, applied for
-- by the prospective employer. Getting an EP or S Pass ENDS the dependency --
-- "they will need to have their dp cancelled before their ep or s pass is
-- issued" -- so the better outcome also removes the fallback.
--
-- The DP-Work Permit keeps the dependency instead: tied to the DP, no minimum
-- qualifying salary, open to any nationality, but inside the employer's quota
-- and levy.
--
-- ONE ROUTE MOM EXCLUDES OUTRIGHT
--
-- Families of EP holders who applied as an overseas intra-corporate transferee
-- under WTO GATS or an FTA get neither a Dependant's Pass nor a Long-Term Visit
-- Pass, except where a specific FTA covers them. The exclusion follows from a
-- choice made on the WORKER'S application, months earlier.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SG'),
  'sg-dependants-pass', 'dependant',
  'Dependant''s Pass',
  'dependants-pass',
  'Bring a legally married spouse or unmarried children under 21 to Singapore as the holder of an Employment Pass or S Pass.',
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
   'https://www.mom.gov.sg/passes-and-permits/dependants-pass/eligibility',
   'Eligibility for Dependant''s Pass'),
  ('eligibility',
   'https://www.mom.gov.sg/passes-and-permits/dependants-pass/key-facts',
   'Key facts on Dependant''s Pass'),
  ('documents',
   'https://www.mom.gov.sg/passes-and-permits/dependants-pass/documents-required',
   'Documents required for Dependant''s Pass'),
  ('application',
   'https://www.mom.gov.sg/passes-and-permits/dependants-pass/apply-for-a-pass',
   'Apply for a Dependant''s Pass'),
  -- Registered because the "may a dependant work?" answer changed and the old
  -- one is still what most people believe.
  ('policy',
   'https://www.mom.gov.sg/passes-and-permits/dependants-pass/working-in-singapore',
   'Dependant''s Pass: working in Singapore')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'sg-dependants-pass'
join public.visa_countries c on c.id = t.country_id and c.code = 'SG'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'sg-dependants-pass' and s.active;
  if n <> 5 then raise exception 'Expected 5 active MOM sources, found %.', n; end if;
end $$;
