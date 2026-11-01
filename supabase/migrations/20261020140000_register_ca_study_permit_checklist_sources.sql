-- Register three IRCC pages for ca-study-permit, so its checklist can carry the
-- Family Information form and the medical exam IRCC's own checklist asks for.
-- Date: 2026-10-20
--
-- WHY
--
-- IRCC's personalised study permit checklist, recorded live in the IRCC secure
-- account on 2026-10-20 (Pakistani resident, married, spouse NOT coming to
-- Canada, Ontario PAL), REQUIRES:
--   IMM 1294; passport; letter of acceptance (or enrolment); PAL/TAL; proof of
--   means of financial support; digital photo; Request for Medical Exam;
--   Family Information (IMM 5645)
-- and offers as OPTIONAL: IMM 5257 Schedule 1; Client Information.
--
-- VisaAI's registry checklist for the same applicant had no IMM 5645 and no
-- medical exam upload (only an unconditional 'check if needed' step that never
-- reaches the document list). The registered sources could not carry the
-- missing rows: none of the
-- six names IMM 5645, and the documents page states the medical triggers only
-- as "you may need".
--
-- Registered here (each read with the registry fetcher on 2026-10-20 and every
-- excerpt verified with scripts/verify-excerpts.ts --require-readable):
--
--   application  guide 5269 (Applying for a study permit outside Canada),
--                page dated 2026-10-06:
--                "if you plan to work, visit or study in canada for more than
--                 six months: you will need a medical exam if you: have lived
--                 temporarily for six or more months in a row: in any of these
--                 countries or territories in the one year immediately before
--                 the date you want to enter canada."
--   forms        IMM 5645 form page, dated 2024-06-21:
--                "this form must be completed by each person, 18 years of age
--                 or older, applying for a temporary resident visa, a study or
--                 work permit outside canada."
--   requirements IRCC's medical-exam country table for temporary residents,
--                dated 2026-07-16 (the list the medical rule's country codes
--                are read from; registering it lets the sync flag a change
--                to the list).
--
-- ORDER (each step depends on the previous):
--   1. probe the three URLs FROM THE VPS (canada.ca must answer the VPS, not
--      just a laptop) -- apps/api/scripts/probe-authority.ts
--   2. this file
--   3. run the registry sync ON THE VPS so the new sources get an active
--      version (apps/api/scripts/visa-sync-run.ts) -- the requirement
--      migration binds to those versions and refuses to run without them
--   4. 20261020140100_req_ca_study_permit_v2.sql +
--      20261020140200_promote_ca_study_permit_v2.sql
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
  ('application',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/guide-5269-applying-study-permit-outside-canada.html',
   'Guide 5269 – Applying for a study permit outside Canada'),
  ('forms',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5645.html',
   'Family Information Form – Visitors, Students and Workers (IMM 5645)'),
  ('requirements',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/medical-police/medical-exams/requirements-temporary-residents/country-requirements.html',
   'Medical exam requirements for temporary residents: countries and territories where an IME is required')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'ca-study-permit'
join public.visa_countries c on c.id = t.country_id and c.code = 'CA'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'ca-study-permit' and s.active;
  if n <> 9 then raise exception 'Expected 9 active IRCC sources for ca-study-permit, found %.', n; end if;
end $$;
