-- =====================================================================
-- Phase 7G — AUDIT TAXONOMY AMENDMENT  audit_event_type += portal-fill events
-- Author: Backend (Portal-Fill Orchestrator)   Date: 2026-06-07
--
-- The orchestration loop emits these (after EXECUTION_STARTED). Distinct from
-- EXECUTION_STARTED (authority, ExecutionService) and submit (which never
-- happens). Idempotent; PG12+ ADD VALUE IF NOT EXISTS.
-- =====================================================================

alter type audit_event_type add value if not exists 'PORTAL_FILL_STARTED';
alter type audit_event_type add value if not exists 'FIELD_WRITE_ATTEMPT';
alter type audit_event_type add value if not exists 'READBACK_COMPARE';
alter type audit_event_type add value if not exists 'FIELD_VERIFIED';
alter type audit_event_type add value if not exists 'PORTAL_FILL_COMPLETED';

-- ROLLBACK: Postgres cannot remove enum values. Forward-fix only.
