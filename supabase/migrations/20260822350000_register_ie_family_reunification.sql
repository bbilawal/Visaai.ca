-- Register Ireland's non-EEA family reunification route with an Irish national.
--
-- Ireland's fifth visa type, and its first family route.
--
-- THE MONEY IS THE ROUTE
--
-- Ireland's policy turns almost entirely on the SPONSOR'S income, and ISD
-- publishes the figures on one page that is easy to miss from the route pages.
-- They are the hardest numbers to find in this registry and among the highest
-- anywhere in it: EUR 75,000 cumulative over three years for an Irish citizen
-- sponsoring a spouse, and EUR 96,929 a YEAR to sponsor a single dependent adult
-- relative.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- The per-category application pages -- spouse, de facto partner, dependent
-- parent, minor child, dependent adult child -- are rendered client-side by
-- irishimmigration.ie and are absent from the server-side HTML. Their conditions
-- are therefore NOT in this registry, and the extraction says so rather than
-- filling them in.
--
-- That is the same choice made for New Zealand's working-holiday country list
-- earlier today, and it is worth naming as a pattern: when an authority hides
-- part of a route behind client-side rendering, VisaAI publishes the part it can
-- read, links the authority for the rest, and states which is which. The
-- alternative -- a page that looks complete and silently omits the conditions
-- that decide the case -- is the failure mode this whole registry exists to
-- prevent.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'IE'),
  'ie-family-reunification-non-eea', 'family_reunification',
  'Non-EEA family reunification: joining an Irish national',
  'family-reunification-joining-an-irish-national',
  'Join an Irish national family member in Ireland as a non-EEA spouse, partner, child or dependent relative.',
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
  c.id, t.id, v.role, 'Immigration Service Delivery', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.irishimmigration.ie/coming-to-join-family-in-ireland/joining-an-irish-national/',
   'Joining an Irish national'),
  ('policy',
   'https://www.irishimmigration.ie/coming-to-join-family-in-ireland/financial-thresholds/',
   'Financial thresholds for non-EEA family reunification')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'ie-family-reunification-non-eea'
join public.visa_countries c on c.id = t.country_id and c.code = 'IE'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'ie-family-reunification-non-eea' and s.active;
  if n <> 2 then raise exception 'Expected 2 active ISD sources, found %.', n; end if;
end $$;
