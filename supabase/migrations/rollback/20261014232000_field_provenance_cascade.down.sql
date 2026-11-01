-- Rollback for AUDIT-006c: restore ON DELETE SET NULL.
-- NOTE: this brings back the document-delete failure for OCR provenance.

alter table public.field_provenance
  drop constraint if exists field_provenance_ocr_run_id_fkey,
  drop constraint if exists field_provenance_source_document_id_fkey;

alter table public.field_provenance
  add constraint field_provenance_ocr_run_id_fkey
    foreign key (ocr_run_id) references public.ocr_runs (id) on delete set null,
  add constraint field_provenance_source_document_id_fkey
    foreign key (source_document_id) references public.documents (id) on delete set null;
