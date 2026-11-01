-- Register Ireland and the Short Stay 'C' visit/tourist visa.
--
-- Second destination added through the pipeline (after New Zealand), and the
-- second confirmation that the expensive part is finding the page, not the
-- plumbing.
--
-- FINDING THE SOURCE
--
-- /coming-to-visit-ireland/ is the section hub and states no requirement. The
-- page that does is /how-to-apply-for-a-short-stay-c-visit-tourist-visa/, and
-- it was read off ISD's own link list rather than guessed — the same method
-- that found INZ's real page. It carries the whole substance: what the visa
-- permits and forbids, the three application steps, and the full required-
-- documents set with per-document detail.
--
-- ROBOTS
--
-- www.irishimmigration.ie/robots.txt fetched and read: a single `User-agent: *`
-- group with one Disallow, which neither path below is under.
--
-- A NOTE ON THE TRANSLATIONS
--
-- ISD serves this content in 13 languages via Weglot, at /fr/, /de/, /zh/ and
-- so on. Only the English page is registered. The translated variants are
-- machine translations of the same source, and monitoring them would multiply
-- the fetch load by thirteen to detect the same change thirteen times.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  official_visa_url, official_languages, fee_currency, support_state,
  data_quality, last_verified_at
) values (
  'IE', 'Ireland', 'ireland',
  'Immigration Service Delivery',
  'https://www.irishimmigration.ie/',
  'https://www.irishimmigration.ie/coming-to-visit-ireland/',
  '{en,ga}', 'EUR', 'supported', 'verified', '2026-08-21'::timestamptz
)
on conflict (code) do update set
  immigration_authority = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  official_visa_url = excluded.official_visa_url,
  support_state = excluded.support_state,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'IE'),
  'ie-short-stay-c-visa', 'visitor', 'Short Stay ''C'' Visa', 'C',
  'short-stay-c-visa',
  'Travel to Ireland for up to 90 days as a tourist, to visit family or '
    'friends, to study a short course, to get married, or to receive medical '
    'treatment.',
  'active', 'unverified', '2026-08-21'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  official_code = excluded.official_code,
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
   'https://www.irishimmigration.ie/how-to-apply-for-a-short-stay-c-visit-tourist-visa/',
   'How to apply for a Short Stay ''C'' visit (tourist) visa'),
  ('landing',
   'https://www.irishimmigration.ie/coming-to-visit-ireland/',
   'Coming to visit Ireland')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'ie-short-stay-c-visa'
join public.visa_countries c on c.id = t.country_id and c.code = 'IE'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'ie-short-stay-c-visa';
  if n <> 2 then
    raise exception 'Expected 2 ISD sources for ie-short-stay-c-visa, found %.', n;
  end if;
end $$;
