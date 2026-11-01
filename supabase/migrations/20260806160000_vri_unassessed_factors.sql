-- =====================================================================
-- Record which VRI factors were never assessed (FAKE-002).
-- Author: Audit (Phase 5)   Date: 2026-08-06
-- Depends on: 20260531000000_initial_schema.sql (vri_scores)
--
-- WHY: score-consistency used to return consistency_pct = 100 when there were
-- NO cross-verifications at all — a perfect score for a check that never ran.
-- The user saw "Consistency: 100%" on their readiness breakdown, and the
-- factor's 0.15 weight added 15 unearned points to the overall score, which
-- decides auto-escalation for consultant review (escalate_below = 50).
--
-- The scoring fix already shipped: an unassessed factor is excluded from the
-- weighted aggregate and the remaining weights are renormalised, and the
-- recommendation engine skips it so the user is not advised to "improve
-- Application Consistency" for something that was never checked.
--
-- WHAT REMAINS is presentation. vri_scores.consistency_pct is `int not null`,
-- so an unassessed factor still has to persist SOME number — currently 0, which
-- the readiness UI renders as "0% · Weak". That is the same defect inverted:
-- 100 claimed a pass that never happened, 0 claims a failure that never
-- happened. Neither is true.
--
-- WHAT: an additive, nullable array naming the factors that were not assessed,
-- so the UI can render "Not assessed" instead of a fabricated percentage.
--
-- SAFE: additive only. No column is dropped, no type changed, no row rewritten.
-- vri_scores holds 0 rows in production, so there is no backfill to consider.
--
-- NOT YET APPLIED. Blocked on BLK-1 — production has no backup of any kind.
-- Applying this alone is harmless but incomplete: it must land together with
-- the save-node change that populates it and the readiness-UI change that
-- reads it. Sequence recorded in the remaining-task plan.
-- =====================================================================

alter table public.vri_scores
  add column if not exists unassessed_factors text[] null;

comment on column public.vri_scores.unassessed_factors is
  'Factor keys (e.g. consistency_pct) whose input data was absent, so no assessment ran. Excluded from overall_score; render as "Not assessed" rather than a percentage. See FAKE-002.';

-- =====================================================================
-- ROLLBACK:
--   alter table public.vri_scores drop column if exists unassessed_factors;
-- =====================================================================
