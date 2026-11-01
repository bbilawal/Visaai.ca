-- Promote the work permit checklist (v2).
-- Date: 2026-10-29
--
-- Apply IMMEDIATELY after 20261029120100_req_ca_work_permit_v2.sql. That file
-- inserts 21 new rows as 'draft' (the application checklist reads only
-- 'active' rows), demotes the two LMIA rows it re-gates to 'draft', and
-- re-upserts the other 12 existing rows unchanged (imm5476 carries the
-- description 20261015181000 wrote), so none of those is demoted.
--
-- WHAT WAS WRONG, AND WHAT THIS APPROVES
--
-- Measured against IRCC's forms-and-documents page for a work permit made
-- outside Canada (dated 2026-07-17), guide 5487 (2026-10-06), the IMM 5645
-- page, the eligibility page, the family open work permit page and the
-- medical-exam country table, all read 2026-10-29:
--
--   lmia_and_employment_contract   Had no rule: every applicant, the spouse
--   (evidence, RE-GATED)           on an open permit included, was asked for
--                                  an LMIA. Rule: work_permit_type = lmia
--                                  (SAWP counts as lmia). IMM 1295: "if you
--                                  need an lmia to get a work permit ...
--                                  attach original employment contract and
--                                  lmia."
--   lmia_or_offer_of_employment_   Had no rule. Rule: work_permit_type in
--   number (evidence, RE-GATED)    [lmia, lmia_exempt]: an open permit has
--                                  neither number.
--   passport_copy, passport_photos "all applicants need to include".
--   job_offer_letter               work_permit_type = lmia.
--   quebec_acceptance_certificate  lmia AND works_in_quebec AND stay > 30
--                                  days ("if you plan to work a paid job in
--                                  quebec for more than 30 days").
--   employment_contract_lmia_      work_permit_type = lmia_exempt (the LMIA
--   exempt                         contract stays on the LMIA row).
--   current_employer_letter,       work_permit_type in [lmia, lmia_exempt]:
--   past_employer_reference_       "if you're applying for an employer-
--   letters, proof_of_past_work_   specific work permit ... you'll always be
--   experience, proof_of_job_      asked to include the following documents"
--   requirements, resume
--   proof_of_relationship_to_      work_permit_type = open AND
--   principal, principal_work_     open_permit_principal = worker (the page
--   permit_copy, principal_        read is for family of foreign workers).
--   occupation_letter
--   proof_of_medical_exam          may_follow_application. any of: stay >
--                                  183 days AND residence in IRCC's IME list
--                                  (121 ISO codes, the study permit's list,
--                                  page unchanged since 2026-07-16); stay >
--                                  183 AND a yes to 6+ months in a listed
--                                  country; a public-health job; agricultural
--                                  work AND a listed country.
--   proof_of_status_in_residence_  resident_non_citizen = true.
--   country
--   imm5645 (form)                 age >= 18.
--   open_work_permit_holder_fee    work_permit_type = open, CAD 100.
--   enough_money_for_stay,         conditions from the eligibility page.
--   will_leave_canada,
--   police_certificate_if_asked
--   ime_country_of_residence       the residence rule as a condition bound to
--                                  the country table, so a change to the list
--                                  reaches the sync's change queue.
--
-- Unchanged: marriage_certificate_copy keeps marital_status in [married]
-- (IMM 1295: "if you are married, you must send a photocopy of your marriage
-- licence or certificate with your application"); imm5409 keeps the
-- common-law rule; the fees keep their 2026-08-21 figures ($155 work permit,
-- $85 biometrics).
--
-- Every excerpt was re-checked against the live pages on 2026-10-29 with
-- apps/api/scripts/verify-excerpts.ts --require-readable (35/35 verbatim),
-- verify-quotes-against-raw.ts (35/35) and check-excerpt-shape.ts
-- (0 rejected); display excerpts derived with derive-display-excerpts.ts.
--
-- Apply (not applied by this PR):
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Rollback: rollback/20261029120200_ca_work_permit_v2.down.sql

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-10-29'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-work-permit'
  and r.status = 'draft';

do $$
declare bad int;
begin
  select count(*) into bad from public.visa_requirements
  where status = 'active'
    and (source_version_id is null or source_excerpt is null or source_excerpt = ''
         or (kind = 'recommended' and officially_required));
  if bad > 0 then raise exception '% active requirement(s) lack provenance.', bad; end if;
end $$;

do $$
declare docs int; forms int; conditions int; fees int; total int; ok_lmia int; ok_marriage int;
begin
  select count(*) filter (where r.kind = 'evidence'),
         count(*) filter (where r.kind = 'form'),
         count(*) filter (where r.kind = 'condition'),
         count(*) filter (where r.kind = 'fee'),
         count(*),
         count(*) filter (where r.requirement_code = 'lmia_and_employment_contract'
                            and r.rule = '{"fact": "work_permit_type", "op": "eq", "value": "lmia"}'::jsonb),
         count(*) filter (where r.requirement_code = 'marriage_certificate_copy'
                            and r.rule = '{"fact": "marital_status", "op": "in", "value": ["married"]}'::jsonb)
    into docs, forms, conditions, fees, total, ok_lmia, ok_marriage
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-work-permit' and r.status = 'active';
  if total <> 35 then raise exception 'Expected 35 active work permit requirements, found %.', total; end if;
  if docs <> 18 then raise exception 'Expected 18 work permit documents, found %.', docs; end if;
  if forms <> 4 then raise exception 'Expected 4 work permit forms, found %.', forms; end if;
  if conditions <> 7 then raise exception 'Expected 7 work permit conditions, found %.', conditions; end if;
  if fees <> 3 then raise exception 'Expected 3 work permit fees, found %.', fees; end if;
  if ok_lmia <> 1 then raise exception 'lmia_and_employment_contract is not gated on an LMIA permit.'; end if;
  if ok_marriage <> 1 then raise exception 'marriage_certificate_copy no longer asks every married applicant.'; end if;
end $$;
