-- =====================================================================
-- Gate 2 — AUDIT TAXONOMY AMENDMENT  audit_event_type += 'EXECUTION_READY'
-- Author: Backend (Eligibility)   Date: 2026-06-06
--
-- ExecutionEligibilityService emits EXECUTION_READY when all four predicates
-- pass (the final compliance gate). It is distinct from EXECUTION_STARTED
-- (eligibility is read-only and does NOT start execution). Idempotent; PG12+
-- ADD VALUE IF NOT EXISTS (value added here, not used in this migration).
--
-- Ordering note: declared after PREFLIGHT_COMPLETED / before EXECUTION_STARTED
-- in the TS union for readability; enum value position in PG does not affect the
-- audit hash chain (the chain hashes the text value, not its ordinal).
-- =====================================================================

alter type audit_event_type add value if not exists 'EXECUTION_READY';

-- =====================================================================
-- ROLLBACK:
--   Postgres cannot remove an enum value. Forward-fix only: stop emitting
--   'EXECUTION_READY' at the application layer if reverting.
-- =====================================================================
