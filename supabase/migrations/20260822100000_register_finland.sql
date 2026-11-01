-- Register Finland, and its residence permit for an employed person.
--
-- Finland is the registry's TENTH destination and its second Nordic one. The
-- probe that admitted it is now a script rather than a paragraph:
-- `apps/api/scripts/probe-authority.ts` runs the four checks this document set
-- learned one failure at a time -- robots readability, server-side text volume,
-- requirement-shaped language, and FRESHNESS -- and Finland passes all four.
--
-- TWO AUTHORITIES, AND ONLY ONE OF THEM WILL LET US READ IT
--
-- Finland splits its entry regime between two bodies:
--
--   * Maahanmuuttovirasto / the Finnish Immigration Service (Migri) issues
--     RESIDENCE PERMITS. migri.fi/robots.txt returns 200 with 9 disallow lines,
--     none matching the permit pages, and declares Crawl-delay: 5.
--   * The Ministry for Foreign Affairs (um.fi) issues SHORT-STAY SCHENGEN
--     VISAS. um.fi/robots.txt reads fine and allows the path -- and the page
--     itself returns 403 to an identified agent.
--
-- So Finland enters the registry as a residence-permit destination only. The
-- Schengen visa is NOT registered here, because a source we cannot read is not
-- a source; recording it as a visa type with no reachable page would put a
-- fourth "BLOCKED BY OFFICIAL SOURCE" row in the coverage matrix and teach a
-- reader nothing. Sweden's Schengen visa already covers that route for the
-- same border.
--
-- FRESHNESS: NO DATELINE, BUT A BETTER SIGNAL
--
-- Migri publishes no dateModified on these pages, which by the rule established
-- for Germany means "unknown", never "fresh". What it publishes instead is
-- stronger: a monthly processing-situation block. The employed-person page
-- states "in july 2026, the average processing time ... was 17 days" and counts
-- applications "since the beginning of 2026". A page cannot carry last month's
-- statistics and be five years old. The income figure it states is itself
-- year-stamped -- "at least eur 1,600 per month in 2026" -- which is exactly
-- the shape Sweden's Blue Card threshold took: a snapshot that names its year.
--
-- CURRENCY
--
-- EUR, and unlike Sweden there is no split: fees and the income requirement are
-- both published in euros.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, foreign_affairs_authority_url,
  official_visa_url, evisa_portal_url,
  official_languages, fee_currency, support_state,
  data_quality, last_verified_at, jurisdiction_note
) values (
  'FI', 'Finland', 'finland',
  'Maahanmuuttovirasto (Finnish Immigration Service, Migri)',
  'https://migri.fi/en/home',
  'Ulkoministeriö (Ministry for Foreign Affairs of Finland)',
  'https://um.fi/frontpage',
  'https://migri.fi/en/i-want-a-residence-permit',
  'https://enterfinland.fi/eServices',
  '{fi,sv,en}', 'EUR', 'supported', 'verified', '2026-08-23'::timestamptz,
  'Finland splits entry between two authorities. Residence permits are Migri''s, '
  'and migri.fi is readable by an identified agent. Short-stay Schengen visas '
  'are the Ministry for Foreign Affairs'', and um.fi returns 403 to the same '
  'agent, so no Finnish short-stay visa type is registered. Migri publishes an '
  'authoritative English tree at /en/ -- unlike Migrationsverket, whose English '
  'pages are summaries -- so sources are English and directly reviewable.'
)
on conflict (code) do update set
  immigration_authority = excluded.immigration_authority,
  foreign_affairs_authority = excluded.foreign_affairs_authority,
  support_state = excluded.support_state,
  jurisdiction_note = excluded.jurisdiction_note,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'FI'),
  'fi-employed-person', 'work',
  'Residence permit application for an employed person (TTOL)', 'OLE_TY1',
  'residence-permit-employed-person',
  'Work in Finland for a Finnish employer, or an employer operating in Finland, with confirmed employment before applying.',
  'active', 'unverified', '2026-08-23'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- Both URLs were READ OFF the site with scripts/list-source-links.ts, from the
-- /en/work-in-finland navigation, not constructed from the URL pattern.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, v.role,
  'Maahanmuuttovirasto (Finnish Immigration Service, Migri)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://migri.fi/en/residence-permit-for-an-employed-person',
   'Residence permit application for an employed person (TTOL)'),
  ('eligibility',
   'https://migri.fi/en/first-residence-permit',
   'First residence permit')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'fi-employed-person'
join public.visa_countries c on c.id = t.country_id and c.code = 'FI'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'fi-employed-person' and s.active;
  if n <> 2 then raise exception 'Expected 2 active Migri sources, found %.', n; end if;
end $$;
