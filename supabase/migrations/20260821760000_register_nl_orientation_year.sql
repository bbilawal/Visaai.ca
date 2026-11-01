-- Add the Netherlands orientation year residence permit. NL now has 4 types.
--
-- The "zoekjaar": a year to look for work in the Netherlands after graduating,
-- completing a doctorate, or conducting research there. High demand among
-- graduates and structurally unlike the other three Dutch permits already in
-- the registry, none of which is a job-search permit.
--
-- WHAT MAKES THIS ONE UNUSUAL TO EXTRACT
--
-- Eligibility is a set of ALTERNATIVE routes rather than a list of conditions
-- to satisfy together — Dutch degree, Erasmus Mundus master's, scientific
-- research, or a foreign degree from a highly-ranked institution. IND writes
-- "one of these situations applies to you", and recording them as parallel
-- conditions would imply an applicant needs all four.
--
-- The foreign-degree route is the sharpest: the institution must be in the top
-- 200 of at least TWO of three named ranking publishers, on the graduation
-- date. That is a live external test, not a static rule, and it is the kind of
-- criterion a from-memory answer states loosely or gets backwards.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NL'),
  'nl-orientation-year', 'work',
  'Residence permit for orientation year', 'orientation-year',
  'Look for work in the Netherlands for a year after graduating, completing a '
    'doctorate, or conducting scientific research.',
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
  c.id, t.id, 'requirements', 'Immigratie- en Naturalisatiedienst (IND)', 1,
  'https://ind.nl/en/residence-permits/work/residence-permit-for-orientation-year',
  'https://ind.nl/en/residence-permits/work/residence-permit-for-orientation-year',
  'Residence permit for orientation year', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'NL'
where t.visaai_id = 'nl-orientation-year'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'nl-orientation-year';
  if n < 1 then raise exception 'Orientation year source not registered.'; end if;
end $$;
