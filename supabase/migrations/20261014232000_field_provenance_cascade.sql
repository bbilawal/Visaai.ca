-- AUDIT-006c: the last thing blocking a document delete. Owner-approved
-- (option a, 2026-10-15): provenance goes with the evidence it points at.
--
-- Deleting a document cascades to its ocr_runs, and field_provenance.ocr_run_id
-- was ON DELETE SET NULL. For OCR-origin provenance that NULL violates the
-- table's own invariant, so every document that had produced OCR provenance
-- was undeletable:
--
--   DELETE /documents/item/:id -> 500
--   violates check constraint "field_provenance_ocr_requires_run"
--
-- Provenance that says "this value came from document X / OCR run Y" is false
-- once X and Y are deleted. Intake, inferred and user-entered provenance never
-- reference a document or run and are untouched. superseded_by (SET NULL,
-- deferred) keeps a chain consistent when a member is removed.

alter table public.field_provenance
  drop constraint if exists field_provenance_ocr_run_id_fkey,
  drop constraint if exists field_provenance_source_document_id_fkey;

alter table public.field_provenance
  add constraint field_provenance_ocr_run_id_fkey
    foreign key (ocr_run_id) references public.ocr_runs (id) on delete cascade,
  add constraint field_provenance_source_document_id_fkey
    foreign key (source_document_id) references public.documents (id) on delete cascade;
