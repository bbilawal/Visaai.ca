-- Register Singapore's Long-Term Visit Pass -- ICA's, for the family of
-- CITIZENS AND PERMANENT RESIDENTS, and the registry's first route where an
-- authority publishes a free pre-check that changes the processing time by a
-- factor of four.
--
-- TWO DIFFERENT PASSES SHARE THIS NAME
--
-- MOM issues a Long-Term Visit Pass to family members of WORK PASS holders who
-- do not qualify for a Dependant's Pass. ICA issues this one to family members
-- of CITIZENS AND PERMANENT RESIDENTS. Different authority, different
-- eligibility, same three letters. This route is ICA's, and it says so, because
-- a reader who lands on the wrong one gets a plausible and wrong answer.
--
-- THE PRE-MARRIAGE ASSESSMENT IS THE FINDING
--
-- "6 weeks instead of 6 months." A foreign spouse of a Singapore citizen waits
-- up to six months for a decision -- unless the couple completed the free
-- Pre-Marriage LTVP Assessment BEFORE marrying, in which case six weeks.
--
-- The decision that costs four and a half months is taken before the wedding,
-- by people who have no reason yet to be reading immigration pages. Nothing
-- after the marriage can recover it. That is exactly the kind of fact a visa
-- product exists to surface early, and it is the reason this route was worth
-- registering ahead of several easier ones.
--
-- ICA ALSO SAYS THE QUIET PART
--
-- "marriage does not guarantee ltvp approval." Stored verbatim, because the
-- assumption it corrects is close to universal.
--
-- A TRAP THAT SITS WITH ANOTHER MINISTRY
--
-- "existing and former work permit holders ... who wish to marry singapore
-- citizens or permanent residents ... must first seek approval from the
-- controller of work passes. if they fail to do so, their privileges to work in
-- singapore could be withdrawn."
--
-- An ICA page carrying a MOM rule whose penalty is losing the right to work.
-- It binds FORMER holders too, and it applies to civil, religious and customary
-- marriages alike, in Singapore or overseas.
--
-- PARENTS YES, PARENTS-IN-LAW NO
--
-- "note : parent(s)-in-law are not eligible ." One of seven eligibility
-- categories, and the only one stated as an exclusion.
--
-- AND SINGPASS IS ON THE CRITICAL PATH
--
-- Every applicant must review and declare in ICA's e-Service, and a Singpass
-- account takes 2 to 5 working days to approve. ICA advises starting only after
-- everyone has one -- a queue before the queue.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SG'),
  'sg-long-term-visit-pass', 'family',
  'Long-Term Visit Pass (family of a Singapore citizen or permanent resident)',
  'long-term-visit-pass',
  'Stay long-term in Singapore as the spouse, child or parent of a Singapore citizen or permanent resident, or in one of ICA''s other qualifying categories.',
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
   'https://www.ica.gov.sg/reside/LTVP/apply',
   'Becoming a Long-Term Visit Pass holder'),
  -- The spouse-of-a-citizen category, registered in its own right because it
  -- carries the Pre-Marriage LTVP Assessment and the Controller of Work Passes
  -- rule, neither of which is on the hub.
  ('eligibility',
   'https://www.ica.gov.sg/reside/LTVP/apply/spouse-of-a-singapore-citizen-(sc)',
   'Spouse of a Singapore citizen'),
  ('application',
   'https://www.ica.gov.sg/reside/LTVP/cof-and-issue-new',
   'Completion of formalities and issuance of LTVP')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'sg-long-term-visit-pass'
join public.visa_countries c on c.id = t.country_id and c.code = 'SG'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'sg-long-term-visit-pass' and s.active;
  if n <> 3 then raise exception 'Expected 3 active ICA sources, found %.', n; end if;
end $$;
