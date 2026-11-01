-- =====================================================================
-- Gate 2 — Phase 2A.1  ENUMS + extensions (foundation, no tables yet)
-- Author: Database Architect   Date: 2026-06-06
--
-- Production-safe: each type creation is guarded (duplicate_object => no-op)
-- so the migration is idempotent / re-runnable. No existing object touched.
-- =====================================================================

-- pgcrypto provides digest() used by the audit hash chain (Phase 2A.5).
create extension if not exists "pgcrypto";

-- ---- verification_state -------------------------------------------------
-- Declared WEAKEST -> STRONGEST so min(state) over a section's fields means
-- "weakest field wins" (Postgres compares enums by declaration order).
do $$ begin
  create type verification_state as enum (
    'EXTRACTED',
    'USER_CONFIRMED',
    'CONSULTANT_REVIEWED',
    'CONSULTANT_APPROVED',
    'EXECUTION_READY',
    'EXECUTED'
  );
exception when duplicate_object then null; end $$;

-- ---- audit event taxonomy ----------------------------------------------
do $$ begin
  create type audit_event_type as enum (
    'DOCUMENT_UPLOADED',
    'OCR_COMPLETED',
    'FIELD_EXTRACTED',
    'FIELD_EDITED',
    'USER_CONFIRMED',
    'CONSULTANT_REVIEWED',
    'CONSULTANT_APPROVED',
    'PREFLIGHT_STARTED',
    'PREFLIGHT_COMPLETED',
    'EXECUTION_STARTED',
    'EXECUTION_COMPLETED',
    'EXECUTION_FAILED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_actor_role as enum ('system', 'applicant', 'consultant');
exception when duplicate_object then null; end $$;

-- ---- consultant decision ------------------------------------------------
do $$ begin
  create type consultant_decision as enum ('reviewed', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ---- preflight status ---------------------------------------------------
do $$ begin
  create type preflight_status as enum ('in_review', 'completed', 'invalidated');
exception when duplicate_object then null; end $$;

-- =====================================================================
-- ROLLBACK (manual; run in reverse, only if no dependent columns exist):
--   drop type if exists preflight_status;
--   drop type if exists consultant_decision;
--   drop type if exists audit_actor_role;
--   drop type if exists audit_event_type;
--   drop type if exists verification_state;
--   -- pgcrypto left installed (shared); drop only if certain nothing uses it.
-- NOTE: a type cannot be dropped while any table column uses it. Drop the
-- Phase 2A tables (reverse order) BEFORE dropping these types.
-- =====================================================================
