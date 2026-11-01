-- Promote the study permit checklist alignment (v2).
-- Date: 2026-10-20
--
-- Apply IMMEDIATELY after 20261020140100_req_ca_study_permit_v2.sql. That file
-- inserts 3 new rows as 'draft' (the application checklist reads only 'active'
-- rows) and re-upserts the 23 existing rows unchanged (imm5476 carries the
-- description 20261015181000 wrote), so none of them is demoted.
--
-- WHAT WAS WRONG, AND WHAT THIS APPROVES
--
-- Measured against IRCC's personalised checklist, recorded live in the IRCC
-- secure account on 2026-10-20 for a Pakistani resident, married, spouse not
-- coming to Canada, Ontario PAL:
--
--   imm5645 (form, NEW)        IRCC requires Family Information (IMM 5645);
--                              VisaAI listed no family form at all.
--                              Rule: age >= 18. imm5645.html: "this form must
--                              be completed by each person, 18 years of age or
--                              older, applying for a temporary resident visa, a
--                              study or work permit outside canada."
--   proof_of_medical_exam      IRCC requires "Request for Medical Exam"; VisaAI
--   (evidence, NEW)            had only the 'check if needed' step, which is
--                              never a document slot. Rule: stay_duration_days
--                              > 183 AND residence_country in IRCC's IME
--                              country list (121 ISO codes from the 128 'yes'
--                              rows of country-requirements.html, dated
--                              2026-07-16). Guide 5269: "you will need a medical
--                              exam if you: have lived temporarily for six or
--                              more months in a row: in any of these countries
--                              or territories in the one year immediately before
--                              the date you want to enter canada. ... if you
--                              have an upfront medical exam, you must submit
--                              proof that you completed the medical exam with
--                              your application." parameters.may_follow_application
--                              = true: the guide also allows waiting for the
--                              visa office's instructions, so the slot never
--                              blocks preparing the forms (as for the super visa).
--   ime_country_of_residence   The same rule as a condition, quoting the
--   (condition, NEW)           country table itself, so the list the rule
--                              carries is bound to a synced version of the page
--                              it was read from and a change to the list
--                              reaches the sync's change queue.
--
-- Unchanged: marriage_certificate_copy keeps rule marital_status in
-- [married]. IMM 1294's instructions (Q10, page dated 2026-10-06) ask it of
-- every married applicant: "if you are married, you must send a photocopy of
-- your marriage licence or certificate with your application." The official
-- instructions win over the personalised checklist, which did not list it for
-- a spouse who is not coming.
--
-- Every excerpt was re-checked against the live pages on 2026-10-20 with
-- apps/api/scripts/verify-excerpts.ts --require-readable (26/26 verbatim),
-- verify-quotes-against-raw.ts (26/26) and check-excerpt-shape.ts
-- (0 rejected); display excerpts derived with derive-display-excerpts.ts.
--
-- Apply (not applied by this PR):
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Rollback: rollback/20261020140200_ca_study_permit_v2.down.sql

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-10-20'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-study-permit'
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
declare docs int; forms int; conditions int; total int; ok_marriage int; ok_new int;
begin
  select count(*) filter (where r.kind = 'evidence'),
         count(*) filter (where r.kind = 'form'),
         count(*) filter (where r.kind = 'condition'),
         count(*),
         count(*) filter (where r.requirement_code = 'marriage_certificate_copy'
                            and r.rule = '{"fact": "marital_status", "op": "in", "value": ["married"]}'::jsonb),
         count(*) filter (where r.requirement_code in
                            ('imm5645', 'proof_of_medical_exam', 'ime_country_of_residence'))
    into docs, forms, conditions, total, ok_marriage, ok_new
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-study-permit' and r.status = 'active';
  if total <> 26 then raise exception 'Expected 26 active study permit requirements, found %.', total; end if;
  if docs <> 8 then raise exception 'Expected 8 study permit documents, found %.', docs; end if;
  if forms <> 4 then raise exception 'Expected 4 study permit forms, found %.', forms; end if;
  if conditions <> 6 then raise exception 'Expected 6 study permit conditions, found %.', conditions; end if;
  if ok_marriage <> 1 then raise exception 'marriage_certificate_copy no longer asks every married applicant.'; end if;
  if ok_new <> 3 then raise exception 'Expected imm5645, proof_of_medical_exam and ime_country_of_residence active, found %.', ok_new; end if;
end $$;
