-- Rollback of 20261016190000_generated_documents_invitation_letter.sql.
-- Invitation letters must be removed first or the narrower constraint fails.
delete from public.generated_documents where doc_type = 'invitation_letter';

alter table public.generated_documents
  drop constraint if exists generated_documents_doc_type_check;

alter table public.generated_documents
  add constraint generated_documents_doc_type_check
  check (doc_type in ('loe','itinerary','cover_letter','prefilled_form_json'));
