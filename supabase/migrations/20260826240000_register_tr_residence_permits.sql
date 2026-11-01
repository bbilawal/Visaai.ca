-- Türkiye gains its SECOND authority, and with it the residence-permit half of
-- the country. Türkiye goes 8 -> 14 routes.
--
-- WHY A SECOND AUTHORITY, AND WHY IT TOOK THIS LONG TO FIND
--
-- The Ministry of Foreign Affairs issues VISAS. It publishes a catalogue of
-- roughly thirty-five subtypes and describes eight of them, and the earlier
-- registration recorded the rest as "enumerated and not described" — which was
-- true of the MFA and quietly implied it was true of Türkiye.
--
-- It is not. Permission to STAY is a different authority: the Presidency of
-- Migration Management, whose English site publishes all six residence permit
-- types with legal basis, eligibility, duration, conditions and cancellation
-- grounds, numbered 1 to 6 by the authority itself. This is the same split as
-- Japan (MOFA issues visas, ISA handles residence), except here both halves are
-- readable.
--
-- The MFA names "the provincial directorate of migration administration" twice
-- in its own prose and never links it. Following what a page SAYS as well as
-- what it LINKS is what closed this.
--
-- THE COUNTRY ROW IS CORRECTED, NOT JUST EXTENDED
--
-- `immigration_authority` said Ministry of Foreign Affairs. A foreign ministry
-- is not an immigration authority; it is the foreign-affairs authority, and the
-- schema has a column for each. The immigration authority is the Presidency of
-- Migration Management. Leaving the old value would misattribute every
-- residence permit below to the wrong body.

update public.visa_countries
   set immigration_authority     = 'Presidency of Migration Management (Göç İdaresi Başkanlığı)',
       immigration_authority_url = 'https://en.goc.gov.tr/',
       foreign_affairs_authority = 'Ministry of Foreign Affairs of the Republic of Türkiye',
       foreign_affairs_authority_url = 'https://www.mfa.gov.tr/consular-info.en.mfa',
       last_verified_at          = '2026-08-26'::timestamptz
 where code = 'TR';

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'TR'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-26'::timestamptz
from (values
  ('tr-short-term-residence-permit', 'other', 'Short-Term Residence Permit', 'short-term-residence-permit',
   'Türkiye''s general-purpose residence permit, issued for up to two years at a time across fourteen distinct grounds — from scientific research and property ownership to medical treatment, Turkish language courses and post-graduation job search — each with its own qualifying conditions.'),
  ('tr-family-residence-permit', 'family_reunification', 'Family Residence Permit', 'family-residence-permit',
   'Türkiye''s family reunification permit for the foreign spouse and children of Turkish citizens, permit-holders, refugees and subsidiary protection beneficiaries — up to three years at a time, never exceeding the sponsor''s own permit, with income and insurance conditions on the sponsor.'),
  ('tr-student-residence-permit', 'student', 'Student Residence Permit', 'student-residence-permit',
   'Türkiye''s residence permit for foreign students in primary, secondary and higher education — including the health-insurance window, the rules for changing university or province, and the right to work that begins only after the first year of an undergraduate programme.'),
  ('tr-long-term-residence-permit', 'permanent_residence', 'Long-Term Residence Permit', 'long-term-residence-permit',
   'Türkiye''s indefinite residence permit, granted after eight continuous years of residence, carrying most rights of a Turkish citizen — and closed entirely to refugees, conditional refugees, subsidiary and temporary protection beneficiaries and humanitarian permit holders.'),
  ('tr-humanitarian-residence-permit', 'humanitarian', 'Humanitarian Residence Permit', 'humanitarian-residence-permit',
   'A discretionary Türkiye residence permit for people who cannot be removed, whose departure is not reasonable or possible, or whose circumstances are extraordinary — issued without the conditions attached to any other permit type.'),
  ('tr-human-trafficking-victim-residence-permit', 'humanitarian', 'Residence Permit for Victims of Human Trafficking', 'human-trafficking-victim-residence-permit',
   'A thirty-day Türkiye residence permit for victims of human trafficking, or where strong circumstantial evidence suggests they might be, renewable in six-month periods to a maximum of three years and issued without the conditions attached to other permits.')) as v(visaai_id, category, official_name, slug, purpose)
on conflict (visaai_id) do update set
  official_name    = excluded.official_name,
  purpose          = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- All six read from ONE page — the authority publishes its whole catalogue
-- there — so they share a source URL while each carries its own requirements.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'Presidency of Migration Management (Göç İdaresi Başkanlığı)', 1,
  'https://en.goc.gov.tr/residence-permit-types',
  'https://en.goc.gov.tr/residence-permit-types',
  'Residence Permit Types', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('tr-short-term-residence-permit'),
  ('tr-family-residence-permit'),
  ('tr-student-residence-permit'),
  ('tr-long-term-residence-permit'),
  ('tr-humanitarian-residence-permit'),
  ('tr-human-trafficking-victim-residence-permit')) as v(visaai_id)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n_country integer; n_type integer; n_src integer; n_total integer; n_mfa integer;
begin
  select count(*) into n_country from public.visa_countries
   where code = 'TR'
     and immigration_authority like 'Presidency of Migration Management%'
     and foreign_affairs_authority like 'Ministry of Foreign Affairs%';
  if n_country <> 1 then
    raise exception 'TR must carry BOTH authorities, immigration and foreign affairs (found %)', n_country;
  end if;

  select count(*) into n_type from public.visa_types
   where visaai_id in ('tr-short-term-residence-permit','tr-family-residence-permit',
                       'tr-student-residence-permit','tr-long-term-residence-permit',
                       'tr-humanitarian-residence-permit','tr-human-trafficking-victim-residence-permit')
     and lifecycle_state = 'active';
  if n_type <> 6 then raise exception 'Expected 6 new residence routes, found %', n_type; end if;

  select count(*) into n_src from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where s.authority like 'Presidency of Migration Management%' and s.active;
  if n_src <> 6 then raise exception 'Expected 6 migration-authority sources, found %', n_src; end if;

  -- The MFA's eight visa routes must still be attributed to the MFA. Correcting
  -- the country row must not silently re-badge them.
  select count(*) into n_mfa from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and s.authority like 'Ministry of Foreign Affairs%' and s.active;
  if n_mfa <> 16 then
    raise exception 'The 16 MFA sources across 8 visa routes must keep their own authority; found %', n_mfa;
  end if;

  select count(*) into n_total from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and t.lifecycle_state = 'active';
  if n_total <> 14 then
    raise exception 'Türkiye should total 14 routes (8 MFA visas + 6 migration residence permits); found %', n_total;
  end if;

  raise notice 'Türkiye: 6 residence routes registered under a second authority, 14 total, awaiting sync';
end $$;
