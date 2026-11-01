-- Register Singapore's Student's Pass -- ICA again, and the registry's first
-- study route where WHERE YOU STUDY CHANGES WHETHER THE PASS EXISTS FOR YOU.
--
-- FOUR PAGES, FOUR DIFFERENT QUESTIONS
--
--   * /reside/STP/apply -- who needs the pass at all, and the four ways to be
--     exempt from it.
--   * /reside/STP/apply/ihl -- the 17 named universities, polytechnics and
--     offshore campuses, plus the documents, the S$45 fee and the one-week
--     processing time.
--   * /reside/STP/apply/pei -- private education institutions, where a school's
--     EduTrust certification decides whether a foreign student can enrol at all.
--   * /reside/STP/collect -- the in-principle approval letter, the formalities
--     appointment, the S$60 issuance fee and the digital-only pass.
--
-- THE EDUTRUST RULE IS THE ONE A PROSPECTUS WILL NOT TELL YOU
--
-- "peis that are not edutrust-certified cannot offer placements to foreign
-- students ... a student's pass will not be issued to foreigners enrolled in
-- peis that are not edutrust-certified." An offer of a place from an
-- uncertified private school is worth nothing to a foreign applicant who does
-- not already hold a Dependant's Pass, Long-Term Visit Pass or Immigration
-- Exemption Order. That is a rule about the SCHOOL, discoverable only on the
-- immigration authority's site, and it is the reason this route registers the
-- PEI page separately rather than treating IHL as representative.
--
-- FOUR EXEMPTIONS, AND ONE OF THEM IS A TRAP
--
-- Holders of a Dependant's Pass, Long-Term Visit Pass or Immigration Exemption
-- Order do not need a Student's Pass -- until the underlying pass expires or is
-- cancelled mid-course, at which point they must apply and "the prevailing
-- student's pass eligibility criteria will apply". The exemption is contingent
-- on somebody else's immigration status holding.
--
-- The short-course exemption has three cumulative conditions, and the one that
-- catches people is that the course must be "a complete and stand-alone module;
-- a student's pass is required to undertake courses with multiple programme
-- modules".
--
-- RELIGIOUS STUDY INVERTS THE RULE
--
-- For religious schools the Dependant's Pass and Long-Term Visit Pass exemptions
-- DO NOT apply -- those holders need a Student's Pass -- while the Immigration
-- Exemption Order still exempts. The same three passes, opposite effect,
-- decided by the subject studied.
--
-- ROLE VOCABULARY
--
-- `visa_sources.role` has no slot for "one institution type among several", so
-- the PEI page is registered as `policy`: what it carries that IHL does not is
-- ICA's policy on which schools may take foreign students, not a document list.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SG'),
  'sg-student-pass', 'student',
  'Student''s Pass',
  'students-pass',
  'Study full-time in Singapore at an institute of higher learning, an EduTrust-certified private education institution or another approved school.',
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
  c.id, t.id, v.role, 'Immigration & Checkpoints Authority (ICA)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.ica.gov.sg/reside/STP/apply',
   'Becoming a Student''s Pass holder'),
  ('eligibility',
   'https://www.ica.gov.sg/reside/STP/apply/ihl',
   'Institutes of Higher Learning'),
  ('policy',
   'https://www.ica.gov.sg/reside/STP/apply/pei',
   'Approved Private Education Institutions'),
  ('application',
   'https://www.ica.gov.sg/reside/STP/collect',
   'Completion of Formalities and Issuance of Student''s Pass')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'sg-student-pass'
join public.visa_countries c on c.id = t.country_id and c.code = 'SG'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'sg-student-pass' and s.active;
  if n <> 4 then raise exception 'Expected 4 active ICA sources, found %.', n; end if;
end $$;
