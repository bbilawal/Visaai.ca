-- =====================================================================
-- consultant_decision += 'not_applicable'
-- Date: 2026-10-15   Dry-run defect #32
--
-- A consultant needs to say "this field does not apply to this application"
-- (OCR junk such as a sponsor job title "HR Data Quality Coordinator", or a
-- currency read as "V") WITHOUT blocking portal auto-fill. 'rejected' blocks
-- auto-fill for the whole application; 'not_applicable' only removes the field
-- from what auto-fill writes (apps/api PreflightMappingService) and leaves the
-- application approval rollup untouched.
--
-- Additive and idempotent. ADD VALUE cannot run inside a transaction block on
-- PG < 12 and the new value cannot be USED in the same transaction; this file
-- only adds it. The API writes 'not_applicable' only after this is applied —
-- until then POST /consultant/fields/:key/not-applicable fails with an enum
-- error and nothing else changes.
-- =====================================================================

alter type consultant_decision add value if not exists 'not_applicable';
