-- Register Singapore's entry visa -- ICA's side of the split, and the first
-- route in this registry where THE REQUIREMENTS DEPEND ON THE APPLICANT'S
-- NATIONALITY IN A WAY THE AUTHORITY DOES NOT NAME.
--
-- ONE VISA, 33 PAGES, TWO REGIMES
--
-- ICA publishes one entry visa and a per-nationality detail page for each of the
-- 33 travel documents that need one. The obvious assumption -- one template,
-- differing only in the country name -- is WRONG, and being wrong about it puts
-- the single most consequential Singapore requirement on the wrong applicants:
--
--   * 19 nationalities MUST submit "a completed form v39a ... (letter of
--     introduction for visa application (loi)), which may be issued by a local
--     contact* in singapore", and that local contact must be a Singapore
--     citizen or PR, at least 21, with a Singpass account.
--   * 14 nationalities are told only that additional documents "may be required
--     on a case-by-case basis".
--
-- Same visa, same fee, same processing time, same forms index -- and one group
-- needs a Singaporean sponsor before it can apply while the other does not.
-- A checklist that flattened the 33 pages into one would either invent a
-- sponsor requirement for 14 nationalities or delete a hard one for 19.
--
-- WHY THE SPLIT IS NOT TWO VISA TYPES
--
-- Because ICA does not publish it as two. It publishes one visa and lets the
-- difference fall out of which page you land on. Inventing `sg-entry-visa-loi`
-- would put a distinction in the registry that no authority has made. The
-- distinction is stored where it belongs: as a requirement, with the group it
-- binds named in `parameters`.
--
-- THE HONEST LIMITATION, AND WHAT ANSWERS IT
--
-- Three sources are registered: the hub, plus ONE representative page per
-- group. That means the daily monitor watches 2 of the 33 detail pages, and a
-- change ICA makes to a page outside those two is invisible to it. Rather than
-- leave that as a caveat in prose, `scripts/visa-registry/sg-entry-visa-groups.mjs`
-- re-derives the grouping from all 33 pages and exits non-zero if the membership
-- moved. Verified 2026-08-23: 19 and 14, exactly as recorded.
--
-- The `documents` and `forms` roles carry that split, which is a compromise --
-- `visa_sources.role` has a fixed vocabulary with no slot for "representative of
-- nationality group B". The mapping is not arbitrary, though: the India page's
-- distinguishing sentence is about DOCUMENTS that may be required, and the
-- Pakistan page's is about a FORM that must be completed.
--
-- FRESHNESS: ICA PRINTS ITS OWN DATELINE
--
-- Unlike MOM, ICA states it in the page body: "last updated on 25 june 2026".
-- No dateModified in the head, so the head still reads as unknown; the body
-- dateline is a genuine editorial record and is what the freshness note cites.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SG'),
  'sg-entry-visa', 'visitor',
  'Singapore entry visa',
  'entry-visa',
  'Obtain pre-entry permission to travel to and seek entry into Singapore for a business or social visit, where your travel document requires a visa.',
  'active', 'unverified', '2026-08-23'::timestamptz
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
  c.id, t.id, v.role, 'Immigration & Checkpoints Authority (ICA)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements',
   'Check if you need an entry visa'),
  -- Representative of the 14 nationalities for whom a letter of introduction is
  -- case-by-case. Verified by scripts/visa-registry/sg-entry-visa-groups.mjs.
  ('documents',
   'https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements/visa-detail-page/india',
   'India visa requirements'),
  -- Representative of the 19 nationalities for whom a completed Form V39A LOI
  -- is required. Same script, same run.
  ('forms',
   'https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements/visa-detail-page/pakistan',
   'Pakistan visa requirements')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'sg-entry-visa'
join public.visa_countries c on c.id = t.country_id and c.code = 'SG'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'sg-entry-visa' and s.active;
  if n <> 3 then raise exception 'Expected 3 active ICA sources, found %.', n; end if;
end $$;
