-- =====================================================================
-- Gate 2 — AUDIT TAXONOMY AMENDMENT  audit_event_type += request signals
-- Author: Backend (Execution Request Gate)   Date: 2026-06-07
--
-- Phase 3F backend gate emits, on a validated request:
--   READBACK_CONFIRMED  — user confirmed the readback side-by-side (optional)
--   EXECUTION_REQUESTED — gate passed revalidation (NOT execution start)
-- Both distinct from EXECUTION_STARTED (no execution occurs in this layer).
-- Idempotent; PG12+ ADD VALUE IF NOT EXISTS.
-- =====================================================================

alter type audit_event_type add value if not exists 'READBACK_CONFIRMED';
alter type audit_event_type add value if not exists 'EXECUTION_REQUESTED';

-- =====================================================================
-- ROLLBACK: Postgres cannot remove enum values. Forward-fix only.
-- =====================================================================
