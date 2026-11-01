-- Register Hong Kong's residence as dependant -- the standalone route, and the
-- one that answers a question the work routes cannot.
--
-- WHO YOUR SPONSOR IS DECIDES WHETHER YOUR PARENTS CAN COME
--
--   * Sponsor admitted for EMPLOYMENT, study, investment or training (GEP,
--     ASMTP, IANG, VPAS, TechTAS), or as an entrant under CIES, QMAS, the
--     second-generation scheme, the Top Talent Pass or the new CIES:
--     spouse or recognised partner, and unmarried children under 18.
--
--   * Sponsor who is a PERMANENT RESIDENT, or has the right to land or
--     unconditional stay: the same -- PLUS "his/her parents aged 60 or above".
--
-- A work-visa holder can never bring a parent, however long they stay or however
-- much they earn. A permanent resident can, once the parent turns 60. The
-- distinction is not in any of the three Hong Kong work routes already
-- registered, because each of those describes only its own dependants.
--
-- AND IT CORRECTS SOMETHING THE WORK ROUTES IMPLY
--
-- `hk-general-employment-policy` and `hk-non-local-graduates` both record that
-- dependants "are not prohibited from taking up employment", which is true of
-- THEM. This page gives the whole rule, and it has an exception: "dependants of
-- persons who have been admitted into the hksar to study are prohibited from
-- taking up employment in the hksar unless they have obtained prior permission
-- from the director of immigration."
--
-- So a student's spouse is the one dependant in Hong Kong who needs permission
-- to work. Study is free for all of them: "all dependants do not require prior
-- permission from the director of immigration to study".
--
-- TWO EXTENSION CLOCKS, AND THEY DIFFER BY SCHEME
--
-- A dependant under a "specified scheme" may apply to extend within three
-- months of expiry; every other dependant, within FOUR WEEKS. Same pass, same
-- authority, and a dependant who assumes the three-month window because a
-- colleague had it will file too early and be refused the filing.
--
-- FRESHNESS, FROM THE PAGE'S OWN POLICY DATES
--
-- "the capital investment entrant scheme has been suspended since 15 january
-- 2015, while the new capital investment entrant scheme was launched on
-- 1 march 2024." A page carrying a 2024 scheme launch is being maintained.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'HK'),
  'hk-residence-as-dependant', 'dependant',
  'Residence as dependant',
  'residence-as-dependant',
  'Join a spouse, partner, parent or adult child in Hong Kong as their dependant, where their own status allows it.',
  'active', 'unverified', '2026-08-24'::timestamptz
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
  c.id, t.id, v.role,
  'Immigration Department of the Hong Kong Special Administrative Region', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.immd.gov.hk/eng/services/visas/residence_as_dependant.html',
   'Residence as dependant')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'hk-residence-as-dependant'
join public.visa_countries c on c.id = t.country_id and c.code = 'HK'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'hk-residence-as-dependant' and s.active;
  if n <> 1 then raise exception 'Expected 1 active ImmD source, found %.', n; end if;
end $$;
