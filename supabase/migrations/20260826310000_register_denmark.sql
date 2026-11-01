-- Denmark: the 20th destination, admitted after being refused twice for a
-- reason that was never true.
--
-- WHY IT WAS REFUSED, AND WHY THAT WAS WRONG
--
-- Denmark was filed as `readable_but_catalogue_not_enumerable` on 2026-08-24
-- and re-confirmed on 2026-08-26 by measuring the sitemap (404 in two
-- locations). Its leaf pages read; its route index appeared to be entirely
-- client-rendered, so we could read a permit page whose URL we already knew and
-- could not say which permits exist. Ledger rule 24 makes that a refusal:
-- admission needs pages that read AND an index that enumerates, because
-- publishing routes found by search claims a catalogue we cannot show is
-- complete.
--
-- Both passes asked what the page RENDERS. nyidanmark.dk is a Sitecore-backed
-- Angular app, and it hands its components their data server-side as JSON
-- inside an HTML attribute:
--
--   <app-cards model="{&quot;Header&quot;:&quot;For you who want to apply based
--   on&quot;,&quot;LinkBoxes&quot;:[{&quot;Header&quot;:&quot;Short stay
--   (visa)&quot;,&quot;LinkToPage&quot;:&quot;/en-GB/You-want-to-apply/Short-
--   stay-visa&quot;}, ...]}">
--
-- The server sends 25,114 bytes for a page whose visible text is one heading,
-- and neither pass asked what the other 24KB was. Walking those attributes
-- (`scripts/visa-registry/dk-route-catalogue.mjs`, run from the VPS) enumerates
-- 169 pages, every one HTTP 200: 22 top-level categories, 73 with sub-routes,
-- 96 leaves.
--
-- So rule 24 is NOT overturned here. Denmark satisfies it. Every URL below was
-- read from a LinkToPage the authority published; none is constructed.
--
-- TWO AGENCIES, AND THE SOURCES SAY WHICH
--
-- Denmark decides these routes through two bodies sharing one portal. That is
-- not an assumption — it was measured on the pages themselves, counting agency
-- mentions in the normalized text:
--
--   Pay Limit, both Positive Lists, Fast-Track, Researchers, higher education
--   and PhD  ->  SIRI names itself 16-60 times, the Immigration Service once.
--   Short-stay visa, spouse reunification, permanent residence  ->  the
--   Immigration Service 13-34 times, SIRI once or twice.
--
-- `visa_sources.authority` therefore carries the DECIDING agency per route, and
-- an assertion below refuses the migration if that split is ever flattened. A
-- reader who is told the wrong agency writes to the wrong caseworker.
--
-- `immigration_authority` holds the Danish Immigration Service because the
-- column is singular; SIRI is not a foreign-affairs ministry and putting it in
-- `foreign_affairs_authority` — where Türkiye's MFA sits — would be a false
-- statement about what SIRI is. `jurisdiction_note` records the split in words
-- so it is visible rather than implied.
--
-- REGISTERED AT `preview`, DELIBERATELY
--
-- Ten routes and ten sources, and not one requirement yet. `preview` is what
-- that is: a real authority, real visa types and real official links, with no
-- claim to have read the requirements. Finland spent this same session marked
-- `supported` on exactly this much evidence, and `check-support-state.ts` now
-- exists because of it. Promotion to `supported` happens in the promote
-- migration, after extraction, or not at all.
--
-- WHAT IS ENUMERATED AND NOT REGISTERED
--
-- 66 of the 169 pages qualify as routes with real requirement content (>= 5,000
-- normalized characters, >= 4 requirement markers, dateline 2024 or later).
-- Ten are registered here. The remaining 56 are named in
-- `docs/visa-data/GLOBAL_COVERAGE_EXCEPTIONS.md` as enumerated-but-not-extracted,
-- which is the honest shape: the catalogue is known and published, the
-- extraction is partial and says so. Registering 66 empty types would read as
-- coverage from a distance, which is what rule 29 forbids.
--
-- The Faroe Islands and Greenland (16 pages) are excluded on jurisdiction, not
-- on quality: they run their own immigration rules and are not Schengen.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  official_visa_url, official_languages, support_state, data_quality,
  jurisdiction_note, last_verified_at
) values (
  'DK', 'Denmark', 'denmark',
  'Danish Immigration Service (Udlændingestyrelsen)',
  'https://www.nyidanmark.dk/en-GB',
  'https://www.nyidanmark.dk/en-GB/You-want-to-apply',
  array['da','en'],
  'preview',
  'unverified',
  'Denmark decides residence through two agencies sharing the nyidanmark.dk portal: '
  'SIRI (the Danish Agency for International Recruitment and Integration) decides work '
  'and study routes, and the Danish Immigration Service (Udlændingestyrelsen) decides '
  'visitor, family and permanent-residence routes. visa_sources.authority carries the '
  'deciding agency for each route. Greenland and the Faroe Islands run separate '
  'immigration rules and are not covered by these routes.',
  '2026-08-26'::timestamptz
)
on conflict (code) do update set
  immigration_authority     = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  official_visa_url         = excluded.official_visa_url,
  official_languages        = excluded.official_languages,
  support_state             = excluded.support_state,
  jurisdiction_note         = excluded.jurisdiction_note,
  last_verified_at          = excluded.last_verified_at;

-- official_name is the page's own H1, read on 2026-08-26, never a paraphrase.
insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'DK'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-26'::timestamptz
from (values
  ('dk-short-stay-visa', 'visitor',
   'Apply for a short term visa to private visits and tourist visits', 'short-stay-visa',
   'The Schengen short-stay visa for private and tourist visits to Denmark, decided by the Danish Immigration Service.'),
  ('dk-pay-limit-scheme', 'skilled_worker',
   'The Pay Limit Scheme', 'pay-limit-scheme',
   'Residence and work permit for a job whose annual salary meets the pay limit, with no requirement that the occupation appear on any list.'),
  ('dk-positive-list-higher-education', 'skilled_worker',
   'The Positive List for People with a Higher Education', 'positive-list-higher-education',
   'Residence and work permit for occupations on the Positive List for people with a higher education, which records professions experiencing a shortage of qualified workers.'),
  ('dk-positive-list-skilled-work', 'skilled_worker',
   'The Positive List for Skilled Work', 'positive-list-skilled-work',
   'Residence and work permit for skilled occupations on the Positive List for Skilled Work, compiled from regional labour market shortages.'),
  ('dk-fast-track-scheme', 'skilled_worker',
   'Fast-Track Scheme', 'fast-track-scheme',
   'Residence and work permit through a certified employer, allowing several tracks including starting work before the permit is decided.'),
  ('dk-researcher', 'research',
   'Researchers', 'researcher',
   'Residence and work permit for a researcher employed at a Danish research institution or company.'),
  ('dk-student-higher-education', 'student',
   'Higher educational programmes', 'higher-education',
   'Residence permit to follow a higher educational programme at a Danish institution.'),
  ('dk-employed-phd', 'academic',
   'PhD studies (full degree)', 'phd-studies',
   'Residence permit to take a full PhD degree in Denmark, whether enrolled as a student or employed by the institution.'),
  ('dk-family-spouse-partner', 'spouse_partner',
   'Apply for family reunification as a spouse', 'family-reunification-spouse',
   'Family reunification with a spouse, registered partner or cohabiting partner living in Denmark.'),
  ('dk-permanent-residence', 'permanent_residence',
   'Apply for a permanent residence permit', 'permanent-residence',
   'Permanent residence in Denmark, subject to the length-of-stay, employment, language and self-support conditions the authority publishes.')
) as v(visaai_id, category, official_name, slug, purpose)
on conflict (visaai_id) do nothing;

-- SIRI decides work and study. Seven routes.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'SIRI — the Danish Agency for International Recruitment and Integration', 1,
  v.url, v.url, v.title, 'en',
  -- robots.txt is HTTP 404 on this host: conventionally unrestricted, which is
  -- NOT the same as a 403 we cannot read. Recorded as the decision it is.
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('dk-pay-limit-scheme',
   'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Pay-limit-scheme',
   'The Pay Limit Scheme'),
  ('dk-positive-list-higher-education',
   'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Positive-List-Higher-Education',
   'The Positive List for People with a Higher Education'),
  ('dk-positive-list-skilled-work',
   'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/The-Positive-Lists/Positive-List-for-skilled-work',
   'The Positive List for Skilled Work'),
  ('dk-fast-track-scheme',
   'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Fast-track',
   'Fast-Track Scheme'),
  ('dk-researcher',
   'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Researcher',
   'Researchers'),
  ('dk-student-higher-education',
   'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Study/Higher-Education',
   'Higher educational programmes'),
  ('dk-employed-phd',
   'https://www.nyidanmark.dk/en-GB/You-want-to-apply/PhD/Phd-studies',
   'PhD studies (full degree)')
) as v(visaai_id, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

-- The Danish Immigration Service decides visitor, family and permanent residence.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'Danish Immigration Service (Udlændingestyrelsen)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('dk-short-stay-visa',
   'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Short-stay-visa/Private-visits-and-tourist-visits-',
   'Apply for a short term visa to private visits and tourist visits'),
  ('dk-family-spouse-partner',
   'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Family/Family-reunification/Spouse-or-cohabiting-partner',
   'Apply for family reunification as a spouse'),
  ('dk-permanent-residence',
   'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Permanent-residence-permit/Permanent-residence',
   'Apply for a permanent residence permit')
) as v(visaai_id, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare
  n_types integer; n_src integer; n_siri integer; n_uds integer;
  n_pages integer; n_state text; n_constructed integer;
begin
  select count(*) into n_types from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'DK' and t.lifecycle_state = 'active';
  if n_types <> 10 then raise exception 'Expected 10 Danish routes, found %', n_types; end if;

  select count(*) into n_src from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id where c.code = 'DK';
  if n_src <> 10 then raise exception 'Expected 10 Danish sources, found %', n_src; end if;

  -- THE AGENCY SPLIT, which the pages themselves establish. Flattening it would
  -- send a reader to the wrong caseworker with no visible symptom.
  select count(*) into n_siri from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id
   where c.code = 'DK' and s.authority like 'SIRI%';
  select count(*) into n_uds from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id
   where c.code = 'DK' and s.authority like 'Danish Immigration Service%';
  if n_siri <> 7 or n_uds <> 3 then
    raise exception
      'Denmark decides through two agencies: expected 7 SIRI sources and 3 Immigration '
      'Service sources, found % and %', n_siri, n_uds;
  end if;

  -- Every source URL must sit under the enumerated English catalogue. A URL
  -- outside it would be one nobody read off the site.
  select count(*) into n_constructed from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id
   where c.code = 'DK'
     and s.source_url not like 'https://www.nyidanmark.dk/en-GB/%';
  if n_constructed > 0 then
    raise exception '% Danish source URL(s) are not under the enumerated en-GB catalogue', n_constructed;
  end if;

  -- Registration publishes NOTHING. Requirements come next, promotion after.
  select count(*) into n_pages from public.visa_publishable_pages where country_code = 'DK';
  if n_pages <> 0 then
    raise exception 'Registration must publish no pages; found %. Requirements are not extracted yet.', n_pages;
  end if;

  select support_state into n_state from public.visa_countries where code = 'DK';
  if n_state <> 'preview' then
    raise exception 'Denmark must register at preview, not %', n_state;
  end if;

  raise notice 'Denmark registered: 10 routes, 10 sources (7 SIRI / 3 Immigration Service), 0 pages, preview.';
end $$;
