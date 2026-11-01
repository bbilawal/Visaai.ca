-- =====================================================================
-- Audit event types for consultant assignment lifecycle (Scenario 9).
-- Author: Database Architect   Date: 2026-06-08
-- Depends on: enum public.audit_event_type
--
-- ALTER TYPE ... ADD VALUE cannot reference the new value in the SAME
-- transaction, and historically could not run inside a txn block at all.
-- Each value is added independently and idempotently (PG 12+ IF NOT EXISTS).
-- The new values are CONSUMED only by later code, never within this file.
-- =====================================================================

alter type public.audit_event_type add value if not exists 'CONSULTANT_SELF_ASSIGNED';
alter type public.audit_event_type add value if not exists 'CONSULTANT_ASSIGNED';
alter type public.audit_event_type add value if not exists 'CONSULTANT_REASSIGNED';
alter type public.audit_event_type add value if not exists 'CONSULTANT_UNASSIGNED';

-- Admin is the actor for admin-driven assign/reassign/unassign. The actor_role
-- enum had no 'admin' member; add it so the audit trail attributes the actor
-- correctly (admin vs consultant) rather than collapsing admin into 'system'.
alter type public.audit_actor_role add value if not exists 'admin';

-- ROLLBACK:
--   Postgres does not support removing enum values. To revert, recreate the
--   audit_event_type enum without these members and re-point the column
--   (heavy; only do this in a dev reset). Forward-only by design.
