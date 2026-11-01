-- =====================================================================
-- users.preferred_language — the user's chosen UI locale.
-- Author: i18n   Date: 2026-06-11
--
-- Mirrors the web NEXT_LOCALE cookie for cross-device persistence, and is read
-- by the AI pipeline (intake graph) to localise AI responses to the user's
-- language. Nullable: a null value means "no stored preference" -> the app
-- falls back to the cookie, then Accept-Language, then English.
--
-- SAFE: additive nullable column, no default, no backfill, no constraint.
-- Idempotent. Existing rows are untouched.
-- =====================================================================

alter table public.users
  add column if not exists preferred_language text;

-- =====================================================================
-- ROLLBACK:
--   alter table public.users drop column if exists preferred_language;
-- =====================================================================
