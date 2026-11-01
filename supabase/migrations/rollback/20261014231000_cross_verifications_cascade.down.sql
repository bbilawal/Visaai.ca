-- Rollback for AUDIT-006b: restore the original NO ACTION foreign keys.
-- NOTE: this brings back the document-delete failure.

alter table public.cross_verifications
  drop constraint if exists cross_verifications_doc_a_id_fkey,
  drop constraint if exists cross_verifications_doc_b_id_fkey;

alter table public.cross_verifications
  add constraint cross_verifications_doc_a_id_fkey
    foreign key (doc_a_id) references public.documents (id),
  add constraint cross_verifications_doc_b_id_fkey
    foreign key (doc_b_id) references public.documents (id);
