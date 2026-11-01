-- Register the Netherlands and the student residence permit (higher education).
--
-- Third destination through the pipeline, and the one that nearly got recorded
-- as unviable. My first three guessed URLs (/en/short-stay-visa,
-- /en/residence-permits/visit, /en/short-stay/...) all 404'd, and the section
-- hubs list nothing useful. Reading IND's own links from the residence-permits
-- section produced the real page immediately. Guessing a URL pattern is a
-- probe, not a method; the site's own links are the method.
--
-- WHY A STUDY PERMIT AND NOT A VISITOR VISA
--
-- IND handles RESIDENCE permits. Short-stay Schengen 'C' visas for the
-- Netherlands are issued by the Ministry of Foreign Affairs, a different
-- authority on a different domain, so there is no IND visitor-visa page to
-- register. Recording the student permit is not a compromise — it is what this
-- authority actually governs.
--
-- ROBOTS
--
-- ind.nl/robots.txt fetched and read: one `User-agent: *` group with 44
-- disallows, none matching /en/residence-permits/.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  official_visa_url, official_languages, fee_currency, support_state,
  data_quality, last_verified_at
) values (
  'NL', 'Netherlands', 'netherlands',
  'Immigratie- en Naturalisatiedienst (IND)',
  'https://ind.nl/en',
  'https://ind.nl/en/residence-permits',
  '{nl,en}', 'EUR', 'supported', 'verified', '2026-08-21'::timestamptz
)
on conflict (code) do update set
  immigration_authority = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  official_visa_url = excluded.official_visa_url,
  support_state = excluded.support_state,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NL'),
  'nl-student-residence-permit-higher-education', 'student',
  'Student residence permit for university or higher professional education',
  'student-residence-permit-higher-education',
  'Study a full-time accredited programme at a Dutch university or institute '
    'of higher professional education (hbo). The educational institution '
    'applies on the student''s behalf.',
  'active', 'unverified', '2026-08-21'::timestamptz
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
  c.id, t.id, v.role, 'Immigratie- en Naturalisatiedienst (IND)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://ind.nl/en/residence-permits/study/student-residence-permit-for-university-or-higher-professional-education',
   'Student residence permit for university or higher professional education'),
  ('landing', 'https://ind.nl/en/residence-permits/study', 'Study residence permits')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'nl-student-residence-permit-higher-education'
join public.visa_countries c on c.id = t.country_id and c.code = 'NL'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'nl-student-residence-permit-higher-education';
  if n <> 2 then raise exception 'Expected 2 IND sources, found %.', n; end if;
end $$;
