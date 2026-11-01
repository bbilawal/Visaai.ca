-- Register New Zealand, its visitor visa, and two readable INZ sources.
--
-- First destination added since the original four (CA, GB, US, AU), and the
-- first to go through the pipeline built during that work rather than a bulk
-- seed generator.
--
-- WHY NEW ZEALAND FIRST
--
-- docs/visa-data/COUNTRY_EXPANSION_RESEARCH.md probed five candidate
-- authorities with the source monitor's OWN fetcher — not a browser — because
-- that distinction is the whole lesson of Australia, where the site renders
-- fine in Chrome and returns 403 to an identified agent. All five are readable.
-- New Zealand was recommended first on cost: English, clear structure, familiar
-- visa vocabulary.
--
-- ROBOTS
--
-- www.immigration.govt.nz/robots.txt was fetched and read. Three user-agent
-- groups; the `*` group disallows /admin, /Security/, /_search/, /_visa-search/
-- and /_list-collection-search/. Neither path below is under any of them, and
-- no Crawl-delay is published for `*` — the monitor's own 2s per-host pause
-- applies regardless. Verified, not assumed.
--
-- THE TWO SOURCES, AND WHY ONLY TWO
--
-- INZ's per-visa detail page carries the whole substance: who may apply, the
-- health and character rules with their duration thresholds, the funds
-- thresholds, the fee and the stay length. It is registered as `requirements`.
--
-- `/visit/` is the section index and is registered as `landing` so the monitor
-- notices structural changes to the section.
--
-- Deliberately NOT registered: /visit/what-you-need-to-visit-new-zealand/.
-- It reads like a requirements page and is a router — it explains that a
-- traveller needs a visa or an NZeTA and links onward. Registering a page that
-- states no requirement gives the monitor something to diff and an extractor
-- nothing to quote.
--
-- support_state is 'preview', not 'supported'. One visa type with requirements
-- is not a supported destination, and claiming otherwise on the public pages
-- would be the same unearned claim the registry exists to prevent.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  official_visa_url, official_languages, fee_currency, support_state,
  data_quality, last_verified_at
) values (
  'NZ', 'New Zealand', 'new-zealand',
  'Immigration New Zealand',
  'https://www.immigration.govt.nz/',
  'https://www.immigration.govt.nz/new-zealand-visas',
  '{en}', 'NZD', 'preview', 'verified', '2026-08-21'::timestamptz
)
on conflict (code) do update set
  immigration_authority = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  official_visa_url = excluded.official_visa_url,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NZ'),
  'nz-visitor-visa', 'visitor', 'Visitor Visa', 'visitor-visa',
  'Visit New Zealand for a holiday, to see family or friends, or to study for '
    'up to 3 months.',
  'active', 'unverified', '2026-08-21'::timestamptz
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
  c.id, t.id, v.role, 'Immigration New Zealand', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/visitor-visa',
   'Visitor Visa'),
  ('landing',
   'https://www.immigration.govt.nz/visit/',
   'Visit New Zealand')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'nz-visitor-visa'
join public.visa_countries c on c.id = t.country_id and c.code = 'NZ'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n
  from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'nz-visitor-visa';
  if n <> 2 then
    raise exception 'Expected 2 INZ sources for nz-visitor-visa, found %.', n;
  end if;
end $$;
