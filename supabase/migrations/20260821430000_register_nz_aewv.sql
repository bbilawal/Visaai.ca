-- Add a second New Zealand visa type: the Accredited Employer Work Visa (AEWV).
--
-- Depth rather than breadth. Every destination added in this expansion round
-- carries exactly one visa type, against Canada's seven, so a New Zealander's
-- page set is thinner than its "supported" badge implies. The AEWV is NZ's main
-- employer-sponsored work route.
--
-- FOUND BY PATTERN, VERIFIED BEFORE USE
--
-- INZ's visa detail pages sit at /new-zealand-visas/visas/visa/<slug>, learned
-- from the visitor visa. Five candidate student slugs were probed and four
-- 404'd; `accredited-employer-work-visa` returned 29,801 characters of real
-- requirements. Probing to FIND a URL is legitimate; nothing here is registered
-- until it has been fetched and read.
--
-- The student visa is NOT added: its slug was not found by probing, and the
-- study section hub links only to other section pages. It needs the same
-- read-the-site treatment the visitor visa got, not more guesses.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NZ'),
  'nz-accredited-employer-work-visa', 'work',
  'Accredited Employer Work Visa', 'AEWV', 'accredited-employer-work-visa',
  'Work in New Zealand for up to 5 years for an employer accredited to hire '
    'migrants, on a job offer of at least 30 hours a week.',
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
  'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/accredited-employer-work-visa',
  'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/accredited-employer-work-visa',
  'Accredited Employer Work Visa', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'NZ'
where t.visaai_id = 'nz-accredited-employer-work-visa'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'nz-accredited-employer-work-visa';
  if n < 1 then raise exception 'AEWV source not registered.'; end if;
end $$;
