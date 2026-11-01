begin;

-- Jordan and Qatar: one route each, and the arithmetic is the honest part.
--
-- The re-probe found four countries with a readable page but no route corpus.
-- Two of them turned out to have a page that is genuinely ABOUT inbound visas.
-- Two did not, and are not registered:
--
--   KUWAIT — www.moi.gov.kw/main/eservices/residence is readable at 2,206
--   characters and its substantive content is a DIRECTORATE MANDATE:
--   "organising and supervising the entry and exit of foreigners through the
--   ports or their residence, in addition to keeping residence files for
--   expatriates and recording violations". That describes what the department
--   does. It states no requirement, no fee and no document, and registering it
--   as a visa route would publish a page whose entire content is a job
--   description.
--
--   IRAQ — mofa.gov.iq is readable with a 12,514-URL sitemap, and the readable
--   service pages are IRAQI PASSPORT services for Iraqi citizens: issuance,
--   extension, replacement of a lost passport, laissez-passer. They are real
--   and they are about the wrong direction of travel. Publishing them under an
--   Iraq visa route would be a page about Iraqi passports presented to someone
--   asking how to enter Iraq.
--
-- Both are left in the coverage exceptions ledger with the measurement that
-- disqualified them, which is a better record than either an empty route or a
-- misleading one.
--
-- JORDAN — jordan.gov.jo, the national eGovernment portal, publishes a visa
-- guide naming the three ways into the Kingdom (single-entry tourist visa,
-- visa on arrival, e-visa), the stay durations, the port of entry for visa on
-- arrival, and the e-visa document list. www.moi.gov.jo remains what the
-- earlier probe found: 9,862 characters with no requirement language, and its
-- e-services host does not complete a connection.
--
-- QATAR — mofa.gov.qa publishes a fee table for seven visa types issued by
-- Qatari missions abroad through the automated system. It is thin and it is
-- specific: seven named types with QAR amounts, one of them exempted. The MOI
-- portal that holds the detail is a WebSphere installation serving 70KB of
-- markup carrying under 2,000 characters, 85% shared between pages, and
-- hukoomi.gov.qa returns 403 despite permissive robots — so the fee table is
-- what Qatar publishes to us and the fee table is what is registered.
--
-- ONE ROUTE EACH. Neither country gets a hub implying more.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, official_visa_url, official_languages,
  support_state, data_quality, jurisdiction_note, last_verified_at
) values
 ('JO', 'Jordan', 'jordan',
  'Ministry of Interior (وزارة الداخلية)',
  'https://jordan.gov.jo/',
  null,
  'https://jordan.gov.jo/',
  array['ar'],
  'preview', 'unverified',
  'Coverage is ONE route. Jordan''s national eGovernment portal publishes a visa guide naming '
  'the ways into the Kingdom and the e-visa document list. The Ministry of Interior''s own site '
  'reads at 9,862 characters with no requirement language, its entry-procedure page returns '
  'HTTP 500, and its e-services host does not complete a connection from production. Fees are '
  'deferred by the portal to the official visa site and are not published here. Sources are '
  'Arabic; English labels in the requirements are VisaAI translations.',
  '2026-08-24'::timestamptz),
 ('QA', 'Qatar', 'qatar',
  'Ministry of Interior (وزارة الداخلية)',
  'https://mofa.gov.qa/en/consular-services/visas',
  'Ministry of Foreign Affairs — Consular Affairs Department',
  'https://mofa.gov.qa/en/consular-services/visas',
  array['en','ar'],
  'preview', 'unverified',
  'Coverage is ONE route: the fee schedule for visas issued by Qatari missions abroad through '
  'the automated system. The Ministry of Interior decides entry and holds the eligibility '
  'detail; portal.moi.gov.qa serves 70KB of markup carrying under 2,000 characters with 85% '
  'shared between sibling pages, its e-services host does not complete a connection from '
  'production, and hukoomi.gov.qa returns HTTP 403 despite robots.txt permitting the path. '
  'So this destination publishes what a visa COSTS and not who qualifies for it.',
  '2026-08-24'::timestamptz)
on conflict (code) do update set
  immigration_authority     = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  foreign_affairs_authority = excluded.foreign_affairs_authority,
  official_visa_url         = excluded.official_visa_url,
  official_languages        = excluded.official_languages,
  support_state             = excluded.support_state,
  jurisdiction_note         = excluded.jurisdiction_note,
  last_verified_at          = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select (select id from public.visa_countries where code = v.cc),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-24'::timestamptz
from (values
  ('JO', 'jo-tourist-visa', 'tourism',
   'التأشيرة التي تحتاجها لزيارة المملكة الأردنية الهاشمية', 'tourist-visa',
   'The visa needed to visit the Hashemite Kingdom of Jordan: single-entry tourist visa, visa on arrival, or e-visa.'),
  ('QA', 'qa-mission-issued-visas', 'other',
   'Types of visas issued by the diplomatic, consular and representative missions of the State of Qatar abroad', 'mission-issued-visas',
   'The seven visa types issued by Qatari missions abroad through the automated system, and their fees.')
) as v(cc, visaai_id, category, official_name, slug, purpose)
on conflict (visaai_id) do nothing;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select c.id, t.id, 'requirements', v.authority, 1,
  v.url, v.url, v.title, v.lang,
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('jo-tourist-visa',
   'https://jordan.gov.jo/AR/Pages/%d8%aa%d8%a3%d8%b4%d9%8a%d8%b1%d8%a7%d8%aa_%d8%a7%d9%84%d8%b3%d9%81%d8%b1',
   'التأشيرة التي تحتاجها لزيارة المملكة الأردنية الهاشمية',
   'Government of Jordan — national eGovernment portal', 'ar'),
  ('qa-mission-issued-visas',
   'https://mofa.gov.qa/en/consular-services/visas',
   'Visas — Consular Services',
   'Ministry of Foreign Affairs — Consular Affairs Department', 'en')
) as v(visaai_id, url, title, authority, lang)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n integer;
begin
  select count(*) into n from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code in ('JO','QA') and t.lifecycle_state = 'active';
  if n <> 2 then raise exception 'Expected exactly 2 routes across Jordan and Qatar, found %', n; end if;

  select count(*) into n from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id where c.code in ('JO','QA');
  if n <> 2 then raise exception 'Expected exactly 2 sources, found %', n; end if;

  -- Kuwait and Iraq have a readable page that is about something else. Neither
  -- may be registered as a destination on the strength of it.
  if exists (select 1 from public.visa_countries where code in ('KW','IQ') and support_state <> 'unsupported') then
    raise exception 'Kuwait and Iraq have no inbound-visa page and must stay unsupported';
  end if;

  select count(*) into n from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id where c.code in ('JO','QA');
  if n <> 0 then raise exception 'Jordan and Qatar must register with zero requirements; found %', n; end if;

  raise notice 'Jordan and Qatar registered: 1 route each, support_state=preview';
end $$;

commit;
