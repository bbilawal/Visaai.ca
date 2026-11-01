-- Register the UK's Youth Mobility Scheme visa.
--
-- The United Kingdom's seventh visa type, and the registry's first
-- YOUTH_MOBILITY route -- another category the schema has always allowed and
-- nothing had used.
--
-- THE FIRST ROUTE WHERE NATIONALITY CHANGES THE RULE, NOT THE PAPERWORK
--
-- Every conditional requirement stored so far has varied the EVIDENCE by
-- circumstance. This one varies the eligibility itself:
--
--   * 18-35 for Australia, Canada, New Zealand and South Korea; 18-30 for
--     Andorra, Iceland, Japan, Monaco, San Marino, Uruguay and three British
--     nationality categories.
--   * Hong Kong (SAR passport) and Taiwan applicants must win a BALLOT before
--     they may apply at all.
--   * Indian nationals use a different scheme entirely.
--   * Five nationalities each owe a specific criminal-records document from
--     their own state, each under six months old.
--
-- A single flattened checklist would be wrong for nearly every applicant, so
-- each is stored as its own requirement naming the nationalities it binds.
--
-- FRESHNESS: THE GOV.UK PLATFORM REPUBLISH, ALREADY KNOWN
--
-- All three pages carry the identical dateline 2024-10-31T17:00:15 -- to the
-- second. That is the platform-wide republish check-source-freshness.ts learned
-- to discount, not three unrelated visa pages edited at the same instant. It is
-- neither evidence of staleness nor of freshness, and is recorded as such.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  'gb-youth-mobility-scheme', 'youth_mobility',
  'Youth Mobility Scheme visa',
  'youth-mobility-scheme',
  'Live and work in the UK for up to 2 years, if you are from a participating country or territory and within its age band.',
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
  c.id, t.id, v.role, 'UK Visas and Immigration', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('landing', 'https://www.gov.uk/youth-mobility',
   'Youth Mobility Scheme visa: overview'),
  ('requirements', 'https://www.gov.uk/youth-mobility/eligibility',
   'Youth Mobility Scheme visa: eligibility'),
  ('documents', 'https://www.gov.uk/youth-mobility/documents-you-must-provide',
   'Youth Mobility Scheme visa: documents you must provide')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'gb-youth-mobility-scheme'
join public.visa_countries c on c.id = t.country_id and c.code = 'GB'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'gb-youth-mobility-scheme' and s.active;
  if n <> 3 then raise exception 'Expected 3 active GOV.UK sources, found %.', n; end if;
end $$;
