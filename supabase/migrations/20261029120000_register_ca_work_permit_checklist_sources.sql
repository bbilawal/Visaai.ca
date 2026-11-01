-- Register five IRCC pages for ca-work-permit, so its checklist can follow the
-- applicant's permit kind and carry the documents IRCC lists for an
-- application made outside Canada.
-- Date: 2026-10-29
--
-- WHY
--
-- The registry checklist for ca-work-permit (20260821180003, 14 rows) was
-- extracted from four pages: a section index, a link hub, the IMM 1295 form
-- page and the fee list. None lists the documents. As a result:
--   * the LMIA rows had NO condition, so an open-work-permit applicant (the
--     spouse of a worker) was asked for an LMIA and an employment contract;
--   * there was no passport, no photo, no Family Information form, no
--     employer documents, no CAQ, no medical exam and no open-permit family
--     documents at all.
--
-- Registered here (each read with the registry fetcher on 2026-10-29 and every
-- excerpt verified with scripts/verify-excerpts.ts --require-readable):
--
--   documents     forms-documents.html (work permit from outside Canada:
--                 forms and documents), page dated 2026-07-17. "all
--                 applicants need to include: ... a photocopy of your valid
--                 (not expired) passport or travel document 1 photo ..."; the
--                 employer-specific, LMIA-required and LMIA-exempt document
--                 lists; proof of present immigration status.
--   application   guide 5487 (Applying for a work permit outside Canada),
--                 page dated 2026-10-06: the medical-exam triggers (stay over
--                 six months and a listed country; a designated occupation;
--                 agricultural work) and the $100 open work permit holder fee.
--   forms         IMM 5645 form page, dated 2024-06-21: "this form must be
--                 completed by each person, 18 years of age or older,
--                 applying for a temporary resident visa, a study or work
--                 permit outside canada."
--   requirements  IRCC's medical-exam country table for temporary residents,
--                 dated 2026-07-16 (already registered for ca-study-permit by
--                 20261020140000; sources are per visa type, so it is
--                 registered again here).
--   documents     open work permits for family members of foreign workers,
--                 how to apply, dated 2026-05-28: proof of relationship, the
--                 worker's permit and the worker's occupation.
--
-- The eligibility page (work-canada/permit-outside/eligibility.html) is
-- already registered for ca-work-permit by 20260821200000 and has an active
-- version; v2 is the first extraction to cite it.
--
-- ORDER (each step depends on the previous):
--   1. probe the five URLs FROM THE VPS (canada.ca must answer the VPS, not
--      just a laptop) -- apps/api/scripts/probe-authority.ts
--   2. this file
--   3. run the registry sync ON THE VPS so the new sources get an active
--      version (apps/api/scripts/visa-sync-run.ts) -- the requirement
--      migration binds to those versions and refuses to run without them
--   4. 20261029120100_req_ca_work_permit_v2.sql +
--      20261029120200_promote_ca_work_permit_v2.sql
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
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit-outside/forms-documents.html',
   'Work permit: applying from outside Canada – forms and documents'),
  ('application',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/guide-5487-applying-work-permit-outside-canada.html',
   'Guide 5487 – Applying for a work permit outside Canada'),
  ('forms',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5645.html',
   'Family Information Form – Visitors, Students and Workers (IMM 5645)'),
  ('requirements',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/medical-police/medical-exams/requirements-temporary-residents/country-requirements.html',
   'Medical exam requirements for temporary residents: countries and territories where an IME is required'),
  ('documents',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/special-instructions/spouses-dependent-children/apply.html',
   'Open work permits for family members of foreign workers: how to apply')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'ca-work-permit'
join public.visa_countries c on c.id = t.country_id and c.code = 'CA'
on conflict do nothing;

do $$
declare n int; total int;
begin
  select count(*) filter (where s.source_url in (
           'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit-outside/forms-documents.html',
           'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/guide-5487-applying-work-permit-outside-canada.html',
           'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5645.html',
           'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/medical-police/medical-exams/requirements-temporary-residents/country-requirements.html',
           'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/special-instructions/spouses-dependent-children/apply.html')),
         count(*)
    into n, total
  from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'ca-work-permit' and s.active;
  if n <> 5 then raise exception 'Expected the 5 new IRCC sources active for ca-work-permit, found %.', n; end if;
  if total <> 10 then raise exception 'Expected 10 active IRCC sources for ca-work-permit, found %.', total; end if;
end $$;
