-- Register Singapore's EntrePass -- the exception that proves the Singapore rule.
--
-- THE ONE MOM PASS YOU APPLY FOR YOURSELF
--
-- Every other Ministry of Manpower work pass is applied for by the employer.
-- The Employment Pass says "an employer or appointed employment agent needs to
-- apply on behalf of the candidate". EntrePass says, in the same table position
-- on the same kind of page: "candidate can apply directly."
--
-- That single row changes who the checklist is FOR. Nothing here is somebody
-- else's to satisfy, which is exactly why the bar sits somewhere else entirely.
--
-- NO SALARY FLOOR, AND THAT IS NOT A CONCESSION
--
-- "minimum salary: no stipulated minimum salary." The Employment Pass gates on
-- a salary a Singapore employer has agreed to pay. EntrePass has no employer to
-- gate on, so it gates on the BUSINESS: an ACRA-registered private limited
-- company in which the applicant holds at least 30%, that is venture-backed or
-- owns innovative technologies, AND at least one of five innovation criteria --
-- SGD 100,000 raised in a single round, an accelerator, a founded-and-sold
-- technology business, registered intellectual property, or a live research
-- collaboration with a Singapore IHL or research institute.
--
-- A SIX-LINE LIST THAT ENDS MOST APPLICATIONS
--
-- MOM names businesses that are not eligible at all: coffee shops, hawker
-- centres and food courts; bars, night clubs and karaoke lounges; foot
-- reflexology and massage parlours; acupuncture, TCM and herbal dispensing;
-- employment agencies; geomancy. No amount of funding moves a business off that
-- list, and it is the fastest disqualification on this route.
--
-- THE TWELVE-MONTH CLIFF
--
-- "if the registered company is more than 12 months old as of the date of
-- application, you will be assessed according to the renewal criteria." An
-- applicant who incorporates first and applies later is judged on results
-- rather than on a plan, without ever having held the pass.
--
-- AND THE PASS IS NOT THE PERMISSION TO TRADE
--
-- "getting an entrepass is not a guarantee that your business registration and
-- licences will get approved." Immigration permission and business permission
-- are separate systems with separate regulators, and MOM says so on its own
-- application page.
--
-- ROLE VOCABULARY
--
-- Four sources, mapping cleanly this time: eligibility criteria, pass facts,
-- required documents, application procedure.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SG'),
  'sg-entrepass', 'entrepreneur',
  'EntrePass',
  'entrepass',
  'Start and operate a venture-backed or innovative-technology business in Singapore as a foreign entrepreneur.',
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
   'https://www.mom.gov.sg/passes-and-permits/entrepass/eligibility',
   'Eligibility for EntrePass'),
  ('eligibility',
   'https://www.mom.gov.sg/passes-and-permits/entrepass/key-facts',
   'Key facts on EntrePass'),
  ('documents',
   'https://www.mom.gov.sg/passes-and-permits/entrepass/documents-required',
   'Documents required for EntrePass'),
  ('application',
   'https://www.mom.gov.sg/passes-and-permits/entrepass/apply-for-a-pass',
   'Apply for an EntrePass')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'sg-entrepass'
join public.visa_countries c on c.id = t.country_id and c.code = 'SG'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'sg-entrepass' and s.active;
  if n <> 4 then raise exception 'Expected 4 active MOM sources, found %.', n; end if;
end $$;
