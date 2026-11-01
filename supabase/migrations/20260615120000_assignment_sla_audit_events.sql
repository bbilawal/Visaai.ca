-- =====================================================================
-- Assignment SLA — new audit event types for the review-deadline lifecycle.
-- Author: assignment-sla   Date: 2026-06-15
-- Depends on: enum public.audit_event_type
--
-- ALTER TYPE ... ADD VALUE cannot reference the new value in the SAME
-- transaction. The new values are CONSUMED only by later code, never within
-- this file. Idempotent (PG 12+ IF NOT EXISTS). Forward-only by design.
-- =====================================================================

alter type public.audit_event_type add value if not exists 'CONSULTANT_COMPLETED';
alter type public.audit_event_type add value if not exists 'CONSULTANT_DEADLINE_CHANGED';
alter type public.audit_event_type add value if not exists 'CONSULTANT_ASSIGNMENT_EXPIRED';

-- ROLLBACK: Postgres cannot remove enum values; forward-only (see prior
-- audit-taxonomy amendment migrations).
