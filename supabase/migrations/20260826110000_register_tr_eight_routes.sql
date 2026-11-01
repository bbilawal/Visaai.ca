-- Türkiye: the 17th destination, and the first whose catalogue and whose
-- requirements are published as two different shapes that do not line up.
--
-- WHAT THE AUTHORITY ENUMERATES, AND WHAT IT DESCRIBES
--
-- `general-information-about-turkish-visas` publishes a catalogue server-side —
-- five classes and roughly thirty-five lettered subtypes, from "a) touristic
-- visit" to "h) seafarer visa". That is the enumerable index this registry
-- requires before admitting a country, and Türkiye clears it outright.
--
-- The SAME page then carries requirement sections under its own headings, and
-- those headings are NOT the five classes. They are: tourist visa, working
-- visa, internship visa / work permit exemption, tour operator representative
-- visa, transportation visa, personnel of foreign religious foundations, and
-- archaeological excavation / exploration / documentary purpose visas. A
-- companion page describes the e-Visa.
--
-- Eight routes are registered: the ones the authority actually describes. The
-- subtypes it enumerates and does not describe — the official visa class, the
-- student-education class, and the tourist sub-purposes such as transit,
-- conference and sportive activity — are named in
-- `docs/visa-data/GLOBAL_COVERAGE_EXCEPTIONS.md` rather than registered as
-- empty routes. An empty route reads as coverage from a distance; a named
-- exception reads as what it is.
--
-- WHY NO FEE CURRENCY IS SET
--
-- The ministry links its tariff as a separate PDF (`vize-harc-miktarlari-en.pdf`)
-- and states no amount in either page body. `fee_currency` records the currency
-- of fees this registry has actually READ, and it has read none for Türkiye, so
-- the column stays null rather than carrying a plausible 'TRY' that no source
-- supports. The e-Visa route does publish that the online fee is LOWER than the
-- airport fee, and that comparison is registered without inventing either
-- number.
--
-- THE DOTTED CAPITAL
--
-- These pages are full of `Türki̇ye` — the Turkish dotted capital İ, which
-- lowercases to TWO code units and shifts every offset after it. That character
-- is the one that cost Finland its entire set of quotations before
-- `deriveDisplayExcerpt` was rebuilt around an explicit offset map. It is worth
-- recording that the country the bug is named after is now in the registry, and
-- that the fix is what let it in.

update public.visa_countries
   set support_state             = 'supported',
       immigration_authority     = 'Ministry of Foreign Affairs of the Republic of Türkiye',
       immigration_authority_url = 'https://www.mfa.gov.tr/consular-info.en.mfa',
       official_visa_url         = 'https://www.mfa.gov.tr/visa-information-for-foreigners.en.mfa',
       evisa_portal_url          = 'https://www.evisa.gov.tr/en/',
       official_languages        = array['tr','en'],
       data_quality              = 'unverified',
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
  ('tr-e-visa', 'evisa', 'e-Visa', 'e-visa',
   'Türkiye''s online entry visa, valid only for tourism or commerce; work and study visas are issued by Turkish embassies and consulates instead.'),
  ('tr-tourist-visa', 'tourism', 'Tourist Visa', 'tourist-visa',
   'The tourist and businessperson class, applied for through the sticker-visa pre-application system or a consular appointment, with detailed conditions on what an invitation letter must contain.'),
  ('tr-working-visa', 'work', 'Working Visa', 'working-visa',
   'Turkish work visa and work permit, lodged at a Turkish mission in the country of residence or nationality and decided by the Ministry of Labour and Social Security within thirty days.'),
  ('tr-internship-work-permit-exemption', 'exchange', 'Internship Visa / Work Permit Exemption', 'internship-work-permit-exemption',
   'Article 55 of the enforcement regulation on Law 4817: thirteen categories exempt from a Turkish work permit, each with its own maximum period, usable once per calendar year.'),
  ('tr-tour-operator-representative-visa', 'temporary_worker', 'Tour Operator Representative Visa', 'tour-operator-representative-visa',
   'Foreign representatives of tour operators, exempt from a work visa for up to eight months, with the residence application processed under touristic rules.'),
  ('tr-transportation-visa', 'crew', 'Transportation Visa', 'transportation-visa',
   'Multiple-entry visa valid for one year for transport workers, plus the seafarer exemption under STCW bilateral protocols.'),
  ('tr-religious-foundation-personnel', 'religious', 'Personnel Assigned to Foreign Religious Foundations', 'religious-foundation-personnel',
   'An exceptional work permit for staff of foreign religious foundations in Türkiye: applied for through the Ministry of Foreign Affairs, with the residence permit issued by the Ministry of Internal Affairs.'),
  ('tr-archaeological-documentary-visa', 'research', 'Archaeological Excavation, Exploration and Documentary Purpose Visas', 'archaeological-documentary-visa',
   'Research, excavation and filming in Türkiye, requiring special permission obtained in advance and entry on the relevant visa issued by a Turkish mission abroad.')
) as v(visaai_id, category, official_name, slug, purpose)
on conflict (visaai_id) do update set
  official_name    = excluded.official_name,
  purpose          = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- Both pages are registered against every route. That is not duplication for
-- its own sake: the general regime (the 60-day passport margin, the 90/180
-- ceiling, the insurance, the under-18 rule) is split across the two pages and
-- applies to all eight, so a route registering only one of them would monitor
-- half of what it publishes.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, s.role,
  'Ministry of Foreign Affairs of the Republic of Türkiye', 1,
  s.url, s.url, s.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_countries c
join public.visa_types t on t.country_id = c.id
cross join (values
  ('requirements',
   'https://www.mfa.gov.tr/general-information-about-turkish-visas.en.mfa',
   'General Information About Turkish Visas — visa types, general regime and route requirements'),
  ('policy',
   'https://www.mfa.gov.tr/visa-information-for-foreigners.en.mfa',
   'Visa Information For Foreigners — e-Visa, work visa and passport validity')
) as s(role, url, title)
where c.code = 'TR'
  and t.visaai_id in (
    'tr-e-visa','tr-tourist-visa','tr-working-visa',
    'tr-internship-work-permit-exemption','tr-tour-operator-representative-visa',
    'tr-transportation-visa','tr-religious-foundation-personnel',
    'tr-archaeological-documentary-visa')
on conflict do nothing;

do $$
declare
  n_country integer; n_type integer; n_source integer; n_fee integer;
begin
  select count(*) into n_country from public.visa_countries
   where code = 'TR' and support_state = 'supported' and immigration_authority is not null;
  if n_country <> 1 then
    raise exception 'TR is not registered as a supported country with an authority (found %)', n_country;
  end if;

  -- No fee currency, deliberately. If this ever reads non-null, somebody has
  -- supplied a currency for a tariff nobody read.
  select count(*) into n_fee from public.visa_countries
   where code = 'TR' and fee_currency is not null;
  if n_fee <> 0 then
    raise exception 'TR must carry no fee_currency: this authority publishes no fee amount on any monitored page';
  end if;

  select count(*) into n_type from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and t.lifecycle_state = 'active';
  if n_type <> 8 then
    raise exception 'Türkiye should have 8 described routes (the catalogue enumerates more and describes these); found %', n_type;
  end if;

  select count(*) into n_source from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and s.active;
  if n_source <> 16 then
    raise exception 'Expected 16 active TR sources (8 routes x 2 pages), found %', n_source;
  end if;

  raise notice 'Türkiye registered: 8 routes, 16 sources, awaiting sync';
end $$;
