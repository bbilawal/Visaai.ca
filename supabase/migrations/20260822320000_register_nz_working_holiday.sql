-- Register New Zealand's Working Holiday Visa.
--
-- New Zealand's fifth visa type. The registry already publishes a
-- youth_mobility route (gb-youth-mobility-scheme); this one is its opposite
-- number in a category that had none until today.
--
-- THIS IS NOT ONE VISA. IT IS ~45 BILATERAL SCHEMES BEHIND ONE PAGE
--
-- INZ says so itself: "the visa requirements for each country will tell you:
-- how old you have to be how long you can stay how much money you need to bring
-- with you any specific criteria and conditions." The four numbers a person most
-- wants are per-scheme and are NOT on this page, so none of them is stored as a
-- general figure. Only what INZ states outright is: the general age band, the
-- three durations it names (12 months, 23 for Canada, 36 for the UK), the work
-- and study limits, and the medical rules.
--
-- AND THE COUNTRY LIST IS UNREADABLE TO US
--
-- INZ renders "list of countries with a working holiday visa agreement"
-- client-side; server-side it is an empty heading. VisaAI therefore cannot tell
-- an applicant whether their nationality qualifies -- the very first gate on the
-- route. That is recorded in the extraction rather than filled in from memory,
-- which would be the exact fabrication this registry exists to prevent.
--
-- The category is `working_holiday` rather than `youth_mobility`, because INZ's
-- own name for it is the working holiday visa and the official name is used
-- verbatim throughout this registry.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NZ'),
  'nz-working-holiday-visa', 'working_holiday',
  'Working Holiday Visa',
  'working-holiday-visa',
  'Travel, work and study in New Zealand, normally for up to 12 months, if you are a citizen of a country with a working holiday agreement.',
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
  c.id, t.id, v.role, 'Immigration New Zealand', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.immigration.govt.nz/work/working-holiday-visas/who-can-apply-for-a-working-holiday-visa/',
   'Who can apply for a working holiday visa'),
  ('policy',
   'https://www.immigration.govt.nz/work/working-holiday-visas/working-holiday-visa-medical-requirements/',
   'Working holiday visa medical requirements'),
  ('landing',
   'https://www.immigration.govt.nz/work/working-holiday-visas/',
   'Working holiday visas')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'nz-working-holiday-visa'
join public.visa_countries c on c.id = t.country_id and c.code = 'NZ'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'nz-working-holiday-visa' and s.active;
  if n <> 3 then raise exception 'Expected 3 active INZ sources, found %.', n; end if;
end $$;
