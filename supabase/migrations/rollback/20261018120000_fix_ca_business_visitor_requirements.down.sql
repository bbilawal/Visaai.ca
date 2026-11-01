-- Rollback for 20261018120000_fix_ca_business_visitor_requirements.sql
-- Restores the business-visitor rows to their extracted state (evidence
-- kinds, no rules, original descriptions). Deleted checklist rows are NOT
-- restored: they were never satisfiable, and a rebuild recreates them from the
-- restored requirements if this is ever run.
begin;

update public.visa_requirements r
   set kind = 'evidence', description = null
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-business-visitors'
   and r.requirement_code in ('same_passport_used_for_eta', 'visitor_visa_if_applicable',
                              'host_24_hour_contact_details', 'proof_of_funds_at_border');

update public.visa_requirements r
   set kind = 'evidence',
       description = 'IRCC addresses this page to the Canadian host company. Only the parts that change what the visitor must carry are recorded here; the letter''s required contents are the host''s obligation, not an applicant upload.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-business-visitors'
   and r.requirement_code = 'two_original_invitation_letters';

update public.visa_requirements r
   set rule = null,
       description = 'Left unruled on purpose. VisaAI records a residence country, which is not the same thing as lawful permanent residence — someone can live in the US without a green card. Showing this item to everyone is the safe error; hiding it from a green-card holder is not.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-business-visitors'
   and r.requirement_code = 'us_green_card_and_passport';

update public.visa_requirements r
   set rule = null, description = null
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-business-visitors'
   and r.requirement_code = 'warranty_service_or_contract_documents';

commit;
