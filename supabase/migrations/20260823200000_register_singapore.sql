-- Register Singapore, and its Employment Pass.
--
-- Singapore is the registry's ELEVENTH destination, its first in Asia, and the
-- first whose entry regime is split not by document type but by WHO THE
-- APPLICANT IS TO THE STATE: a visitor is the Immigration & Checkpoints
-- Authority's business, a worker is the Ministry of Manpower's, and the two
-- publish on separate estates with separate rules.
--
-- TWO AUTHORITIES, BOTH READABLE
--
--   * Immigration & Checkpoints Authority (ICA), www.ica.gov.sg -- entry visas,
--     visit passes, Student's Pass, Long-Term Visit Pass. robots.txt 200 with
--     ZERO disallow lines.
--   * Ministry of Manpower (MOM), www.mom.gov.sg -- every work pass:
--     Employment Pass, S Pass, EntrePass, ONE Pass, Work Permit, Dependant's
--     Pass. robots.txt 200 with 13 disallow lines, none matching the pass pages.
--
-- This is the same shape as Finland's split, with the opposite outcome. Finland
-- entered as a residence-permit destination only because um.fi 403s an
-- identified agent. Both of Singapore's authorities serve full server-side text
-- to ours -- ICA's visa page normalizes to 5,148 characters, MOM's Employment
-- Pass eligibility page to 22,328 -- so Singapore enters whole.
--
-- THE APPLICANT IS NOT THE APPLICANT
--
-- Worth naming before the first requirement is read: for every MOM work pass,
-- the person who applies is the EMPLOYER, not the worker. MOM states it as a
-- pass fact -- "an employer or appointed employment agent needs to apply on
-- behalf of the candidate". Half the Employment Pass criteria bind the hiring
-- firm and cannot be satisfied by the candidate at all. Canada's Super Visa
-- introduced requirements that bind somebody else; Singapore makes that the
-- normal case rather than the exception.
--
-- FRESHNESS: TWO DIFFERENT SIGNALS, BOTH REAL
--
-- Neither authority publishes dateModified in its head. ICA prints its own
-- dateline in the page body -- "last updated on 25 june 2026". MOM stamps
-- changed pages with a machine-readable update marker in the body
-- ("2026-04-28-08:45:48" on the Employment Pass eligibility page,
-- "2026-05-18-15:45:18" on documents required) next to "there are updates on
-- this page". Both are edit records, not build timestamps -- distinct per page
-- and minutes apart, which is the discriminator check-source-freshness.ts uses.
-- The eligibility page carries salary tables dated for 1 Jan 2027, which a
-- stale page cannot.
--
-- CURRENCY
--
-- SGD. MOM prints fees as bare "$105" and "$225"; those are Singapore dollars,
-- and the registry stores the currency explicitly so a reader never has to
-- assume it.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, foreign_affairs_authority_url,
  official_visa_url, evisa_portal_url,
  official_languages, fee_currency, support_state,
  data_quality, last_verified_at, jurisdiction_note
) values (
  'SG', 'Singapore', 'singapore',
  'Immigration & Checkpoints Authority (ICA)',
  'https://www.ica.gov.sg/',
  'Ministry of Foreign Affairs Singapore',
  'https://www.mfa.gov.sg/',
  'https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements',
  'https://eservices.ica.gov.sg/sgarrivalcard/',
  '{en,ms,zh,ta}', 'SGD', 'supported', 'verified', '2026-08-23'::timestamptz,
  'Singapore splits entry between two authorities and both are readable by an '
  'identified agent. The Immigration & Checkpoints Authority (ICA) decides who '
  'may ENTER -- entry visas, visit passes, Student''s Pass, Long-Term Visit '
  'Pass. The Ministry of Manpower (MOM) decides who may WORK -- Employment '
  'Pass, S Pass, EntrePass, ONE Pass, Work Permit, Dependant''s Pass -- and for '
  'every MOM pass the APPLICANT IS THE EMPLOYER, not the worker. Sources are '
  'therefore registered against whichever of the two authorities actually owns '
  'the rule, and authority_rank is 1 for both: neither is secondary to the '
  'other, they simply govern different questions.'
)
on conflict (code) do update set
  immigration_authority = excluded.immigration_authority,
  foreign_affairs_authority = excluded.foreign_affairs_authority,
  support_state = excluded.support_state,
  jurisdiction_note = excluded.jurisdiction_note,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SG'),
  'sg-employment-pass', 'work',
  'Employment Pass',
  'employment-pass',
  'Work in Singapore as a foreign professional, manager, executive or technician with a job offer from a Singapore employer.',
  'active', 'unverified', '2026-08-23'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- All four URLs were READ OFF the site with scripts/list-source-links.ts from
-- MOM's own /passes-and-permits navigation, not constructed from the pattern.
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
   'https://www.mom.gov.sg/passes-and-permits/employment-pass/eligibility',
   'Eligibility for Employment Pass'),
  ('eligibility',
   'https://www.mom.gov.sg/passes-and-permits/employment-pass/key-facts',
   'Key facts on Employment Pass'),
  ('documents',
   'https://www.mom.gov.sg/passes-and-permits/employment-pass/documents-required',
   'Documents required for Employment Pass'),
  ('application',
   'https://www.mom.gov.sg/passes-and-permits/employment-pass/apply-for-a-pass',
   'Apply for an Employment Pass')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'sg-employment-pass'
join public.visa_countries c on c.id = t.country_id and c.code = 'SG'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'sg-employment-pass' and s.active;
  if n <> 4 then raise exception 'Expected 4 active MOM sources, found %.', n; end if;
end $$;
