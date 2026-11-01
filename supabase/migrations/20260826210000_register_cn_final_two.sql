-- China completes the five service guides its own index enumerates.
-- China goes 3 -> 5 routes.
--
-- The two added here are the ones each earlier China extraction named under
-- `not_extracted` as "readable and not yet extracted". That note is now false,
-- and every China extraction file is updated in the same commit so the ledger
-- does not describe finished work as a gap.
--
-- WHAT THESE TWO ARE
--
-- The exit-entry permit is for a foreigner already in China with no usable
-- passport — lost, damaged, stolen or robbed — whose own embassy cannot replace
-- it. The travel permit is permission to go to places NOT OPEN to foreigners.
-- Neither is a visa, and both are decided within 30 WORKING days, which is the
-- kind of distinction (working vs calendar) that decides whether somebody makes
-- a flight.
--
-- The sixty-day rule on the travel permit is the sharpest number in either
-- guide: a tour group's reception plan must reach the PROVINCIAL authority
-- sixty days before arrival, and whether approval is needed at all depends on
-- whether the route crosses a prohibited region.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'CN'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-26'::timestamptz
from (values
  ('cn-exit-entry-permit', 'other', 'Issuance of Exit-Entry Permits for Foreigners', 'exit-entry-permit',
   'The document China issues to a foreigner in the country who has no valid passport — lost, damaged, stolen or robbed — and cannot obtain a replacement from their own embassy. Decided within 30 working days, CNY 100, collected in person.'),
  ('cn-travel-permit', 'other', 'Issuance of Travel Permits for Foreigners', 'travel-permit',
   'Permission to travel to places in China not open to foreigners. Individuals evidence their reasons for going; tour groups apply through a travel agency, which must file a reception plan 60 days before arrival. Decided within 30 working days, CNY 50.')) as v(visaai_id, category, official_name, slug, purpose)
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
  'National Immigration Administration (NIA)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('cn-exit-entry-permit', 'https://en.nia.gov.cn/n147423/n147478/n147715/c158281/content.html',
   'Service Guide on Issuance of Exit-Entry Permits for Foreigners'),
  ('cn-travel-permit', 'https://en.nia.gov.cn/n147423/n147478/n147715/c158260/content.html',
   'Service Guide on Issuance of Travel Permits for Foreigners')) as v(visaai_id, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n_type integer; n_src integer; n_total integer;
begin
  select count(*) into n_type from public.visa_types
   where visaai_id in ('cn-exit-entry-permit','cn-travel-permit') and lifecycle_state = 'active';
  if n_type <> 2 then raise exception 'Expected 2 new Chinese routes, found %', n_type; end if;

  select count(*) into n_src from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id in ('cn-exit-entry-permit','cn-travel-permit') and s.active;
  if n_src <> 2 then raise exception 'Expected 2 sources, found %', n_src; end if;

  -- FIVE, matching the guides the NIA index enumerates. If this ever reads more,
  -- something was registered that the index does not publish as a service guide.
  select count(*) into n_total from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'CN' and t.lifecycle_state = 'active';
  if n_total <> 5 then
    raise exception 'China should total 5 routes, one per enumerated service guide; found %', n_total;
  end if;

  raise notice 'China complete: 5 of 5 enumerated service guides registered, awaiting sync';
end $$;
