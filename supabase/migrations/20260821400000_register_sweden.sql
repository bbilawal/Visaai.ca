-- Register Sweden and the Schengen visa. FIRST NON-ENGLISH SOURCE IN THE
-- REGISTRY, deliberately, and the reasoning matters more than the rows.
--
-- WHY SWEDISH AND NOT ENGLISH
--
-- Migrationsverket's English page,
-- /English/private-individuals/visiting-sweden.html, returns 200 and is 1,771
-- characters: a few sentences and a news item. It states no requirement.
--
-- Its sitemap settles why. `sitemapindex.xml` -> `sitemap1.xml.gz` holds 4,028
-- URLs and **zero** under `/English/`. The English tree is a courtesy summary;
-- the authoritative content is Swedish, and the visa page under
-- /du-vill-ansoka/ ("you want to apply") is 34,417 characters of real
-- requirements — passport validity, return ticket, 700 SEK per day, EUR 30,000
-- insurance cover, the full fee schedule.
--
-- Registering the English stub would have produced a page with a "verified"
-- badge and nothing behind it. Registering nothing would have dropped a
-- destination whose requirements are plainly published.
--
-- WHAT THIS COSTS, STATED PLAINLY
--
-- `visa_sources.language` is 'sv'. Every `source_excerpt` for this visa type is
-- Swedish. `scripts/verify-excerpts.ts` still proves each one is verbatim —
-- that check is language-agnostic, and it is the check that makes provenance
-- real.
--
-- What a non-Swedish-reading reviewer CANNOT check is whether the English
-- `label` and `description` faithfully render the Swedish quote. That is a
-- genuine reduction in reviewability and it is recorded in the extraction
-- file's `translation_note` rather than left for someone to discover.
--
-- ROBOTS
--
-- www.migrationsverket.se/robots.txt fetched and read: four user-agent groups;
-- the `*` group has 16 Disallow entries, none matching /du-vill-ansoka/.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  official_visa_url, official_languages, fee_currency, support_state,
  data_quality, last_verified_at, jurisdiction_note
) values (
  'SE', 'Sweden', 'sweden',
  'Migrationsverket (Swedish Migration Agency)',
  'https://www.migrationsverket.se/',
  'https://www.migrationsverket.se/du-vill-ansoka/besoka-sverige.html',
  '{sv,en}', 'EUR', 'supported', 'verified', '2026-08-22'::timestamptz,
  'Requirements are sourced from Migrationsverket''s SWEDISH pages. The English '
  'site is a summary that states no requirements, and Migrationsverket''s '
  'sitemap contains no /English/ URLs at all. Fees are quoted in EUR because '
  'the Schengen visa fee is set in EUR, while the maintenance requirement is in SEK.'
)
on conflict (code) do update set
  immigration_authority = excluded.immigration_authority,
  support_state = excluded.support_state,
  jurisdiction_note = excluded.jurisdiction_note,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SE'),
  'se-schengen-visa', 'visitor', 'Schengenvisum (Schengen visa)', 'schengen-visa',
  'Visit Sweden and the Schengen area for up to 90 days in any 180-day period.',
  'active', 'unverified', '2026-08-22'::timestamptz
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
  c.id, t.id, v.role, 'Migrationsverket (Swedish Migration Agency)', 1,
  v.url, v.url, v.title, 'sv',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.migrationsverket.se/du-vill-ansoka/besoka-sverige/besoka-sverige-upp-till-90-dagar-visum.html',
   'Besöka Sverige upp till 90 dagar - visum'),
  ('landing',
   'https://www.migrationsverket.se/du-vill-ansoka/besoka-sverige.html',
   'Besöka Sverige')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'se-schengen-visa'
join public.visa_countries c on c.id = t.country_id and c.code = 'SE'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'se-schengen-visa' and s.language = 'sv';
  if n <> 2 then raise exception 'Expected 2 Swedish-language sources, found %.', n; end if;
end $$;
