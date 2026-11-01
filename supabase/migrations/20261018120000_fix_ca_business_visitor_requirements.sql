-- =====================================================================
-- Canada business visitors: stop asking for uploads nobody can supply.
-- Date: 2026-10-18  (registry audit of ca-business-visitors)
--
-- Source of truth: data/requirements/ca-business-visitors.json (kept in sync
-- by hand in the same PR, as 20261016120000_ca_eta_program.sql did; the
-- generator emits INSERTs for new extractions, and these rows already exist).
--
-- Every `evidence` row on this route was extracted with rule = null and
-- officially_required = true, and 20260821220000 promoted them. The checklist
-- (apps/api/src/modules/visa-rules/registry-to-framework.ts) turns each such
-- row into a REQUIRED upload, so an applicant filing IRCC's visitor visa
-- application got slots they could never satisfy, and the VRI documentation
-- dimension counted them as missing.
--
-- 1. evidence -> condition (not documents; a condition is never an upload):
--      same_passport_used_for_eta       eTA holders only; an IMM 5257
--                                       applicant has no eTA
--      visitor_visa_if_applicable       the visa this application obtains
--      host_24_hour_contact_details     typed data, not a document
--      proof_of_funds_at_border         border check; the obligation is
--                                       sufficient_funds_for_stay_and_return
--      two_original_invitation_letters  host instruction about physical
--                                       originals; the letter itself is
--                                       letters_of_support_and_invitation
--
-- 2. Rules on two documents that only some applicants need:
--      us_green_card_and_passport              us_lpr = true
--      warranty_service_or_contract_documents  business_activity =
--                                              'after_sales_service'
--    Both facts are in the closed vocabulary (rule.types.ts) and mapped in
--    profile-to-rule-facts.ts. Unanswered -> "may be required", optional.
--
--    invitation_letter_notarization was already a non-required condition.
--
-- 3. Checklist rows already built from (1) on business-visitor applications:
--    still-missing ones with no linked document are deleted (never
--    satisfiable); any row with a document linked -- uploaded, or reset to
--    'missing' by sync-checklist on a mismatch -- is made optional and left
--    for a human: the FILE is applicant data. Rows
--    from (2) that are still missing are made optional; the next checklist
--    rebuild applies the rule.
--
-- Status is left as is: the claims and quotes are unchanged, only how they
-- reach the checklist.
--
-- Data only. Idempotent.
-- Apply (not applied by this PR):
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Rollback: rollback/20261018120000_fix_ca_business_visitor_requirements.down.sql
-- =====================================================================

begin;

-- 1 ---------------------------------------------------------------------
update public.visa_requirements r
   set kind = 'condition',
       description = 'An instruction about WHICH passport to carry, for travellers who hold an eTA: the passport linked to the eTA is the one presented at entry. It is not a separate document, and an applicant filing a visitor visa application (IMM 5257) has no eTA, so it is never an upload slot.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-business-visitors'
   and r.requirement_code = 'same_passport_used_for_eta'
   and r.status <> 'retired';

update public.visa_requirements r
   set kind = 'condition',
       description = 'What a visa-required business visitor carries at entry: the visitor visa this application obtains. It cannot be uploaded with the application that produces it, so it is a condition, not an upload slot.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-business-visitors'
   and r.requirement_code = 'visitor_visa_if_applicable'
   and r.status <> 'retired';

update public.visa_requirements r
   set kind = 'condition',
       description = 'Typed details (name, phone number, email) of the Canadian business host, entered on the application form and carried at entry. It is information, not a document to upload.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-business-visitors'
   and r.requirement_code = 'host_24_hour_contact_details'
   and r.status <> 'retired';

update public.visa_requirements r
   set kind = 'condition',
       description = 'Checked by the border officer at entry. The obligation itself is recorded as sufficient_funds_for_stay_and_return; the documents that prove it are the applicant''s financial evidence, so this is not a second upload slot.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-business-visitors'
   and r.requirement_code = 'proof_of_funds_at_border'
   and r.status <> 'retired';

update public.visa_requirements r
   set kind = 'condition',
       description = 'IRCC addresses this page to the Canadian host company. It is an instruction to the host about how many ORIGINALS of the invitation letter to send — one submitted with the application, one carried at entry. The letter itself is the upload slot letters_of_support_and_invitation; an instruction about physical originals is not a second one.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-business-visitors'
   and r.requirement_code = 'two_original_invitation_letters'
   and r.status <> 'retired';

-- 2 ---------------------------------------------------------------------
update public.visa_requirements r
   set rule = '{"fact":"us_lpr","op":"eq","value":true}'::jsonb,
       description = 'Rule: applies only to lawful permanent residents of the United States (us_lpr, asked in the visitor interview as us_permanent_resident). Until that is answered the item shows as “may be required”; for anyone who answers no it does not apply.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-business-visitors'
   and r.requirement_code = 'us_green_card_and_passport'
   and r.status <> 'retired';

update public.visa_requirements r
   set rule = '{"fact":"business_activity","op":"eq","value":"after_sales_service"}'::jsonb,
       description = 'Rule: applies when the visit is after-sales service — installing, repairing or servicing equipment sold to a Canadian buyer — which is the activity these documents prove. Until the activity is known the item shows as “may be required”; for meetings, buying goods or training it does not apply.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-business-visitors'
   and r.requirement_code = 'warranty_service_or_contract_documents'
   and r.status <> 'retired';

-- 3 ---------------------------------------------------------------------
delete from public.checklist_items c
 using public.applications a, public.visa_types t
 where c.application_id = a.id
   and a.visa_type_id = t.id
   and t.visaai_id = 'ca-business-visitors'
   and c.document_type in ('same_passport_used_for_eta', 'visitor_visa_if_applicable',
                           'host_24_hour_contact_details', 'proof_of_funds_at_border',
                           'two_original_invitation_letters')
   and c.status = 'missing'
   -- documents.checklist_item_id references checklist_items with NO ACTION,
   -- and sync-checklist resets a mismatched slot to 'missing' while leaving
   -- its document linked. Deleting such a row would FK-fail the whole run;
   -- it is left for the required = false update below instead.
   and not exists (select 1 from public.documents d where d.checklist_item_id = c.id);

update public.checklist_items c
   set required = false
  from public.applications a, public.visa_types t
 where c.application_id = a.id
   and a.visa_type_id = t.id
   and t.visaai_id = 'ca-business-visitors'
   and c.document_type in ('same_passport_used_for_eta', 'visitor_visa_if_applicable',
                           'host_24_hour_contact_details', 'proof_of_funds_at_border',
                           'two_original_invitation_letters',
                           'us_green_card_and_passport',
                           'warranty_service_or_contract_documents')
   and c.required;

-- Guards ------------------------------------------------------------------
do $$
declare n_upload integer; n_rule integer; n_left integer;
begin
  select count(*) into n_upload from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ca-business-visitors'
     and r.requirement_code in ('same_passport_used_for_eta', 'visitor_visa_if_applicable',
                                'host_24_hour_contact_details', 'proof_of_funds_at_border',
                                'two_original_invitation_letters')
     and r.kind in ('evidence', 'recommended')
     and r.status <> 'retired';
  if n_upload <> 0 then
    raise exception 'business visitor non-documents still kinded as uploads: %', n_upload;
  end if;

  select count(*) into n_rule from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ca-business-visitors'
     and r.status <> 'retired'
     and ((r.requirement_code = 'us_green_card_and_passport'
           and r.rule = '{"fact":"us_lpr","op":"eq","value":true}'::jsonb)
       or (r.requirement_code = 'warranty_service_or_contract_documents'
           and r.rule->>'fact' = 'business_activity'));
  if n_rule <> 2 then
    raise exception 'Expected rules on the green-card and warranty rows, found %', n_rule;
  end if;

  -- Whatever survived the delete (a linked document blocks it) must no
  -- longer be a required slot.
  select count(*) into n_left from public.checklist_items c
    join public.applications a on a.id = c.application_id
    join public.visa_types t on t.id = a.visa_type_id
   where t.visaai_id = 'ca-business-visitors'
     and c.required
     and c.document_type in ('same_passport_used_for_eta', 'visitor_visa_if_applicable',
                             'host_24_hour_contact_details', 'proof_of_funds_at_border',
                             'two_original_invitation_letters',
                             'us_green_card_and_passport',
                             'warranty_service_or_contract_documents');
  if n_left <> 0 then
    raise exception '% business visitor checklist row(s) still required', n_left;
  end if;
end $$;

commit;
