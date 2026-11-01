-- =====================================================================
-- Harden consultant_countries.country_code with a format CHECK.
-- Author: Database   Date: 2026-06-11
-- Depends on: 20260608000000_consultant_countries.sql
--
-- WHY: country_code is a free-text join/dispatch key (consultant visibility
-- resolves against it). A typo'd value ('de', 'GER', 'DE ', 'germany') becomes a
-- silently dead mapping — the consultant covers nothing and no error is raised.
--
-- WHAT: a FORMAT check, NOT a hardcoded country set. Allowed = a 2-letter
-- UPPERCASE ISO-2 code OR the 'SCHENGEN' bloc sentinel. This catches the common
-- typo class without coupling this SQL to the strategy registry (the registry
-- stays the single source of truth for *which* codes are actually supported;
-- the app layer already rejects unsupported-but-format-valid codes like 'XK').
--
-- SAFE: consultant_countries currently has 0 rows in production, so adding the
-- constraint cannot fail on existing data. Idempotent (drop-if-exists + add).
-- =====================================================================

alter table public.consultant_countries
  drop constraint if exists consultant_countries_country_code_format;

alter table public.consultant_countries
  add constraint consultant_countries_country_code_format
  check (country_code ~ '^[A-Z]{2}$' or country_code = 'SCHENGEN');

-- =====================================================================
-- ROLLBACK:
--   alter table public.consultant_countries
--     drop constraint if exists consultant_countries_country_code_format;
-- =====================================================================
