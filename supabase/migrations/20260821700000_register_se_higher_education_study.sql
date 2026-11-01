-- Add Sweden's residence permit for higher education studies. SE has 3 types.
--
-- Third Swedish-language extraction. Found through the sitemap: the section page
-- /du-vill-ansoka/studera.html is 3,110 characters and lists seven study routes;
-- the one for undergraduate and master's level is
-- /du-vill-ansoka/studera/studier-vid-hogre-utbildning.html at 31,175.
--
-- WHY THIS ONE MATTERS MORE THAN A THIRD SWEDISH PAGE USUALLY WOULD
--
-- Migrationsverket publishes maintenance amounts that differ BY APPLICATION
-- YEAR and are reduced by free board and lodging:
--
--   SEK 10,656 / month if you applied in 2026
--   SEK 10,584 / month if you applied in 2025
--   minus SEK 2,960 (food) and SEK 4,736 (housing) for 2026 applicants
--   plus  SEK 4,440 for a spouse or partner, SEK 2,664 per child
--
-- Two years of figures on one page is unusual and is exactly the shape a
-- from-memory answer gets wrong — it will confidently give one number, for the
-- wrong year, without the deductions.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SE'),
  'se-higher-education-study-permit', 'student',
  'Uppehållstillstånd för studier vid högre utbildning (residence permit for higher education studies)',
  'higher-education-study-permit',
  'Study at Swedish university, university college or other post-secondary '
    'education for longer than three months.',
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
  'https://www.migrationsverket.se/du-vill-ansoka/studera/studier-vid-hogre-utbildning.html',
  'https://www.migrationsverket.se/du-vill-ansoka/studera/studier-vid-hogre-utbildning.html',
  'Studier vid högre utbildning', 'sv',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'SE'
where t.visaai_id = 'se-higher-education-study-permit'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'se-higher-education-study-permit' and s.language = 'sv';
  if n < 1 then raise exception 'Swedish study permit source not registered.'; end if;
end $$;
