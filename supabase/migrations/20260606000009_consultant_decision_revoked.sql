-- =====================================================================
-- Gate 2 — SCHEMA CORRECTNESS AMENDMENT  consultant_decision += 'revoked'
-- Author: Backend (Consultant)   Date: 2026-06-06
-- Classification: Schema Correctness Amendment (NOT a new feature).
--
-- Revocation is a first-class consultant action distinct from rejection
-- (withdrawing a previously GRANTED approval vs declining during review). The
-- consultant_approvals.decision enum needs a dedicated value so rollups and
-- evidence can tell the two apart. Idempotent; PG12+ allows ADD VALUE IF NOT
-- EXISTS (value added here, not used in this same migration).
-- =====================================================================

alter type consultant_decision add value if not exists 'revoked';

-- =====================================================================
-- ROLLBACK:
--   Postgres does not support removing a value from an enum type. To revert,
--   the enum must be recreated and dependent columns recast (heavy). Forward-fix
--   preferred: stop writing 'revoked' at the application layer if reverting.
-- =====================================================================
