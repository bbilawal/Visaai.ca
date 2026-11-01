-- Lebanon: the 18th destination, admitted on a check that nearly rejected it.
--
-- WHY THE BOILERPLATE CHECK WAS NOT THE ANSWER HERE
--
-- General Security's pages read 16,000–22,000 characters with all four
-- requirement markers, and the boilerplate check scores them at 4%, 10%, 16%
-- and 24% unique. On the headline numbers this looked like the strongest
-- candidate in its batch; on the uniqueness numbers it looked like Japan's
-- navigation shell. Both readings were wrong.
--
-- The site carries an enormous SERVER-RENDERED mega-menu that lists every route
-- it publishes, with its URL, on every page. That menu is why uniqueness is low
-- — and it is also the enumerable index this registry requires before admitting
-- a country. The 4% page (`posts/37`, "Types Of Visas") is almost entirely menu;
-- the 24% page (`posts/159`) carries 59 unique lines of a document table. Same
-- site, same score range, opposite verdicts.
--
-- The lesson is that a uniqueness percentage is a ratio, and a huge shared menu
-- moves the denominator. What settled it was diffing each page against the
-- most menu-like one and reading what SURVIVED, which is now how these excerpts
-- were taken: by line offset out of that diff rather than by hand.
--
-- WHY FOUR ROUTES AND NOT FOURTEEN
--
-- The index enumerates far more than four — artist visas, the domestic-worker
-- entry visa, the six-month bank-statement residence visa, religious students,
-- Iraqi nationals, and more. All are readable and none is registered yet. They
-- are named in every one of these extraction files under `not_extracted`, and
-- in `docs/visa-data/GLOBAL_COVERAGE_EXCEPTIONS.md`, so the gap is a recorded
-- quantity rather than an impression of completeness.
--
-- WHY THE FEE PAGE IS A SEPARATE SOURCE ON THE ANNUAL ROUTE
--
-- Several fee cells on the annual-residence page are printed as `000000 lbp` —
-- the authority's own placeholders. Quoting one would publish a free residence
-- permit. So no fee is taken from that page; the amounts come from the separate
-- published fee schedule, registered as its own `fees` source.

update public.visa_countries
   set support_state             = 'supported',
       immigration_authority     = 'General Directorate of General Security (Lebanon)',
       immigration_authority_url = 'https://www.general-security.gov.lb/en',
       official_visa_url         = 'https://www.general-security.gov.lb/en/posts/37',
       official_languages        = array['ar','en','fr'],
       fee_currency              = 'LBP',
       data_quality              = 'unverified',
       last_verified_at          = '2026-08-26'::timestamptz
 where code = 'LB';

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'LB'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-26'::timestamptz
from (values
  ('lb-entry-visa', 'visitor', 'Entry Visa — terms and conditions', 'entry-visa',
   'Lebanese entry visas across their published sub-types — individual tourism, touristic group, student, medical, embassy appointment, transit, business, family visit and engagement — each with its own documents on top of a shared filing block.'),
  ('lb-permanent-residence', 'permanent_residence', 'Permanent Residence', 'permanent-residence',
   'Lebanese permanent residence over three years (cash guarantee, Arab-national businessperson or investor, or three-year work permit) and over two years (first-category two-year work permit), each with its own fee and passport-validity floor.'),
  ('lb-annual-residence', 'other', 'Annual Residence', 'annual-residence',
   'Lebanese annual residence permits by circumstance — the family of a category-2 worker, the parent of a Lebanese citizen and related cases — together with the authority''s published annual fee schedule by work-permit category.'),
  ('lb-courtesy-residence', 'family', 'Courtesy Residence', 'courtesy-residence',
   'A free temporary Lebanese residence permit for eight defined beneficiary categories, from a Lebanese citizen using a second nationality to a diplomat retiring after service in Lebanon.')
) as v(visaai_id, category, official_name, slug, purpose)
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
  c.id, t.id, v.role,
  'General Directorate of General Security (Lebanon)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('lb-entry-visa', 'requirements',
   'https://www.general-security.gov.lb/en/posts/159',
   'The terms and conditions to grant a Lebanese visa'),
  ('lb-permanent-residence', 'requirements',
   'https://www.general-security.gov.lb/en/posts/5',
   'Permanent residence'),
  ('lb-annual-residence', 'requirements',
   'https://www.general-security.gov.lb/en/posts/241',
   'Annual Residence'),
  ('lb-annual-residence', 'fees',
   'https://www.general-security.gov.lb/en/posts/169',
   'Residence Permit Application Fees'),
  ('lb-courtesy-residence', 'requirements',
   'https://www.general-security.gov.lb/en/posts/6',
   'Courtesy Residence')
) as v(visaai_id, role, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

-- The index itself, registered against the COUNTRY rather than any one route.
-- It is what makes Lebanon admissible, and if it ever stops enumerating routes
-- server-side the daily sync should be the thing that notices.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, null, 'index',
  'General Directorate of General Security (Lebanon)', 1,
  'https://www.general-security.gov.lb/en',
  'https://www.general-security.gov.lb/en',
  'General Security — route index (server-rendered)', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_countries c
where c.code = 'LB'
on conflict do nothing;

do $$
declare
  n_country integer; n_type integer; n_source integer; n_index integer;
begin
  select count(*) into n_country from public.visa_countries
   where code = 'LB' and support_state = 'supported'
     and immigration_authority is not null and fee_currency = 'LBP';
  if n_country <> 1 then
    raise exception 'LB is not registered as a supported country with an authority and an LBP tariff (found %)', n_country;
  end if;

  select count(*) into n_type from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and t.lifecycle_state = 'active';
  if n_type <> 4 then
    raise exception 'Lebanon registers 4 routes in this batch, found %', n_type;
  end if;

  select count(*) into n_source from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id like 'lb-%' and s.active;
  if n_source <> 5 then
    raise exception 'Expected 5 active route sources for Lebanon (annual residence has two), found %', n_source;
  end if;

  select count(*) into n_index from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id
   where c.code = 'LB' and s.visa_type_id is null and s.role = 'index' and s.active;
  if n_index <> 1 then
    raise exception 'Lebanon must register its enumerable index as a country-level source; found %', n_index;
  end if;

  raise notice 'Lebanon registered: 4 routes, 5 route sources + 1 index, awaiting sync';
end $$;
