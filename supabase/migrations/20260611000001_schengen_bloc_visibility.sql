-- =====================================================================
-- Schengen bloc visibility — predicate-level bloc-expansion (NO data migration).
-- Author: Database Architect   Date: 2026-06-11
-- Depends on: consultant_countries, applications, consultant_assignments,
--             20260608000002_consultant_country_visibility_rls.sql,
--             20260608000003_fix_visibility_recursion.sql
--
-- The destination-country picker now offers 27 individual Schengen member
-- states instead of one 'SCHENGEN' bloc. Consultant visibility matched the
-- destination by EXACT equality (cc.country_code = applications.destination_country),
-- so a consultant whose consultant_countries row is 'SCHENGEN' would NOT see
-- member-coded apps ('DE','FR',...). This migration expands the bloc at QUERY
-- TIME via a predicate, so a 'SCHENGEN' consultant covers all 27 members while
-- a 'DE' consultant covers 'DE', and legacy 'SCHENGEN' apps stay covered by the
-- exact-equality branch.
--
-- SCOPE CONFIRMATION (per TECH-DESIGN §3.1):
--   * NO destination_country backfill — existing rows are not rewritten.
--     Legacy 'SCHENGEN' apps stay 'SCHENGEN'; new apps store member ISO-2.
--   * NO consultant_countries fan-out — a bloc consultant keeps a single
--     country_code='SCHENGEN' row; the predicate expands it at query time.
--   * NO constraint change — there is no FK/CHECK on destination_country or on
--     consultant_countries.country_code, so new code values need no migration.
-- This keeps the change fully reversible: drop the helper, revert the function
-- body — there is no data to un-migrate (see rollback block at bottom).
--
-- IDEMPOTENT: both functions use CREATE OR REPLACE; safe to re-run.
--
-- RECURSION SAFETY (carried from 20260608000003): consultant_covers_country
-- keeps the SAME SECURITY DEFINER signature and reads ONLY consultant_countries,
-- whose RLS policies reference only auth.uid()/auth.jwt() (NOT applications), so
-- no applications ⇄ consultant_assignments cycle is introduced. is_schengen_member
-- reads NO tables at all (pure set membership), adding zero recursion surface.
-- The applications SELECT policy and consultant self-insert policy call
-- consultant_covers_country BY NAME, so replacing only the body changes behavior
-- with NO policy edits.
-- =====================================================================

-- ── New helper: pure set-membership test for the 27 Schengen member states.
--    SECURITY INVOKER (default) is correct — it reads no tables. IMMUTABLE so
--    the planner can fold it. The 27-code literal set MUST stay byte-identical
--    to SCHENGEN_MEMBERS in the backend (TECH-DESIGN §2.1 / §3.2). ───────────
create or replace function public.is_schengen_member(p_code text)
  returns boolean language sql immutable as $$
  select p_code is not null and upper(p_code) in (
    'AT','BE','HR','CZ','DK','EE','FI','FR','DE','GR',
    'HU','IS','IT','LV','LI','LT','LU','MT','NL','NO',
    'PL','PT','SK','SI','ES','SE','CH'
  );
$$;

grant execute on function public.is_schengen_member(text) to authenticated, anon;

-- ── Rewrite consultant_covers_country as bloc-expansion. Same signature,
--    return type, volatility (stable security definer) and search_path as
--    20260608000003 so the existing policies pick it up unchanged. A consultant
--    covers p_country if they have an ACTIVE row that is either the EXACT code
--    OR the 'SCHENGEN' bloc when p_country is a member.
--
--    Delivered behavior:
--      * country_code='DE'       → sees 'DE' apps                 (exact branch)
--      * country_code='SCHENGEN' → sees all 27 member apps        (bloc branch)
--      * country_code='SCHENGEN' → still sees legacy 'SCHENGEN' apps
--        (is_schengen_member('SCHENGEN') is false, but the exact branch
--         'SCHENGEN' = 'SCHENGEN' matches). ──────────────────────────────────
create or replace function public.consultant_covers_country(p_uid uuid, p_country text)
  returns boolean language sql stable security definer set search_path = public as $$
  select p_country is not null and exists (
    select 1 from public.consultant_countries cc
    where cc.consultant_id = p_uid
      and cc.active = true
      and (
        cc.country_code = p_country                                                -- exact: 'DE' covers DE
        or (cc.country_code = 'SCHENGEN' and public.is_schengen_member(p_country))  -- bloc expansion
      )
  );
$$;

grant execute on function public.consultant_covers_country(uuid, text) to authenticated, anon;

-- =====================================================================
-- ROLLBACK (TECH-DESIGN §6.1):
--   -- Restore exact-equality consultant_covers_country (from 20260608000003).
--   create or replace function public.consultant_covers_country(p_uid uuid, p_country text)
--     returns boolean language sql stable security definer set search_path = public as $$
--     select p_country is not null and exists (
--       select 1 from public.consultant_countries cc
--       where cc.consultant_id = p_uid and cc.active = true and cc.country_code = p_country
--     );
--   $$;
--   drop function if exists public.is_schengen_member(text);
-- The applications SELECT and self-insert policies call the function by name,
-- so restoring the body reverts behavior with no policy edits. Legacy data is
-- untouched (no backfill, no fan-out), so rollback is migration-only.
-- =====================================================================
