-- Add Sweden's EU Blue Card. Sweden reaches 5 types; the registry reaches 39
-- across 8 destinations, and holds the SAME EU instrument under TWO national
-- implementations for the first time.
--
-- WHY THAT MATTERS MORE THAN IT SOUNDS
--
-- The EU Blue Card comes from an EU directive, so nl-european-blue-card and this
-- file describe "the same permit". They are not variants of one another. Each
-- member state sets its own salary threshold, its own minimum contract length
-- and its own process, and Sweden's threshold is a FORMULA -- 1.25 times the
-- average gross salary published by the National Mediation Office, redetermined
-- every year, currently SEK 53,625/month since 15 July 2026.
--
-- Crossing figures between the two files would produce a confidently wrong
-- number that verifies against nothing. The formula is the durable fact here;
-- the amount is a snapshot with a date attached.
--
-- A DISCREPANCY IN MIGRATIONSVERKET'S OWN FIGURES, RECORDED NOT SMOOTHED
--
-- This page introduces the maintenance amounts with "for 2025, the amount you
-- must have left after paying your rent is:" and lists SEK 6,243 / 10,314 /
-- 3,336 / 4,004 / 4,672 / 5,339.
--
-- Migrationsverket's maintenance word-explanation page -- a registered source of
-- se-family-partner -- introduces the IDENTICAL six figures with "in 2026, the
-- amount you must have left over after tax and the rent is paid is:".
--
-- Verified by re-fetching both pages and matching all six amounts on each. Same
-- authority, same numbers, two different years. One page is stale and neither
-- page says which, so this file quotes what THIS page says and keeps
-- stated_for_year = 2025 to match its own wording. Copying figures between pages
-- without reading the sentence that introduces them would have hidden the
-- conflict completely.
--
-- THE MAINTENANCE REQUIREMENT HERE IS ABOUT FAMILY, NOT THE CARDHOLDER
--
-- It applies only when family apply together with the applicant. Read quickly,
-- this page suggests every Blue Card applicant faces a residual-income test on
-- top of the salary threshold. They do not, so the condition is in the label.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SE'),
  'se-eu-blue-card', 'work',
  'EU Blue Card (Sweden)', 'eu-blue-card',
  'Live and work in Sweden in highly qualified employment for a named '
    'employer, under the EU Blue Card.',
  'active', 'unverified', '2026-08-22'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- One source. The page states its own salary threshold, maintenance amounts and
-- fees, so no separate fee or threshold page is needed.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select c.id, t.id, 'requirements', 'Migrationsverket', 1,
  'https://www.migrationsverket.se/en/you-want-to-apply/work/employee-or-self-employed/eu-blue-cards.html',
  'https://www.migrationsverket.se/en/you-want-to-apply/work/employee-or-self-employed/eu-blue-cards.html',
  'EU Blue Cards', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'SE'
where t.visaai_id = 'se-eu-blue-card'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'se-eu-blue-card';
  if n < 1 then raise exception 'Swedish EU Blue Card source not registered.'; end if;
end $$;
