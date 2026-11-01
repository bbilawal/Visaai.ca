-- Add New Zealand's Exchange Student Visa. NZ now has 3 visa types.
--
-- HOW THIS ONE WAS FOUND, INCLUDING WHAT DID NOT WORK
--
-- I set out to add the FEE PAYING student visa, which I had deferred twice with
-- "the site needs reading properly". Reading it properly is what I did, and it
-- did not produce that page:
--
--   * immigration.govt.nz/sitemap.xml lists 11 sub-sitemaps; every one of them
--     returns `unavailable` to our fetcher, so the Irish trick does not apply.
--   * The visa detail pages carry no sibling links — only anchors to themselves.
--   * /new-zealand-visas/visas, /all-visas and /visas/all all 404. The "find and
--     compare visas" lookup is a client-side search.
--   * The exchange student page names the fee paying student visa in PROSE, but
--     not as a resolvable href.
--
-- What that hunting did surface is a real, verified page: the exchange student
-- visa at /new-zealand-visas/visas/visa/exchange-student-visa, 21,034
-- characters. So this registers what was verified rather than continuing to
-- guess at what was not. The fee paying student visa remains unregistered and
-- is honestly still open.
--
-- WHY THIS VISA EARNS ITS PLACE RATHER THAN BEING A CONSOLATION PRIZE
--
-- INZ states on it that study abroad programmes are NOT approved exchange
-- schemes and that those students should apply for the fee paying student visa
-- instead. That is routing information: it stops someone on a study-abroad
-- programme filing for the wrong visa, which is the single most expensive
-- mistake this registry can prevent.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NZ'),
  'nz-exchange-student-visa', 'student',
  'Exchange Student Visa', 'exchange-student-visa',
  'Study full-time in New Zealand on an approved student exchange scheme, for '
    'up to 4 years, without paying tuition fees.',
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
  c.id, t.id, 'requirements', 'Immigration New Zealand', 1,
  'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/exchange-student-visa',
  'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/exchange-student-visa',
  'Exchange Student Visa', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'NZ'
where t.visaai_id = 'nz-exchange-student-visa'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'nz-exchange-student-visa';
  if n < 1 then raise exception 'Exchange student visa source not registered.'; end if;
end $$;
