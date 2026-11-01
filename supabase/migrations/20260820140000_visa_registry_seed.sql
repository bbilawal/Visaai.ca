-- Visa registry seed: verified official sources for the four priority destinations.
--
-- GENERATED FILE. Do not hand-edit.
--   source: data/official-sources/priority-destinations.json
--   generator: scripts/visa-registry/generate-seed.mjs
--   dataset generated_at: 2026-08-20
--
-- Every URL below returned HTTP 200 to a fetch on the dataset's generation
-- date and lives on a government-owned domain. Nothing here is transcribed
-- from a blog, an aggregator or a law firm.
--
-- WHAT THIS SEED DOES NOT DO:
--   * No visa_requirements rows. A requirement must cite the TEXT of a
--     source version; this dataset carries URLs, not page text. The sync
--     job fetches and extracts, and a human approves, before any
--     requirement exists. Seeding requirements from URLs alone would be
--     fabrication.
--   * No country is marked 'supported'. These have verified SOURCES and no
--     verified requirements yet, which is exactly what 'preview' means.
--
-- Idempotent: re-running updates in place and never duplicates.

begin;

-- ─── Canada (CA) ──────────────────────────────────────────────────

-- ORDERING FIX (2026-08-21)
--
-- The inserts below use
--   on conflict (source_url, coalesce(visa_type_id, <sentinel>))
-- which requires the expression index `visa_sources_url_per_type_idx`. That
-- index is created by migration 20260820160000 — a LATER timestamp.
--
-- This file never failed locally because it was regenerated AFTER 160000
-- existed, so it acquired the newer conflict target while keeping its original
-- filename. On any database built by replaying migrations in timestamp order —
-- which is every fresh install, including production — it aborted here with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification", leaving a half-created registry.
--
-- Caught by dry-running all 31 migrations against a copy of the production
-- schema before touching production.
--
-- The two statements below are lifted verbatim from 20260820160000 and are
-- both guarded, so this is a no-op on any database where that migration has
-- already run, and 160000 remains a no-op after this. Dropping the global
-- unique index is required, not merely tidy: several visa types legitimately
-- share one authority page, and `visa_sources_url_idx` would reject the second
-- one before the ON CONFLICT target was ever consulted.

drop index if exists public.visa_sources_url_idx;

create unique index if not exists visa_sources_url_per_type_idx
  on public.visa_sources (
    source_url,
    coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

insert into public.visa_countries (
  code, is_bloc, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, foreign_affairs_authority_url,
  official_visa_url, evisa_portal_url, official_languages,
  support_state, data_quality, last_verified_at
) values (
  'CA', false, 'Canada', 'canada',
  'Immigration, Refugees and Citizenship Canada', 'https://www.canada.ca/en/immigration-refugees-citizenship.html',
  null, null,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/come-canada-tool.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta.html',
  array['en']::text[],
  'preview', 'verified', '2026-08-20'::timestamptz
)
on conflict (code) do update set
  name = excluded.name,
  slug = excluded.slug,
  immigration_authority = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  foreign_affairs_authority = excluded.foreign_affairs_authority,
  foreign_affairs_authority_url = excluded.foreign_affairs_authority_url,
  official_visa_url = excluded.official_visa_url,
  evisa_portal_url = excluded.evisa_portal_url,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  'ca-visitor-visa-temporary-resident-visa', 'visitor', 'Visitor visa (temporary resident visa)', 'TRV',
  'visitor-visa-temporary-resident-visa', array['visitor']::text[],
  'Applied both.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-visitor-visa-temporary-resident-visa'),
  'landing', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/visitor-visa.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/visitor-visa.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-visitor-visa-temporary-resident-visa'),
  'eligibility', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eligibility.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eligibility.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-visitor-visa-temporary-resident-visa'),
  'documents', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5484.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5484.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-visitor-visa-temporary-resident-visa'),
  'application', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/apply-visitor-visa.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/apply-visitor-visa.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-visitor-visa-temporary-resident-visa'),
  'fees', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://ircc.canada.ca/english/information/fees/fees.asp', 'https://ircc.canada.ca/english/information/fees/fees.asp', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-visitor-visa-temporary-resident-visa'),
  'forms', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html',
  'IMM 5257 — Application for visitor visa (temporary resident visa)',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  'ca-electronic-travel-authorization-eta', 'eta', 'Electronic travel authorization (eTA)', 'eTA',
  'electronic-travel-authorization-eta', array['tourist']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-electronic-travel-authorization-eta'),
  'landing', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-electronic-travel-authorization-eta'),
  'eligibility', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-electronic-travel-authorization-eta'),
  'application', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/apply.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/apply.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-electronic-travel-authorization-eta'),
  'fees', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://ircc.canada.ca/english/information/fees/fees.asp', 'https://ircc.canada.ca/english/information/fees/fees.asp', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  'ca-study-permit', 'student', 'Study permit', null,
  'study-permit', array['student']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-study-permit'),
  'landing', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-study-permit'),
  'eligibility', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/eligibility.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/eligibility.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-study-permit'),
  'documents', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-study-permit'),
  'application', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/apply.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/apply.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-study-permit'),
  'fees', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://ircc.canada.ca/english/information/fees/fees.asp', 'https://ircc.canada.ca/english/information/fees/fees.asp', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-study-permit'),
  'forms', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm1294.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm1294.html',
  'IMM 1294 — Application for a Study Permit Made Outside of Canada',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  'ca-work-permit', 'work', 'Work permit', null,
  'work-permit', array['work_permit']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-work-permit'),
  'landing', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-work-permit'),
  'application', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit-outside.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit-outside.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-work-permit'),
  'fees', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://ircc.canada.ca/english/information/fees/fees.asp', 'https://ircc.canada.ca/english/information/fees/fees.asp', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-work-permit'),
  'forms', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm1295.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm1295.html',
  'IMM 1295 — Application for a Work Permit Made Outside of Canada',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  'ca-sponsor-your-spouse-partner-or-child', 'family', 'Sponsor your spouse, partner or child', null,
  'sponsor-your-spouse-partner-or-child', array['family_sponsorship']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-sponsor-your-spouse-partner-or-child'),
  'landing', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/family-sponsorship/spouse-partner-children.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/family-sponsorship/spouse-partner-children.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-sponsor-your-spouse-partner-or-child'),
  'eligibility', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/family-sponsorship/spouse-partner-children/eligibility.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/family-sponsorship/spouse-partner-children/eligibility.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-sponsor-your-spouse-partner-or-child'),
  'application', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/family-sponsorship/spouse-partner-children/apply.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/family-sponsorship/spouse-partner-children/apply.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-sponsor-your-spouse-partner-or-child'),
  'fees', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://ircc.canada.ca/english/information/fees/fees.asp', 'https://ircc.canada.ca/english/information/fees/fees.asp', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-sponsor-your-spouse-partner-or-child'),
  'forms', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm1344.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm1344.html',
  'IMM 1344 — Application to Sponsor, Sponsorship Agreement and Undertaking',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  'ca-express-entry', 'permanent_residence', 'Express Entry', null,
  'express-entry', array['express_entry']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'landing', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'eligibility', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/works.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/works.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'fees', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://ircc.canada.ca/english/information/fees/fees.asp', 'https://ircc.canada.ca/english/information/fees/fees.asp', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  'ca-business-visitors', 'other', 'Business visitors', null,
  'business-visitors', '{}',
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;

-- ─── United States of America (US) ────────────────────────────────
insert into public.visa_countries (
  code, is_bloc, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, foreign_affairs_authority_url,
  official_visa_url, evisa_portal_url, official_languages,
  support_state, data_quality, last_verified_at
) values (
  'US', false, 'United States of America', 'united-states',
  'U.S. Citizenship and Immigration Services', 'https://www.uscis.gov/',
  'U.S. Department of State — Bureau of Consular Affairs', 'https://travel.state.gov/content/travel/en/us-visas.html',
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/all-visa-categories.html', 'https://esta.cbp.dhs.gov/',
  array['en']::text[],
  'preview', 'verified', '2026-08-20'::timestamptz
)
on conflict (code) do update set
  name = excluded.name,
  slug = excluded.slug,
  immigration_authority = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  foreign_affairs_authority = excluded.foreign_affairs_authority,
  foreign_affairs_authority_url = excluded.foreign_affairs_authority_url,
  official_visa_url = excluded.official_visa_url,
  evisa_portal_url = excluded.evisa_portal_url,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'US'),
  'us-visitor-visa-b-1-business-b-2-tourism', 'visitor', 'Visitor Visa (B-1 business / B-2 tourism)', 'B-1/B-2',
  'visitor-visa-b-1-business-b-2-tourism', array['visitor']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-visitor-visa-b-1-business-b-2-tourism'),
  'landing', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html', 'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-visitor-visa-b-1-business-b-2-tourism'),
  'application', 'U.S. Citizenship and Immigration Services', 1,
  'https://ceac.state.gov/genniv/', 'https://ceac.state.gov/genniv/', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-visitor-visa-b-1-business-b-2-tourism'),
  'fees', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-visitor-visa-b-1-business-b-2-tourism'),
  'forms', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/forms/ds-160-online-nonimmigrant-visa-application.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/forms/ds-160-online-nonimmigrant-visa-application.html',
  'DS-160 — Online Nonimmigrant Visa Application',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'US'),
  'us-business-visitor', 'business', 'Business visitor', 'B-1',
  'business-visitor', array['business']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-business-visitor'),
  'landing', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html', 'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-business-visitor'),
  'application', 'U.S. Citizenship and Immigration Services', 1,
  'https://ceac.state.gov/genniv/', 'https://ceac.state.gov/genniv/', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-business-visitor'),
  'fees', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-business-visitor'),
  'forms', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/forms/ds-160-online-nonimmigrant-visa-application.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/forms/ds-160-online-nonimmigrant-visa-application.html',
  'DS-160 — Online Nonimmigrant Visa Application',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'US'),
  'us-visa-waiver-program-esta', 'eta', 'Visa Waiver Program / ESTA', 'VWP',
  'visa-waiver-program-esta', array['tourist']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-visa-waiver-program-esta'),
  'landing', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visa-waiver-program.html', 'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visa-waiver-program.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-visa-waiver-program-esta'),
  'application', 'U.S. Citizenship and Immigration Services', 1,
  'https://esta.cbp.dhs.gov/', 'https://esta.cbp.dhs.gov/', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-visa-waiver-program-esta'),
  'fees', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'US'),
  'us-student-visa-academic-f-vocational-m', 'student', 'Student Visa (academic F, vocational M)', 'F-1/M-1',
  'student-visa-academic-f-vocational-m', array['student']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-student-visa-academic-f-vocational-m'),
  'landing', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/study/student-visa.html', 'https://travel.state.gov/content/travel/en/us-visas/study/student-visa.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-student-visa-academic-f-vocational-m'),
  'application', 'U.S. Citizenship and Immigration Services', 1,
  'https://ceac.state.gov/genniv/', 'https://ceac.state.gov/genniv/', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-student-visa-academic-f-vocational-m'),
  'fees', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-student-visa-academic-f-vocational-m'),
  'forms', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/forms/ds-160-online-nonimmigrant-visa-application.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/forms/ds-160-online-nonimmigrant-visa-application.html',
  'DS-160 — Online Nonimmigrant Visa Application',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'US'),
  'us-temporary-worker-visas', 'work', 'Temporary Worker Visas', null,
  'temporary-worker-visas', array['work_permit', 'H-1B', 'H-2A', 'H-2B', 'P-1', 'Q-1']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-temporary-worker-visas'),
  'landing', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/employment/temporary-worker-visas.html', 'https://travel.state.gov/content/travel/en/us-visas/employment/temporary-worker-visas.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-temporary-worker-visas'),
  'application', 'U.S. Citizenship and Immigration Services', 1,
  'https://ceac.state.gov/genniv/', 'https://ceac.state.gov/genniv/', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-temporary-worker-visas'),
  'fees', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-temporary-worker-visas'),
  'forms', 'U.S. Citizenship and Immigration Services', 1,
  'https://www.uscis.gov/i-129', 'https://www.uscis.gov/i-129',
  'Form I-129 — Petition for a Nonimmigrant Worker',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-temporary-worker-visas'),
  'forms', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/forms/ds-160-online-nonimmigrant-visa-application.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/forms/ds-160-online-nonimmigrant-visa-application.html',
  'DS-160 — Online Nonimmigrant Visa Application',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-temporary-worker-visas'),
  'forms', 'U.S. Citizenship and Immigration Services', 1,
  'https://www.uscis.gov/i-765', 'https://www.uscis.gov/i-765',
  'Form I-765 — Application for Employment Authorization',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'US'),
  'us-family-immigration-immediate-relative-and-family-preference-immigrant-visas', 'family', 'Family Immigration (Immediate Relative and Family Preference immigrant visas)', null,
  'family-immigration-immediate-relative-and-family-preference-immigrant-visas', array['family_sponsorship', 'IR1', 'CR1', 'F1', 'F2A', 'F2B', 'F3', 'F4']::text[],
  'Applied both.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-family-immigration-immediate-relative-and-family-preference-immigrant-visas'),
  'landing', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/immigrate/family-immigration.html', 'https://travel.state.gov/content/travel/en/us-visas/immigrate/family-immigration.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-family-immigration-immediate-relative-and-family-preference-immigrant-visas'),
  'eligibility', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/immigrate/the-immigrant-visa-process/step-1-submit-a-petition.html', 'https://travel.state.gov/content/travel/en/us-visas/immigrate/the-immigrant-visa-process/step-1-submit-a-petition.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-family-immigration-immediate-relative-and-family-preference-immigrant-visas'),
  'application', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/immigrate/the-immigrant-visa-process/step-1-submit-a-petition/step-2-begin-nvc-processing.html', 'https://travel.state.gov/content/travel/en/us-visas/immigrate/the-immigrant-visa-process/step-1-submit-a-petition/step-2-begin-nvc-processing.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-family-immigration-immediate-relative-and-family-preference-immigrant-visas'),
  'fees', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-family-immigration-immediate-relative-and-family-preference-immigrant-visas'),
  'forms', 'U.S. Citizenship and Immigration Services', 1,
  'https://www.uscis.gov/i-130', 'https://www.uscis.gov/i-130',
  'Form I-130 — Petition for Alien Relative',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-family-immigration-immediate-relative-and-family-preference-immigrant-visas'),
  'forms', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/forms/online-immigrant-visa-forms/ds-260-faqs.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/forms/online-immigrant-visa-forms/ds-260-faqs.html',
  'DS-260 — Immigrant Visa Electronic Application',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-family-immigration-immediate-relative-and-family-preference-immigrant-visas'),
  'forms', 'U.S. Citizenship and Immigration Services', 1,
  'https://www.uscis.gov/i-485', 'https://www.uscis.gov/i-485',
  'Form I-485 — Application to Register Permanent Residence or Adjust Status',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'US'),
  'us-exchange-visitor', 'other', 'Exchange visitor', 'J',
  'exchange-visitor', '{}',
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-exchange-visitor'),
  'fees', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'US'),
  'us-treaty-trader-treaty-investor', 'other', 'Treaty trader/treaty investor', 'E',
  'treaty-trader-treaty-investor', '{}',
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-treaty-trader-treaty-investor'),
  'fees', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'US'),
  'us-transiting-the-united-states', 'other', 'Transiting the United States', 'C',
  'transiting-the-united-states', '{}',
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  (select id from public.visa_types where visaai_id = 'us-transiting-the-united-states'),
  'fees', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/fees/fees-visa-services.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

-- ─── United Kingdom (GB) ──────────────────────────────────────────
insert into public.visa_countries (
  code, is_bloc, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, foreign_affairs_authority_url,
  official_visa_url, evisa_portal_url, official_languages,
  support_state, data_quality, last_verified_at
) values (
  'GB', false, 'United Kingdom', 'united-kingdom',
  'UK Visas and Immigration', 'https://www.gov.uk/government/organisations/uk-visas-and-immigration',
  'Foreign, Commonwealth & Development Office', 'https://www.gov.uk/government/organisations/foreign-commonwealth-development-office',
  'https://www.gov.uk/browse/visas-immigration', 'https://www.gov.uk/eta',
  array['en']::text[],
  'preview', 'verified', '2026-08-20'::timestamptz
)
on conflict (code) do update set
  name = excluded.name,
  slug = excluded.slug,
  immigration_authority = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  foreign_affairs_authority = excluded.foreign_affairs_authority,
  foreign_affairs_authority_url = excluded.foreign_affairs_authority_url,
  official_visa_url = excluded.official_visa_url,
  evisa_portal_url = excluded.evisa_portal_url,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  'gb-standard-visitor-visa', 'visitor', 'Standard Visitor visa', null,
  'standard-visitor-visa', array['visitor']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-standard-visitor-visa'),
  'landing', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/standard-visitor', 'https://www.gov.uk/standard-visitor', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-standard-visitor-visa'),
  'application', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/standard-visitor/apply-standard-visitor-visa', 'https://www.gov.uk/standard-visitor/apply-standard-visitor-visa', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-standard-visitor-visa'),
  'forms', 'UK Visas and Immigration', 1,
  'https://visas-immigration.service.gov.uk/product/uk-visit-visa', 'https://visas-immigration.service.gov.uk/product/uk-visit-visa',
  'Online application on the UKVI visa service (no paper form identifier is published on the official guide)',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  'gb-standard-visitor-visa-visit-on-business', 'business', 'Standard Visitor visa — Visit on business', null,
  'standard-visitor-visa-visit-on-business', array['business']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-standard-visitor-visa-visit-on-business'),
  'landing', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/standard-visitor/visit-on-business', 'https://www.gov.uk/standard-visitor/visit-on-business', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-standard-visitor-visa-visit-on-business'),
  'application', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/standard-visitor/apply-standard-visitor-visa', 'https://www.gov.uk/standard-visitor/apply-standard-visitor-visa', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-standard-visitor-visa-visit-on-business'),
  'forms', 'UK Visas and Immigration', 1,
  'https://visas-immigration.service.gov.uk/product/uk-visit-visa', 'https://visas-immigration.service.gov.uk/product/uk-visit-visa',
  'Online application on the UKVI visa service',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  'gb-electronic-travel-authorisation-eta', 'eta', 'Electronic travel authorisation (ETA)', 'ETA',
  'electronic-travel-authorisation-eta', array['tourist']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-electronic-travel-authorisation-eta'),
  'landing', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/eta', 'https://www.gov.uk/eta', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-electronic-travel-authorisation-eta'),
  'eligibility', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/eta/when-not-need-eta', 'https://www.gov.uk/eta/when-not-need-eta', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-electronic-travel-authorisation-eta'),
  'application', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/eta/apply', 'https://www.gov.uk/eta/apply', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  'gb-student-visa', 'student', 'Student visa', null,
  'student-visa', array['student']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-student-visa'),
  'landing', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/student-visa', 'https://www.gov.uk/student-visa', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-student-visa'),
  'eligibility', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/student-visa/course', 'https://www.gov.uk/student-visa/course', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-student-visa'),
  'documents', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/student-visa/documents-you-must-provide', 'https://www.gov.uk/student-visa/documents-you-must-provide', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-student-visa'),
  'application', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/student-visa/apply-online', 'https://www.gov.uk/student-visa/apply-online', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-student-visa'),
  'fees', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/government/publications/visa-regulations-revised-table', 'https://www.gov.uk/government/publications/visa-regulations-revised-table', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  'gb-skilled-worker-visa', 'work', 'Skilled Worker visa', null,
  'skilled-worker-visa', array['work_permit']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-skilled-worker-visa'),
  'landing', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/skilled-worker-visa', 'https://www.gov.uk/skilled-worker-visa', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-skilled-worker-visa'),
  'eligibility', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/skilled-worker-visa/your-job', 'https://www.gov.uk/skilled-worker-visa/your-job', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-skilled-worker-visa'),
  'documents', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/skilled-worker-visa/documents-you-must-provide', 'https://www.gov.uk/skilled-worker-visa/documents-you-must-provide', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-skilled-worker-visa'),
  'application', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/skilled-worker-visa/apply-from-outside-the-uk', 'https://www.gov.uk/skilled-worker-visa/apply-from-outside-the-uk', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-skilled-worker-visa'),
  'fees', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/skilled-worker-visa/how-much-it-costs', 'https://www.gov.uk/skilled-worker-visa/how-much-it-costs', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  'gb-family-visas-apply-extend-or-switch-apply-as-a-partner-or-spouse', 'family', 'Family visas: apply, extend or switch — Apply as a partner or spouse', null,
  'family-visas-apply-extend-or-switch-apply-as-a-partner-or-spouse', array['family_sponsorship']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-family-visas-apply-extend-or-switch-apply-as-a-partner-or-spouse'),
  'landing', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/uk-family-visa', 'https://www.gov.uk/uk-family-visa', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-family-visas-apply-extend-or-switch-apply-as-a-partner-or-spouse'),
  'eligibility', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/uk-family-visa/partner-spouse', 'https://www.gov.uk/uk-family-visa/partner-spouse', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-family-visas-apply-extend-or-switch-apply-as-a-partner-or-spouse'),
  'documents', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/uk-family-visa/provide-information', 'https://www.gov.uk/uk-family-visa/provide-information', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  (select id from public.visa_types where visaai_id = 'gb-family-visas-apply-extend-or-switch-apply-as-a-partner-or-spouse'),
  'fees', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/government/publications/visa-regulations-revised-table', 'https://www.gov.uk/government/publications/visa-regulations-revised-table', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

-- ─── Australia (AU) ───────────────────────────────────────────────
insert into public.visa_countries (
  code, is_bloc, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, foreign_affairs_authority_url,
  official_visa_url, evisa_portal_url, official_languages,
  support_state, data_quality, last_verified_at
) values (
  'AU', false, 'Australia', 'australia',
  'Department of Home Affairs', 'https://www.homeaffairs.gov.au/about-us/our-portfolios/immigration-and-citizenship',
  'Department of Foreign Affairs and Trade', null,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601',
  array['en']::text[],
  'preview', 'verified', '2026-08-20'::timestamptz
)
on conflict (code) do update set
  name = excluded.name,
  slug = excluded.slug,
  immigration_authority = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  foreign_affairs_authority = excluded.foreign_affairs_authority,
  foreign_affairs_authority_url = excluded.foreign_affairs_authority_url,
  official_visa_url = excluded.official_visa_url,
  evisa_portal_url = excluded.evisa_portal_url,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  'au-visitor-visa-subclass-600', 'visitor', 'Visitor visa (subclass 600)', 'subclass 600',
  'visitor-visa-subclass-600', array['visitor']::text[],
  'Applied online.',
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-visitor-visa-subclass-600'),
  'landing', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-visitor-visa-subclass-600'),
  'eligibility', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-visitor-visa-subclass-600'),
  'fees', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-visitor-visa-subclass-600'),
  'forms', 'Department of Home Affairs', 1,
  'https://online.immi.gov.au/lusc/login', 'https://online.immi.gov.au/lusc/login',
  'Online application lodged through ImmiAccount',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  'au-visitor-visa-subclass-600-business-visitor-stream', 'business', 'Visitor visa (subclass 600) — Business visitor stream', 'subclass 600 (Business visitor stream)',
  'visitor-visa-subclass-600-business-visitor-stream', array['business']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-visitor-visa-subclass-600-business-visitor-stream'),
  'landing', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/business-visitor-stream', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/business-visitor-stream', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-visitor-visa-subclass-600-business-visitor-stream'),
  'fees', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  'au-electronic-travel-authority-subclass-601', 'eta', 'Electronic Travel Authority (subclass 601)', 'subclass 601',
  'electronic-travel-authority-subclass-601', array['tourist']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-electronic-travel-authority-subclass-601'),
  'landing', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-electronic-travel-authority-subclass-601'),
  'fees', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  'au-student-visa-subclass-500', 'student', 'Student visa (subclass 500)', 'subclass 500',
  'student-visa-subclass-500', array['student']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-student-visa-subclass-500'),
  'landing', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-student-visa-subclass-500'),
  'eligibility', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500/genuine-student-requirement', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500/genuine-student-requirement', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-student-visa-subclass-500'),
  'documents', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500/disclaimer-for-document-checklist', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500/disclaimer-for-document-checklist', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-student-visa-subclass-500'),
  'fees', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-student-visa-subclass-500'),
  'forms', 'Department of Home Affairs', 1,
  'https://online.immi.gov.au/lusc/login', 'https://online.immi.gov.au/lusc/login',
  'Online application lodged through ImmiAccount',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  'au-skills-in-demand-visa-subclass-482', 'work', 'Skills in Demand visa (subclass 482)', 'subclass 482',
  'skills-in-demand-visa-subclass-482', array['work_permit']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-skills-in-demand-visa-subclass-482'),
  'landing', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skills-in-demand-visa-subclass-482', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skills-in-demand-visa-subclass-482', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-skills-in-demand-visa-subclass-482'),
  'eligibility', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skills-in-demand-visa-subclass-482/core-skills-stream', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skills-in-demand-visa-subclass-482/core-skills-stream', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-skills-in-demand-visa-subclass-482'),
  'fees', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-skills-in-demand-visa-subclass-482'),
  'forms', 'Department of Home Affairs', 1,
  'https://online.immi.gov.au/lusc/login', 'https://online.immi.gov.au/lusc/login',
  'Online application lodged through ImmiAccount',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  'au-partner-visa-apply-in-australia-subclass-820-and-801', 'family', 'Partner visa (apply in Australia) (subclass 820 and 801)', 'subclass 820/801',
  'partner-visa-apply-in-australia-subclass-820-and-801', array['family_sponsorship']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-partner-visa-apply-in-australia-subclass-820-and-801'),
  'landing', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/partner-onshore', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/partner-onshore', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-partner-visa-apply-in-australia-subclass-820-and-801'),
  'eligibility', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/partner-onshore/temporary-820', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/partner-onshore/temporary-820', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-partner-visa-apply-in-australia-subclass-820-and-801'),
  'fees', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-partner-visa-apply-in-australia-subclass-820-and-801'),
  'forms', 'Department of Home Affairs', 1,
  'https://online.immi.gov.au/lusc/login', 'https://online.immi.gov.au/lusc/login',
  'Online application lodged through ImmiAccount',
  'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  'au-skilled-independent-visa-subclass-189', 'permanent_residence', 'Skilled Independent visa (subclass 189)', 'subclass 189',
  'skilled-independent-visa-subclass-189', array['permanent_residency']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-skilled-independent-visa-subclass-189'),
  'landing', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skilled-independent-189', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skilled-independent-189', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-skilled-independent-visa-subclass-189'),
  'fees', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  'au-business-innovation-and-investment-provisional-visa-subclass-188', 'investor', 'Business Innovation and Investment (Provisional) visa (subclass 188)', 'subclass 188',
  'business-innovation-and-investment-provisional-visa-subclass-188', array['investor']::text[],
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-business-innovation-and-investment-provisional-visa-subclass-188'),
  'landing', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/business-innovation-and-investment-188', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/business-innovation-and-investment-188', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-business-innovation-and-investment-provisional-visa-subclass-188'),
  'fees', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  'au-temporary-graduate-visa-subclass-485', 'other', 'Temporary Graduate visa (subclass 485)', 'subclass 485',
  'temporary-graduate-visa-subclass-485', '{}',
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-temporary-graduate-visa-subclass-485'),
  'landing', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/temporary-graduate-485', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/temporary-graduate-485', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-temporary-graduate-visa-subclass-485'),
  'fees', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  'au-working-holiday-visa-subclass-417', 'other', 'Working Holiday visa (subclass 417)', 'subclass 417',
  'working-holiday-visa-subclass-417', '{}',
  null,
  'active', 'verified', '2026-08-20'::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-working-holiday-visa-subclass-417'),
  'landing', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/work-holiday-417', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/work-holiday-417', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  (select id from public.visa_types where visaai_id = 'au-working-holiday-visa-subclass-417'),
  'fees', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  null, 'index', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/come-canada-tool.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/come-canada-tool.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  null, 'index', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/services/immigration-citizenship.html', 'https://www.canada.ca/en/services/immigration-citizenship.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  null, 'index', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  null, 'index', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  null, 'index', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  null, 'index', 'Immigration, Refugees and Citizenship Canada', 1,
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada.html', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  null, 'index', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/all-visa-categories.html', 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/all-visa-categories.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  null, 'index', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas.html', 'https://travel.state.gov/content/travel/en/us-visas.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  null, 'index', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/tourism-visit.html', 'https://travel.state.gov/content/travel/en/us-visas/tourism-visit.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  null, 'index', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/study.html', 'https://travel.state.gov/content/travel/en/us-visas/study.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  null, 'index', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/employment.html', 'https://travel.state.gov/content/travel/en/us-visas/employment.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  null, 'index', 'U.S. Citizenship and Immigration Services', 1,
  'https://travel.state.gov/content/travel/en/us-visas/immigrate.html', 'https://travel.state.gov/content/travel/en/us-visas/immigrate.html', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  null, 'index', 'U.S. Citizenship and Immigration Services', 1,
  'https://www.uscis.gov/working-in-the-united-states', 'https://www.uscis.gov/working-in-the-united-states', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'US'),
  null, 'index', 'U.S. Citizenship and Immigration Services', 1,
  'https://www.uscis.gov/family/family-of-us-citizens', 'https://www.uscis.gov/family/family-of-us-citizens', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  null, 'index', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/browse/visas-immigration', 'https://www.gov.uk/browse/visas-immigration', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  null, 'index', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/browse/visas-immigration/tourist-short-stay-visas', 'https://www.gov.uk/browse/visas-immigration/tourist-short-stay-visas', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  null, 'index', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/browse/visas-immigration/work-visas', 'https://www.gov.uk/browse/visas-immigration/work-visas', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  null, 'index', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/browse/visas-immigration/student-visas', 'https://www.gov.uk/browse/visas-immigration/student-visas', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  null, 'index', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/browse/visas-immigration/family-visas', 'https://www.gov.uk/browse/visas-immigration/family-visas', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'GB'),
  null, 'index', 'UK Visas and Immigration', 1,
  'https://www.gov.uk/apply-to-come-to-the-uk', 'https://www.gov.uk/apply-to-come-to-the-uk', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  null, 'index', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  null, 'index', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas', 'https://immi.homeaffairs.gov.au/visas', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = 'AU'),
  null, 'index', 'Department of Home Affairs', 1,
  'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-finder', 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-finder', 'en', true, '2026-08-20'::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;

commit;

-- Seeded: 4 countries, 32 visa types, 134 official sources.
