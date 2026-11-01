-- Register Finland's residence permit for studies (OLE_OPI).
--
-- Second Finnish visa type, and it reuses the general-requirements page
-- registered with fi-employed-person as its own second source. That is not
-- duplication for its own sake: `visa_sources` is scoped to a visa type, and a
-- requirement binds to a source VERSION, so each visa type must carry its own
-- row for the shared page or its general conditions would have nothing to bind
-- to. The URL is identical and the sync fetches it once per source row.
--
-- WHY THIS PERMIT AND NOT "student visa"
--
-- Finland issues no student visa. A short study visit runs on a Schengen visa
-- from the Ministry for Foreign Affairs -- which returns 403 to us -- and
-- anything longer is a residence permit from Migri. The official name is used
-- verbatim rather than normalised to a familiar label.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'FI'),
  'fi-residence-permit-studies', 'student',
  'Residence permit application for studies', 'OLE_OPI',
  'residence-permit-studies',
  'Study in Finland at a university, university of applied sciences, general upper secondary school or vocational institution, on an accepted study place.',
  'active', 'unverified', '2026-08-23'::timestamptz
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
  c.id, t.id, v.role,
  'Maahanmuuttovirasto (Finnish Immigration Service, Migri)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://migri.fi/en/residence-permit-application-for-studies',
   'Residence permit application for studies'),
  ('eligibility',
   'https://migri.fi/en/first-residence-permit',
   'First residence permit')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'fi-residence-permit-studies'
join public.visa_countries c on c.id = t.country_id and c.code = 'FI'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'fi-residence-permit-studies' and s.active;
  if n <> 2 then raise exception 'Expected 2 active Migri sources, found %.', n; end if;
end $$;
