-- =====================================================================
-- Add Bulgaria (BG) and Romania (RO) to the Schengen member set.
-- Author: Audit (Phase 4 / country data)   Date: 2026-08-06
-- Depends on: 20260611000001_schengen_bloc_visibility.sql
--
-- WHY: public.is_schengen_member() has carried a 27-code literal set since
-- 2026-06-11. Bulgaria and Romania are full Schengen members — air and sea
-- borders lifted 31 March 2024 (Council Decision (EU) 2024/210), land borders
-- lifted 1 January 2025 (Council Decision (EU) 2024/3153). The set has
-- therefore been ~19 months stale.
--
-- IMPACT BEING FIXED: consultant_covers_country() expands the 'SCHENGEN' bloc
-- through this helper. A consultant whose consultant_countries row is the
-- 'SCHENGEN' bloc did NOT cover applications with destination_country 'BG' or
-- 'RO' — those applications were invisible to every bloc consultant, with no
-- error raised. Consultants holding an explicit 'BG'/'RO' row were unaffected
-- (the exact-match branch already worked).
--
-- WHAT: replace the literal set with the full 29 codes. Signature, return
-- type, volatility, security mode and grants are unchanged, so the policies
-- and the consultant_covers_country() wrapper pick this up with no further
-- change. `create or replace` makes it idempotent.
--
-- KEEP IN SYNC: apps/api/src/strategies/country/schengen-members.ts
-- (SCHENGEN_MEMBERS). The parity guard is
-- apps/api/test/schengen-registry-db-parity.spec.ts.
--
-- SAFE: pure function replacement. Reads no tables, writes no rows, drops
-- nothing. Widening the set can only make MORE rows visible to bloc
-- consultants who are already entitled to the bloc — it cannot expose a row
-- to anyone who was not already covering Schengen.
-- =====================================================================

create or replace function public.is_schengen_member(p_code text)
  returns boolean language sql immutable as $$
  select p_code is not null and upper(p_code) in (
    'AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE',
    'GR','HU','IS','IT','LV','LI','LT','LU','MT','NL',
    'NO','PL','PT','RO','SK','SI','ES','SE','CH'
  );
$$;

grant execute on function public.is_schengen_member(text) to authenticated, anon;

-- =====================================================================
-- ROLLBACK (restores the pre-2024 27-code set — only do this if the
-- enlargement is being deliberately un-modelled):
--   create or replace function public.is_schengen_member(p_code text)
--     returns boolean language sql immutable as $$
--     select p_code is not null and upper(p_code) in (
--       'AT','BE','HR','CZ','DK','EE','FI','FR','DE','GR',
--       'HU','IS','IT','LV','LI','LT','LU','MT','NL','NO',
--       'PL','PT','SK','SI','ES','SE','CH'
--     );
--   $$;
--   grant execute on function public.is_schengen_member(text) to authenticated, anon;
-- =====================================================================
