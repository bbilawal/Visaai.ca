-- Register Hong Kong's Quality Migrant Admission Scheme -- the registry's first
-- POINTS-BASED route where the points are not the decision.
--
-- NO JOB OFFER REQUIRED, WHICH IS THE POINT
--
-- "applicants are not required to have secured an offer of local employment
-- before applying for entry or being admitted to hong kong for settlement under
-- the scheme."
--
-- Registered the same night as the General Employment Policy, which requires a
-- confirmed offer, a genuine vacancy AND a role the local workforce cannot
-- readily fill. Same authority, same country, opposite premise. Hong Kong runs
-- an employer-sponsored route and a self-sponsored one side by side, and
-- neither page says so.
--
-- FOUR STAGES, AND PASSING THE TEST IS STAGE THREE OF FOUR
--
--   1. Prerequisites -- age 18+, self-funding, good character, degree. Fail any
--      one and "his/her application will not be further processed and will be
--      refused immediately".
--   2. One of two points tests -- the General Points Test (12 criteria, with a
--      passing threshold) or the Achievement-based Points Test (2 criteria).
--   3. A SELECTION EXERCISE, held periodically, in which "not all applications
--      meeting both the prerequisites and the passing threshold will
--      necessarily be approved". A high-level panel chaired by the Secretary
--      for Labour and Welfare may advise on manpower needs across sectors.
--   4. Issuance.
--
-- So the points threshold is a qualifying bar for a competition, not a pass
-- mark. Singapore's COMPASS is 40 points and you are through; here 12 criteria
-- get you considered. Storing the threshold without storing stage 3 would
-- describe a scheme that does not exist.
--
-- AND THE DISCRETION IS BROADER THAN THE GEP'S
--
-- "the director of immigration has absolute discretion to determine whether
-- applicants have fulfilled any assessment criterion ... and to approve or
-- refuse any application WITHOUT GIVING ANY REASON."
--
-- The GEP page reserves discretion to refuse. This one also reserves discretion
-- over whether a criterion was met at all, and adds that no reason need be
-- given. Both are stored, on their own routes, in the authority's own words.
--
-- BOUNDED, LIKE THE GEP
--
-- Same tabbed structure: one URL carrying the entry application and the
-- extension of stay. The extraction bounds to the entry block.
--
-- WHAT IS NOT STORED: THE TWELVE CRITERIA
--
-- The General Points Test's 12 criteria and their weights, and the passing
-- threshold itself, live in the Department's own points tables and guidance
-- notes. They are not reproduced. A points table a reader cannot apply to
-- themselves -- and which stage 3 can override -- would look like a calculator
-- and work like a decoration. That is the same call made for Singapore's
-- COMPASS, for the same reason.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'HK'),
  'hk-quality-migrant-admission-scheme', 'skilled_worker',
  'Quality Migrant Admission Scheme (QMAS)', 'QMAS',
  'quality-migrant-admission-scheme',
  'Settle in Hong Kong as a highly skilled or talented person without needing a job offer first, through a points test and a periodic selection exercise.',
  'active', 'unverified', '2026-08-24'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, v.role,
  'Immigration Department of the Hong Kong Special Administrative Region', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.immd.gov.hk/eng/services/visas/quality_migrant_admission_scheme.html',
   'Quality Migrant Admission Scheme')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'hk-quality-migrant-admission-scheme'
join public.visa_countries c on c.id = t.country_id and c.code = 'HK'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'hk-quality-migrant-admission-scheme' and s.active;
  if n <> 1 then raise exception 'Expected 1 active ImmD source, found %.', n; end if;
end $$;
