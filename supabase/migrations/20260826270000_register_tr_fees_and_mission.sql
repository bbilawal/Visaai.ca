-- Türkiye finished: the fee regime on all six residence routes, and a seventh
-- route for foreign mission personnel. Türkiye goes 14 -> 15 routes.
--
-- WHY THE FEE PAGE IS REGISTERED SIX TIMES
--
-- It applies to every residence permit type, so every route carries it — the
-- same shape as the Ministry of Foreign Affairs' general regime, which sits on
-- all eight visa routes. A fee an applicant cannot see on their own page is a
-- fee they will discover at a counter.
--
-- It is also the FRESHEST source in this registry. The amounts take effect on
-- 1 January 2026 and cite the gazettes that set them — Official Gazette 33117
-- of 24 December 2025 for the document fee, 33124 of 31 December 2025 for the
-- permit fee. Nothing else in the corpus carries a citation that precise.
--
-- WHAT THE SEVENTH ROUTE IS, AND WHY IT IS NOT PRICED
--
-- The foreign mission identity card EXEMPTS its holder from a residence permit,
-- so the fee page does not apply to it and is deliberately not registered
-- against it. Registering it anyway would tell a diplomat to pay for a permit
-- they are exempt from.
--
-- WHAT REMAINS UNREADABLE, AND WHY THAT IS FINAL RATHER THAN PENDING
--
-- The application DOCUMENT lists. The index links them at
-- `e-ikamet.goc.gov.tr/Ikamet/IstenenBelgeler`, which serves 13,615 bytes
-- normalising to 379 characters — rendered entirely by script. robots.txt is
-- 404, so nobody is refusing us; there is simply no server-rendered text. This
-- registry therefore publishes what the LAW requires for every Turkish
-- residence permit, and cannot publish the counter-by-counter paperwork.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'TR'),
  'tr-foreign-mission-personnel', 'diplomatic',
  'Residence Procedures for Foreign Mission Personnel and Their Family Members',
  'foreign-mission-personnel',
  'The foreign mission identity card that exempts accredited diplomatic, consular and international-organisation staff and their families from a Turkish residence permit — applied for within seven days, renewed within sixty days of expiry, and replaced by an ordinary residence permit within ten days of the status ending.',
  'active', 'unverified', '2026-08-26'::timestamptz
)
on conflict (visaai_id) do update set
  official_name    = excluded.official_name,
  purpose          = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'Presidency of Migration Management (Göç İdaresi Başkanlığı)', 1,
  'https://en.goc.gov.tr/residence-procedures-for-foreign-mission-personnel-and-their-family-members',
  'https://en.goc.gov.tr/residence-procedures-for-foreign-mission-personnel-and-their-family-members',
  'Residence Permit Procedures for Foreign Mission Personnel and Their Family Members', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_countries c
join public.visa_types t on t.visaai_id = 'tr-foreign-mission-personnel'
where c.code = 'TR'
on conflict do nothing;

-- The fee page, on the six ordinary residence routes and NOT on the exempt one.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'fees',
  'Presidency of Migration Management (Göç İdaresi Başkanlığı)', 1,
  'https://en.goc.gov.tr/documents-for-residence-permit-fee-amount',
  'https://en.goc.gov.tr/documents-for-residence-permit-fee-amount',
  'Residence Permit Card Fee and Residence Permit Fee Amount', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id
where t.visaai_id in ('tr-short-term-residence-permit','tr-family-residence-permit',
                      'tr-student-residence-permit','tr-long-term-residence-permit',
                      'tr-humanitarian-residence-permit','tr-human-trafficking-victim-residence-permit')
on conflict do nothing;

do $$
declare n_fee integer; n_mission integer; n_total integer; n_exempt integer;
begin
  select count(*) into n_fee from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where s.role = 'fees' and s.source_url like '%documents-for-residence-permit-fee-amount' and s.active;
  if n_fee <> 6 then raise exception 'The fee page must be registered on all 6 ordinary residence routes, found %', n_fee; end if;

  -- And NOT on the exempt route.
  select count(*) into n_exempt from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id = 'tr-foreign-mission-personnel' and s.role = 'fees';
  if n_exempt <> 0 then
    raise exception 'The mission-personnel route is EXEMPT from residence permit fees and must carry no fee source; found %', n_exempt;
  end if;

  select count(*) into n_mission from public.visa_types
   where visaai_id = 'tr-foreign-mission-personnel' and lifecycle_state = 'active';
  if n_mission <> 1 then raise exception 'Expected the mission-personnel route, found %', n_mission; end if;

  select count(*) into n_total from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and t.lifecycle_state = 'active';
  if n_total <> 15 then
    raise exception 'Türkiye should total 15 routes (8 MFA visas + 7 migration routes); found %', n_total;
  end if;

  raise notice 'Türkiye: fee regime on 6 routes, mission personnel registered, 15 total';
end $$;
