-- AUDIT-006b: document delete was still blocked after the audit_events fix.
--
-- cross_verifications.doc_a_id / doc_b_id were declared in the initial schema
-- with no ON DELETE action, so deleting any document that had ever been
-- cross-checked failed:
--
--   DELETE /documents/item/:id -> 500
--   violates foreign key constraint "cross_verifications_doc_b_id_fkey"
--
-- A cross-check between two documents means nothing once either is gone (the
-- documents graph already deletes stale pairs itself), so the rows go with it.
-- Every other table referencing documents already cascades or sets null.

alter table public.cross_verifications
  drop constraint if exists cross_verifications_doc_a_id_fkey,
  drop constraint if exists cross_verifications_doc_b_id_fkey;

alter table public.cross_verifications
  add constraint cross_verifications_doc_a_id_fkey
    foreign key (doc_a_id) references public.documents (id) on delete cascade,
  add constraint cross_verifications_doc_b_id_fkey
    foreign key (doc_b_id) references public.documents (id) on delete cascade;
