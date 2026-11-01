-- Register Hong Kong SAR, and the General Employment Policy.
--
-- Hong Kong is the registry's THIRTEENTH destination and its third in Asia.
--
-- FOUND BY READING THE SITE'S OWN LINKS, NOT BY GUESSING
--
-- Two earlier probes of Hong Kong failed and both failures were ours, not the
-- authority's. `www.hk.gov.hk/robots.txt` is unreadable -- a stop. But
-- `www.immd.gov.hk/robots.txt` returns 404, which by the rule Germany set means
-- NO RESTRICTIONS, and the pages we tried simply did not exist: two constructed
-- URLs, two 404s. Reading the Immigration Department's own /eng/services/index
-- produced thirty real visa pages in one fetch.
--
-- That is the third time in this registry that a "blocked" call turned out to
-- be a guessed URL. `scripts/list-source-links.ts` exists for exactly this and
-- was the whole cost of admitting a destination.
--
-- SEPARATELY ADMINISTERED JURISDICTION
--
-- Hong Kong is part of the People's Republic of China and administers its own
-- immigration under the Basic Law. A PRC passport does not admit its holder;
-- mainland Chinese residents are expressly OUTSIDE the GEP and routed to a
-- different scheme. This is precisely the case the spec's "separately
-- administered visa jurisdictions" requirement exists for, and the country row
-- says so rather than leaving a reader to infer it from the visa rules.
--
-- ONE URL, TWO FLOWS -- SO THE EXTRACTION IS BOUNDED
--
-- `GEP.html` is a tabbed page carrying BOTH the entry application and the
-- extension of stay, each with its own eligibility criteria, supporting
-- documents, processing time and fee section. "processing time" occurs four
-- times on it. An unbounded extraction would mix a first application with a
-- renewal, and every excerpt would still verify.
--
-- The extraction declares `source_bounds` with text anchors -- start at the
-- entry introduction, end before "extension of stay apply now" -- and
-- `scripts/verify-extraction-bounds.ts` checks them.
--
-- WHAT THE AUTHORITY SAYS ABOUT ITS OWN DISCRETION
--
-- "the director of immigration reserves absolute discretion to refuse any
-- application even if the application meets all eligibility criteria."
--
-- Stated twice on the page. No other authority in this registry says it that
-- plainly, and a checklist that implies meeting the criteria is sufficient
-- would be contradicting the source it cites.
--
-- CURRENCY
--
-- HKD. The top-tier employment stream threshold is stated as HK$2 million of
-- assessable income for salaries tax.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, foreign_affairs_authority_url,
  official_visa_url, evisa_portal_url,
  official_languages, fee_currency, support_state,
  data_quality, last_verified_at, jurisdiction_note
) values (
  'HK', 'Hong Kong SAR', 'hong-kong',
  'Immigration Department of the Hong Kong Special Administrative Region',
  'https://www.immd.gov.hk/eng/',
  null, null,
  'https://www.immd.gov.hk/eng/services/index.html',
  'https://www.immd.gov.hk/eng/online-services/index.html',
  '{zh,en}', 'HKD', 'supported', 'verified', '2026-08-24'::timestamptz,
  'Hong Kong is part of the People''s Republic of China and administers its own '
  'immigration under the Basic Law, so it is registered as its own destination '
  'rather than under CN. A PRC passport does not admit its holder: mainland '
  'Chinese residents are expressly excluded from the General Employment Policy '
  'and routed to the Admission Scheme for Mainland Talents and Professionals. '
  'Macao SAR residents, Taiwan residents and overseas Chinese holding PRC '
  'passports each have their own arrangements on the same pages. No separate '
  'foreign affairs authority is recorded -- the Immigration Department issues '
  'visas and entry permits itself, and the Office of the Commissioner of the '
  'Ministry of Foreign Affairs handles a different set of questions. Since 28 '
  'December 2021 visas are issued as "e-Visa" only.'
)
on conflict (code) do update set
  immigration_authority = excluded.immigration_authority,
  official_visa_url = excluded.official_visa_url,
  support_state = excluded.support_state,
  jurisdiction_note = excluded.jurisdiction_note,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'HK'),
  'hk-general-employment-policy', 'work',
  'General Employment Policy (GEP)', 'GEP',
  'general-employment-policy',
  'Work in Hong Kong as a professional with a confirmed job offer, under the quota-free and non-sector-specific General Employment Policy.',
  'active', 'unverified', '2026-08-24'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- URL read off the Department's own /eng/services/index.html, not constructed.
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
   'https://www.immd.gov.hk/eng/services/visas/GEP.html',
   'General Employment Policy')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'hk-general-employment-policy'
join public.visa_countries c on c.id = t.country_id and c.code = 'HK'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'hk-general-employment-policy' and s.active;
  if n <> 1 then raise exception 'Expected 1 active ImmD source, found %.', n; end if;
end $$;
