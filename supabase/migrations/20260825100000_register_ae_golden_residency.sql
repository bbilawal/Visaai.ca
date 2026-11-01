-- Register the United Arab Emirates and its Golden Residency route.
--
-- The 14th destination, and the first admitted under the scope decision of
-- 2026-08-24 that cut the baseline from 195 countries to 37.
--
-- WHY THE UAE WAS CHOSEN FIRST
--
-- It was the best-evidenced of the 24 countries probed. Every gate passed, and
-- one of them nothing else passed cleanly:
--
--   robots.txt         200, the path ALLOWED.
--   catalogue          the services index enumerates its routes SERVER-SIDE, so
--                      the URLs below were READ off the site rather than
--                      constructed. Denmark failed exactly here: its leaf pages
--                      are readable and its navigation is entirely client-side,
--                      so its list of permits cannot be obtained at all.
--   content            11,225 characters, markers for requirement, eligibility,
--                      document, fee and valid passport, 93% of lines unique
--                      against the index — page content, not menu.
--   FRESHNESS          a published dateline of 2026-08-20. Austria is otherwise
--                      as good and publishes no date anywhere, which is the
--                      German failure mode: a five-year-old page presenting as
--                      current, invisible to every reachability check. China's
--                      English pages are richer still — 55,000 characters — and
--                      their most recent year reference is 2021, which is why
--                      China is not this migration.
--
-- ONE ROUTE, SIX ELIGIBILITY TESTS
--
-- The Golden Residency is not a single checklist. Investors, humanitarian
-- pioneers, entrepreneurs, outstanding students, exceptional talent and
-- real-estate investors each have their own duration and their own documents.
-- The requirements are therefore scoped to a category in their labels. Flattened
-- into one list they would tell an entrepreneur they need AED 2 million in an
-- accredited investment fund, which the authority does not say.
--
-- WHAT IS DELIBERATELY NOT REGISTERED
--
-- Visit and tourist visas. The ICP index enumerates only the Blue, Green and
-- Golden Residency routes; short-stay entry is administered partly by the
-- emirate-level GDRFA authorities, which have not been probed. This registers
-- what this authority's own index publishes, and the catalogue claim is scoped
-- to exactly that rather than to UAE entry policy as a whole.

update public.visa_countries
   set support_state        = 'supported',
       immigration_authority = 'Federal Authority for Identity, Citizenship, Customs & Port Security (ICP)',
       immigration_authority_url = 'https://icp.gov.ae/en/',
       official_visa_url    = 'https://icp.gov.ae/en/services-details',
       official_languages   = array['ar','en'],
       fee_currency         = 'AED',
       data_quality         = 'unverified',
       last_verified_at     = '2026-08-25'::timestamptz
 where code = 'AE';

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AE'),
  'ae-golden-residency', 'permanent_residence',
  'Golden Residency',
  'golden-residency',
  'Long-term UAE residency of five or ten years with automatic renewal and no sponsor, granted to investors, entrepreneurs, outstanding students, humanitarian pioneers and people with exceptional talent.',
  'active', 'unverified', '2026-08-25'::timestamptz
)
on conflict (visaai_id) do update set
  official_name    = excluded.official_name,
  purpose          = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'landing',
  'Federal Authority for Identity, Citizenship, Customs & Port Security (ICP)', 1,
  'https://icp.gov.ae/en/services/uae-golden-residency/',
  'https://icp.gov.ae/en/services/uae-golden-residency/',
  'Golden Residency Guide', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_countries c
join public.visa_types t on t.visaai_id = 'ae-golden-residency'
where c.code = 'AE'
on conflict do nothing;

-- Assert what this migration claims, before it commits. Every registration
-- migration in this repository does the same, and one of them has already
-- refused to commit on a claim that turned out to be false.
do $$
declare
  n_country integer;
  n_type    integer;
  n_source  integer;
begin
  select count(*) into n_country from public.visa_countries
   where code = 'AE' and support_state = 'supported'
     and immigration_authority is not null;
  if n_country <> 1 then
    raise exception 'AE is not registered as a supported country with an authority (found %)', n_country;
  end if;

  select count(*) into n_type from public.visa_types
   where visaai_id = 'ae-golden-residency' and lifecycle_state = 'active';
  if n_type <> 1 then
    raise exception 'Expected 1 active ae-golden-residency visa type, found %', n_type;
  end if;

  select count(*) into n_source from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id = 'ae-golden-residency' and s.active;
  if n_source <> 1 then
    raise exception 'Expected 1 active ICP source, found %', n_source;
  end if;

  -- The page must NOT be publishable yet: no requirement has been extracted,
  -- reviewed and promoted at this point, and visa_publishable_pages requires at
  -- least one active OFFICIAL requirement. If this were already publishable the
  -- promotion queue would be decorative.
  if exists (select 1 from public.visa_publishable_pages where visaai_id = 'ae-golden-residency') then
    raise exception 'ae-golden-residency is publishable before any requirement was promoted';
  end if;

  raise notice 'UAE registered: 1 country, 1 visa type, 1 source, 0 publishable pages (as expected)';
end $$;
