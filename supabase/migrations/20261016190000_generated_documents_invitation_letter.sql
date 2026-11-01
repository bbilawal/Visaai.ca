-- Super visa: the Generate step can now draft the host's letter of invitation.
--
-- IRCC makes the host's signed letter of invitation mandatory for a Parent and
-- Grandparent Super Visa and prescribes its content (promise of financial
-- support, household list with names and dates of birth, income against the
-- minimum necessary income). The letters were limited to loe / itinerary /
-- cover_letter, so the one letter the route requires could not be stored.
--
-- Additive: widens the allowed doc_type values; no existing row changes.
alter table public.generated_documents
  drop constraint if exists generated_documents_doc_type_check;

alter table public.generated_documents
  add constraint generated_documents_doc_type_check
  check (doc_type in ('loe','itinerary','cover_letter','invitation_letter','prefilled_form_json'));
