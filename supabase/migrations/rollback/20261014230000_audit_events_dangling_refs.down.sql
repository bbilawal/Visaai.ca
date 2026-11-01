-- Rollback for AUDIT-006: restore the original foreign keys.
-- `not valid` because audit_events may by now reference deleted rows, and the
-- append-only log cannot be rewritten to fix them.
-- NOTE: restoring these brings back the delete failure the migration fixed.

alter table public.audit_events
  add constraint audit_events_document_id_fkey
    foreign key (document_id) references public.documents on delete set null not valid,
  add constraint audit_events_ocr_run_id_fkey
    foreign key (ocr_run_id) references public.ocr_runs on delete set null not valid,
  add constraint audit_events_submission_session_id_fkey
    foreign key (submission_session_id) references public.submission_sessions on delete set null not valid,
  add constraint audit_events_actor_id_fkey
    foreign key (actor_id) references public.users on delete set null not valid;
