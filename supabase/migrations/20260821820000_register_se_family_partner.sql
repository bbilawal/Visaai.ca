-- Add Sweden's residence permit to live with a partner. Sweden reaches 4 types,
-- and this is the registry's second family-reunification route this session.
--
-- SWEDEN HAS AN ENGLISH TREE AFTER ALL
--
-- docs/visa-data/COUNTRY_EXPANSION_RESEARCH.md recorded that Migrationsverket's
-- sitemap held "4,028 URLs and zero under /English/", and concluded Sweden was
-- extractable only in Swedish. The first half was true; the conclusion was not.
--
-- The English tree lives at /en/ and holds 1,011 URLs. I searched for the path
-- prefix I already knew and read a null result as absence -- the same mistake as
-- reading UDI's visible <select>, finding no name attribute, and declaring the
-- page JavaScript-only while a hidden input carried the value.
--
-- The three existing Swedish extractions remain correct and stay as they are:
-- they were read from the authoritative Swedish text and every excerpt verifies.
-- New Swedish work can now be done in English, which removes the translation
-- caveat those files carry.
--
-- STRUCTURE: TABS INLINED, NOT ROUTES CONCATENATED
--
-- This is the mirror image of UDI's family page. Migrationsverket gives each
-- family route its OWN url and then inlines that route's four tabs into the
-- main page: 40,183 characters, almost exactly the sum of the tab pages
-- (28,470 + 4,984 + 7,029). So content repeats within the page, but it all
-- belongs to this one route -- sibling routes (child, other relative, parents)
-- live at separate urls and cannot leak in.
--
-- That is why this file declares NO source_bounds while the Norway spouse file
-- does. Repetition inside one route is harmless for attribution; repetition
-- across routes on a shared url is what needs a bound.
--
-- The tab urls are deliberately not registered on top of the main page. They
-- would give the monitor three more pages to diff for the same text and three
-- more chances to attach a requirement to a duplicate version.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SE'),
  'se-family-partner', 'family',
  'Residence permit to live with a partner in Sweden',
  'family-residence-permit-partner',
  'Move to Sweden to live with a spouse, registered partner or cohabiting '
    'partner who lives there.',
  'active', 'unverified', '2026-08-22'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- Two sources. The main page states the rules and the fee; it LINKS the
-- maintenance thresholds rather than stating them, so that page is registered
-- separately instead of having its amounts inferred.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select c.id, t.id, v.role, 'Migrationsverket', 1,
       v.url, v.url, v.title, 'en',
       'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'SE'
cross join (values
  ('requirements',
   'https://www.migrationsverket.se/en/you-want-to-apply/live-with-someone/live-with-a-partner-child-or-other-relative/live-with-a-partner.html',
   'Live with a partner in Sweden'),
  ('eligibility',
   'https://www.migrationsverket.se/en/word-explanations/maintenance-requirement-for-the-person-in-sweden.html',
   'Maintenance requirement for the person in Sweden')
) as v(role, url, title)
where t.visaai_id = 'se-family-partner'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'se-family-partner';
  if n < 2 then raise exception 'Expected 2 sources for se-family-partner, found %.', n; end if;
end $$;
