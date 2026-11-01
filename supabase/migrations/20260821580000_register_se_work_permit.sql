-- Add Sweden's work permit for employees. Sweden now has 2 visa types.
--
-- Second non-English extraction, same reasoning as the Schengen visa: the
-- authoritative content is Swedish. Migrationsverket's English tree is a stub
-- and its sitemap contains no /English/ URLs at all, so the choice is a Swedish
-- source or no source.
--
-- The page was found through that sitemap rather than by guessing — 4,028 URLs,
-- and the employee work permit sits at
-- /du-vill-ansoka/arbeta/anstalld-eller-egen-foretagare/anstalld.html
-- ("you want to apply / work / employed or self-employed / employed").
-- 33,039 characters of requirements.
--
-- WHY THIS ONE IS WORTH THE TRANSLATION COST
--
-- Sweden's work permit turns on a single number that changes annually: a
-- monthly salary of at least 90% of the median wage published by Statistics
-- Sweden, currently SEK 34,470. That figure is the whole test, it is stated
-- plainly on this page, and it is exactly the kind of value that would
-- otherwise be recalled wrongly.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SE'),
  'se-work-permit-employed', 'work',
  'Arbetstillstånd för anställda (work permit, employed)', 'work-permit-employed',
  'Work in Sweden as an employee, on an offer meeting the salary and '
    'employment-condition requirements.',
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
  c.id, t.id, 'requirements', 'Migrationsverket (Swedish Migration Agency)', 1,
  'https://www.migrationsverket.se/du-vill-ansoka/arbeta/anstalld-eller-egen-foretagare/anstalld.html',
  'https://www.migrationsverket.se/du-vill-ansoka/arbeta/anstalld-eller-egen-foretagare/anstalld.html',
  'Anställd – arbetstillstånd', 'sv',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'SE'
where t.visaai_id = 'se-work-permit-employed'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'se-work-permit-employed' and s.language = 'sv';
  if n < 1 then raise exception 'Swedish work permit source not registered.'; end if;
end $$;
