-- Add Ireland's long stay employment visa (D). Ireland reaches 4 types and
-- gains its first work route; the registry reaches 35 across 8 destinations.
--
-- MY EARLIER "BLOCKED" CALL ON THIS VISA WAS WRONG
--
-- It was recorded as blocked behind "a 2,793-char router". That page is real and
-- is a router -- /what-are-my-work-visa-options/applying-for-a-long-stay-employment-visa/
-- returns 2,717 characters and states no requirement. But the visa page sits one
-- level below it, at .../employment-visa/, and carries 16,600 characters of
-- requirements.
--
-- I stopped at the router instead of reading the site's own index. This is the
-- third time the same shape has cost a destination: UDI's hidden input, the
-- Swedish /en/ tree, and now this. page-sitemap.xml answered it in one fetch.
--
-- TWO AUTHORITIES, IN ORDER -- THE THING THIS PAGE IS REALLY ABOUT
--
-- Ireland splits work migration between two bodies. The EMPLOYMENT PERMIT is
-- issued by the Department of Enterprise, Trade and Employment; the VISA is
-- issued by Immigration Service Delivery. ISD states plainly that "once you have
-- received a permit, you are eligible to apply for an employment visa" -- the
-- permit is a precondition, and the permit document is itself a required
-- supporting document for the visa.
--
-- Someone who reads only "how do I get an Irish work visa" can therefore apply
-- in the wrong order and be refused for a reason no visa page lists as a
-- criterion. That ordering is recorded as the first requirement.
--
-- Only ISD pages are registered. DETE is a different authority with its own
-- site, and its seven permit types each have their own eligibility -- that is a
-- separate extraction, not something to summarise from an ISD sentence.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'IE'),
  'ie-long-stay-employment-visa', 'work',
  'Long Stay Employment Visa (D)', 'long-stay-employment-visa',
  'Travel to Ireland to take up employment, once an employment permit has '
    'been issued by the Department of Enterprise, Trade and Employment.',
  'active', 'unverified', '2026-08-22'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- Two sources. The visa page states the rules and the documents but LINKS the
-- fee schedule, so the fees page is registered rather than its amounts inferred.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select c.id, t.id, v.role, 'Immigration Service Delivery (ISD)', 1,
       v.url, v.url, v.title, 'en',
       'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'IE'
cross join (values
  ('requirements',
   'https://www.irishimmigration.ie/coming-to-work-in-ireland/what-are-my-work-visa-options/applying-for-a-long-stay-employment-visa/employment-visa/',
   'Employment Visa'),
  ('fees',
   'https://www.irishimmigration.ie/preclearance-and-entry-visas-fees/',
   'Preclearance and Entry Visas Fees')
) as v(role, url, title)
where t.visaai_id = 'ie-long-stay-employment-visa'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'ie-long-stay-employment-visa';
  if n < 2 then raise exception 'Expected 2 sources for ie-long-stay-employment-visa, found %.', n; end if;
end $$;
