-- Append-only tables must survive a cascade, not block it.
--
-- FOUND IN PRODUCTION 2026-08-13, while cleaning up an end-to-end test:
--
--   DELETE FROM auth.users …
--   ERROR: audit_events is append-only: DELETE not permitted
--   CONTEXT: SQL statement "DELETE FROM ONLY public.audit_events WHERE $1 = application_id"
--
-- Two correct controls that contradict each other:
--
--   1. `audit_events` carries BEFORE DELETE/UPDATE triggers (audit_no_mutate)
--      so an audit trail cannot be rewritten or erased. Right.
--   2. `audit_events.application_id` references applications ON DELETE CASCADE,
--      so deleting an application ASKS Postgres to delete audit rows. Wrong —
--      it is the one operation the table forbids.
--
-- The result is that no application, and therefore no user, can be deleted at
-- all. That is not a tidiness problem:
--
--   * privacy.service.ts implements GDPR Art. 17 erasure by deleting the auth
--     identity and letting `public.users.id references auth.users on delete
--     cascade` propagate. Its own doc comment describes exactly this design.
--     MEASURED: it fails with "Database error deleting user" (500). VisaAI
--     cannot honour a right-to-erasure request.
--   * The same wall blocks any admin hard-delete and any operational cleanup.
--
-- THE FIX, AND WHY SET NULL RATHER THAN THE ALTERNATIVES
--
-- `audit_events.actor_id` ALREADY uses ON DELETE SET NULL, and the privacy
-- service documents that as the intended shape: "Rows referenced with ON DELETE
-- SET NULL (analytics/ai-usage/audit 'by' fields) are anonymised rather than
-- removed — the correct GDPR outcome for records that must survive for
-- financial/audit integrity." The application link simply never got the same
-- treatment. This makes it consistent.
--
-- Rejected alternatives:
--   * Letting the trigger permit a cascading delete. A trigger cannot reliably
--     distinguish a cascade from a crafted `DELETE FROM applications`, so this
--     would hand anyone who can delete an application a way to erase the audit
--     trail that proves what they did. That is the exact attack append-only
--     exists to stop.
--   * RESTRICT on the FK. Honest, but it leaves erasure impossible, so the
--     product still cannot comply with Art. 17.
--
-- ORPHANED ROWS STAY INVISIBLE TO USERS. Every RLS policy involved resolves the
-- owner THROUGH the parent (`auth.uid() = (select user_id from applications
-- where id = …)`). With a NULL link that subquery yields no row, the comparison
-- is NULL, and the row is readable only by the service role — which is the
-- correct end state for a record whose subject has been erased.

-- ---------------------------------------------------------------------------
-- audit_events — the one that fired
-- ---------------------------------------------------------------------------

alter table public.audit_events
  alter column application_id drop not null;

alter table public.audit_events
  drop constraint audit_events_application_id_fkey;

alter table public.audit_events
  add constraint audit_events_application_id_fkey
  foreign key (application_id) references public.applications(id)
  on delete set null;

comment on column public.audit_events.application_id is
  'Null once the application has been deleted (GDPR erasure). The audit row '
  'itself is retained — this table is append-only — and becomes invisible to '
  'every non-service role because the owner is resolved through this link.';

-- ---------------------------------------------------------------------------
-- evidence_packages — same defect, not yet hit only because no one had
-- deleted an application that had one
-- ---------------------------------------------------------------------------

alter table public.evidence_packages
  alter column application_id drop not null;

alter table public.evidence_packages
  drop constraint evidence_packages_application_id_fkey;

alter table public.evidence_packages
  add constraint evidence_packages_application_id_fkey
  foreign key (application_id) references public.applications(id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- reconciliation_exceptions — same shape, financial rather than applicant
-- data: deleting a reconciliation run would have been refused the same way
-- ---------------------------------------------------------------------------

alter table public.reconciliation_exceptions
  alter column run_id drop not null;

alter table public.reconciliation_exceptions
  drop constraint reconciliation_exceptions_run_id_fkey;

alter table public.reconciliation_exceptions
  add constraint reconciliation_exceptions_run_id_fkey
  foreign key (run_id) references public.reconciliation_runs(id)
  on delete set null;
