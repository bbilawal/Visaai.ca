-- =====================================================================
-- Phase 4B — AUDIT TAXONOMY AMENDMENT  audit_event_type += LEGACY_AUTOMATION_BLOCKED
-- Author: Backend (Bypass Elimination)   Date: 2026-06-07
--
-- Emitted (audit-only, non-mutating) when a legacy socket-fill execution attempt
-- is blocked because LEGACY_AUTOMATION_WRITE_ENABLED is off (default). Records
-- the deprecation event without performing any DOM write. Idempotent.
-- =====================================================================

alter type audit_event_type add value if not exists 'LEGACY_AUTOMATION_BLOCKED';

-- ROLLBACK: Postgres cannot remove enum values. Forward-fix only.
