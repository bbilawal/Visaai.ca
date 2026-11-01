-- AUDIT-006: documents (and users / OCR runs / submission sessions) could never
-- be deleted once an audit event referenced them.
--
-- audit_events is append-only: audit_events_no_update / _no_delete raise on any
-- UPDATE or DELETE. Four of its foreign keys were declared `on delete set null`,
-- so deleting a referenced row makes Postgres issue an UPDATE on audit_events,
-- which the guard rejects, aborting the delete:
--
--   DELETE /documents/item/:id -> 500
--   "audit_events is append-only: UPDATE not permitted"   (prod, 2026-10-14)
--
-- Nulling the column would be wrong even if it were allowed: row_hash /
-- prev_hash chain over the original values, so rewriting a reference would
-- break chain verification. An audit log keeps the id of what it describes
-- after that thing is gone. So the constraints go and the columns stay as
-- plain historical references (their indexes are unchanged). No audit row is
-- modified or removed by this migration.
--
-- application_id (`on delete cascade`) is deliberately untouched: whether an
-- application may ever be hard-deleted is a retention decision, not this fix.

alter table public.audit_events
  drop constraint if exists audit_events_document_id_fkey,
  drop constraint if exists audit_events_ocr_run_id_fkey,
  drop constraint if exists audit_events_submission_session_id_fkey,
  drop constraint if exists audit_events_actor_id_fkey;

comment on column public.audit_events.document_id is
  'Historical reference, no FK (AUDIT-006): the document may be deleted without rewriting the hash chain.';
comment on column public.audit_events.actor_id is
  'Historical reference, no FK (AUDIT-006).';
