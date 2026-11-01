-- Unique constraint so concurrent document graph runs can upsert cross-verification
-- results idempotently instead of racing on delete-then-insert.
alter table public.cross_verifications
  add constraint cross_verifications_unique_pair_field
  unique (application_id, doc_a_id, doc_b_id, field_compared);
