-- Promote the spousal sponsorship documents and forms (v2).
-- Date: 2026-10-19
--
-- Apply IMMEDIATELY after 20261019220100_req_ca_sponsor_your_spouse_partner_or_child_v2.sql.
-- That file inserts 15 new rows as 'draft' (the application checklist reads
-- only 'active' rows) and re-upserts the 23 existing rows unchanged, so none
-- of them is demoted.
--
-- WHAT WAS WRONG, AND WHAT THIS APPROVES
--
-- The route's only document rows were the photo and the fee receipt, and its
-- only forms IMM 1344 and IMM 5476. With `checklistSupplement: false` on the
-- program, the applicant's checklist had no passport, marriage certificate,
-- birth certificate, police certificate or sponsor status slot at all.
--
-- Eleven `evidence` rows and four `form` rows, each quoted from a readable
-- IRCC page. IRCC's spouse checklist (IMM 5533, 09-2022) is an encrypted XFA
-- PDF the sync cannot store (see 20261019220000), so the quotes come from the
-- Complete Guide (IMM 5289, role `documents`), the eligibility page and the
-- IMM 1344 instructions; descriptions that cite IMM 5533 were transcribed
-- from the PDF's form text.
--
--   required, applicant:
--     passport               guide: "carefully review the checklist sections on
--                            identity documents, travel documents, and passports."
--     birth_certificate      guide: "make sure you submit a copy of your birth
--                            certificate ..."
--     police_clearance       guide: "you must provide a valid police certificate
--                            for any country other than canada ..."
--   required, applicant, gated by marital_status (unknown -> "may be required"):
--     marriage_certificate   = 'married'    guide: "for spousal sponsorships, make
--                            sure you include a valid marriage certificate ..."
--     common_law_relationship_proof = 'common_law'  guide: "to show that you are
--                            in a common-law relationship, submit proof that you: ..."
--   required, sponsor (parameters.document_owner = 'sponsor'):
--     proof_of_status        eligibility: "are a canadian citizen, a permanent
--                            resident of canada, or a person registered in canada
--                            under the canadian indian act". The quote is the
--                            condition the document proves; IMM 5533's list of
--                            accepted documents is in the description.
--   optional (officially_required = false; no rule fact exists for the trigger):
--     conjugal_relationship_proof, relationship_evidence (applicant)
--     sponsor_residence_proof, sponsor_previous_relationship_proof,
--     children_citizenship_proof (sponsor)
--   forms: imm0008, imm5669, imm5406, imm5532 (guide)
--
-- Every excerpt was re-checked against the live pages on 2026-10-19 with
-- scripts/verify-excerpts.ts --require-readable (38/38 verbatim),
-- scripts/verify-quotes-against-raw.ts (38/38) and scripts/check-excerpt-shape.ts
-- (0 rejected); display excerpts checked with scripts/derive-display-excerpts.ts --check.
--
-- Apply (not applied by this PR):
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Rollback: rollback/20261019220200_ca_sponsor_your_spouse_partner_or_child_v2.down.sql

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-10-19'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-sponsor-your-spouse-partner-or-child'
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
declare docs int; required_docs int; sponsor_docs int; forms int; total int;
begin
  select count(*) filter (where r.kind = 'evidence'),
         count(*) filter (where r.kind = 'evidence' and r.officially_required),
         count(*) filter (where r.kind = 'evidence' and r.parameters->>'document_owner' = 'sponsor'),
         count(*) filter (where r.kind = 'form'),
         count(*)
    into docs, required_docs, sponsor_docs, forms, total
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-sponsor-your-spouse-partner-or-child' and r.status = 'active';
  if total <> 38 then raise exception 'Expected 38 active spousal requirements, found %.', total; end if;
  if docs <> 13 then raise exception 'Expected 13 spousal documents, found %.', docs; end if;
  if required_docs <> 8 then raise exception 'Expected 8 required spousal documents, found %.', required_docs; end if;
  if sponsor_docs <> 4 then raise exception 'Expected 4 sponsor documents, found %.', sponsor_docs; end if;
  if forms <> 6 then raise exception 'Expected 6 spousal forms, found %.', forms; end if;
end $$;
