-- Hot-path foreign-key indexes (PERF — scale hardening).
--
-- The original schema (20260531000000_initial_schema.sql) declared these FK
-- columns with `references ...` but Postgres does NOT auto-index FK columns, so
-- every read filtered by application_id / user_id ran a sequential scan. Fine at
-- a few thousand rows, catastrophic at 100k+ (e.g. progress reads fire ~8 of
-- these per call). This adds the missing btree indexes.
--
-- Idempotent (IF NOT EXISTS). Built non-CONCURRENTLY: these tables are still
-- small pre-launch so the brief lock is acceptable, and CONCURRENTLY cannot run
-- inside a migration transaction. For future index additions on already-large
-- tables, apply CREATE INDEX CONCURRENTLY out-of-band instead.

create index if not exists checklist_items_application_idx
  on public.checklist_items (application_id);

create index if not exists documents_application_idx
  on public.documents (application_id);

create index if not exists cross_verifications_application_idx
  on public.cross_verifications (application_id);

create index if not exists vri_scores_application_idx
  on public.vri_scores (application_id);

create index if not exists generated_documents_application_idx
  on public.generated_documents (application_id);

create index if not exists submission_sessions_application_idx
  on public.submission_sessions (application_id);

create index if not exists post_submission_events_application_idx
  on public.post_submission_events (application_id);

create index if not exists payments_application_idx
  on public.payments (application_id);

create index if not exists payments_user_idx
  on public.payments (user_id);

-- applications.user_id backs "list my applications" and the RLS ownership check.
create index if not exists applications_user_idx
  on public.applications (user_id);
