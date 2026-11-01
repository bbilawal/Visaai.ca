-- The last three Austrian routes: other key workers, family reunification, and
-- other forms of settlement. Austria is complete at ELEVEN routes, not thirteen.
--
-- WHY ELEVEN AND NOT THIRTEEN
--
-- The index enumerates thirteen URLs and two of them are not routes.
-- `austria-wide-shortage-occupations` and `regional-shortage-occupations` are
-- OCCUPATION LISTS — pages of German job titles, region-tagged in the second
-- case — that the skilled-worker route points at. They have no requirements of
-- their own, and registering them as visa types would invent two routes nobody
-- can apply for.
--
-- That distinction only became visible by reading the pages. An enumerable index
-- tells you what URLs exist, not which of them are routes.
--
-- WHAT THESE THREE ADD
--
-- Other key workers has the widest language option found anywhere in this
-- registry: German at A1, A2 or B1, OR English at A2 or B1.
--
-- Family reunification turns on the SPONSOR as much as the applicant, and
-- carries the only explicit waiver extracted so far — a newborn's first
-- application within six months of birth needs no travel document.
--
-- Other forms of settlement is a group of titles rather than one route, and its
-- two thresholds are not alternatives: A1 German applies when first applying for
-- a settlement permit excluding gainful employment, while five years'
-- uninterrupted residence entitlement belongs to a different title in the group.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'AT'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-25'::timestamptz
from (values
  ('at-rwr-other-key-workers', 'work', 'Red-White-Red Card – Other Key Workers',
   'red-white-red-card-other-key-workers',
   'Austrian work and residence permit for other key workers, admitted on a 55-point score, with German at A1 to B1 or English at A2 to B1 accepted for the language criterion.'),
  ('at-family-reunification', 'family', 'Family Reunification',
   'family-reunification',
   'Austrian residence title for family members of third-country nationals, assessed on subsistence, health insurance and accommodation adequate for the family size, with German normally required before immigration.'),
  ('at-other-forms-of-settlement', 'permanent_residence', 'Other Forms of Settlement',
   'other-forms-of-settlement',
   'Austrian settlement titles outside the Red-White-Red framework, including the artist settlement permit and titles for people already lawfully resident for five years.')
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
  c.id, t.id, 'requirements',
  'Migration Platform of the Austrian Federal Government', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('at-rwr-other-key-workers',
   'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/other-key-workers/', 'Other Key Workers'),
  ('at-family-reunification',
   'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/family-reunification/', 'Family Reunification'),
  ('at-other-forms-of-settlement',
   'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/other-forms-of-settlement/', 'Other Forms of Settlement')
) as v(visaai_id, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n_t integer; n_total integer;
begin
  select count(*) into n_t from public.visa_types
   where visaai_id in ('at-rwr-other-key-workers','at-family-reunification','at-other-forms-of-settlement')
     and lifecycle_state = 'active';
  if n_t <> 3 then raise exception 'Expected 3 final Austrian visa types, found %', n_t; end if;

  -- Austria must total ELEVEN routes. If this ever reads thirteen, somebody has
  -- registered the two occupation LISTS as routes.
  select count(*) into n_total from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'AT' and t.lifecycle_state = 'active';
  if n_total <> 11 then
    raise exception 'Austria should have 11 routes (13 index URLs minus 2 occupation lists), found %', n_total;
  end if;

  raise notice 'Austria complete: 11 routes registered (2 of the 13 index URLs are occupation lists, not routes)';
end $$;
