-- Register IRCC's Complete Guide (IMM 5289) for ca-sponsor-your-spouse-partner-or-child,
-- so the spousal checklist can carry the documents and forms IRCC names.
-- Date: 2026-10-19
--
-- WHY
--
-- The route had two `evidence` rows (applicant_photo, processing_fee_receipt)
-- and two forms (IMM 1344, IMM 5476). The program sets
-- `checklistSupplement: false` (apps/api/src/strategies/visa-program/
-- spousal-sponsorship.strategy.ts), so the applicant's Documents checklist had
-- no slot for a passport, marriage certificate, birth certificate, police
-- certificate or the sponsor's proof of status, and the Forms list lacked
-- IMM 0008, IMM 5669, IMM 5406 and IMM 5532 (live E2E, 2026-10-19).
--
-- IRCC's document checklist for a spouse (IMM 5533) is an encrypted XFA PDF.
-- The sync stores every fetched body as text in
-- visa_source_versions.normalized_text, and a PDF decoded as text carries NUL
-- bytes that a Postgres text column refuses, so the checklist PDF cannot be a
-- registered source yet. The Complete Guide is the HTML page that states the
-- same documents in prose, registered here as role `documents` (page dated
-- 2026-04-23; guide 5525's URL serves the same page):
--
--   "For spousal sponsorships, make sure you include a valid marriage
--    certificate or proof of registration of your marriage with your
--    application (see checklist details)."
--
-- ORDER (each step depends on the previous):
--   1. this file
--   2. run the registry sync ON THE VPS so the new source gets an active
--      version (scripts/visa-sync-run.ts) -- the requirement migration binds
--      to that version and refuses to run without it
--   3. 20261019220100_req_ca_sponsor_your_spouse_partner_or_child_v2.sql +
--      20261019220200_promote_ca_sponsor_your_spouse_partner_or_child_v2.sql
--      (apply together, in one psql -1 run each, back to back)
--
-- Apply (not applied by this PR):
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, v.role,
  'Immigration, Refugees and Citizenship Canada', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('documents',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/guide-5289-sponsor-your-spouse-common-law-partner-conjugal-partner-dependent-child-complete-guide.html',
   'Sponsor your spouse, common-law partner, conjugal partner or dependent child – Complete Guide (IMM 5289)')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'ca-sponsor-your-spouse-partner-or-child'
join public.visa_countries c on c.id = t.country_id and c.code = 'CA'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'ca-sponsor-your-spouse-partner-or-child' and s.active;
  if n <> 6 then raise exception 'Expected 6 active IRCC sources for ca-sponsor-your-spouse-partner-or-child, found %.', n; end if;
end $$;
