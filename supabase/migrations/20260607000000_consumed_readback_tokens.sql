-- =====================================================================
-- Phase 4 — Replay protection  consumed_readback_tokens
-- Author: Backend (Execution Integrity)   Date: 2026-06-07
--
-- One readback token may authorize at most ONE execution. The execution choke
-- point atomically inserts the token hash here as its final commit; a second
-- use collides on the primary key and is rejected as replay_detected. This is
-- the TOCTOU-safe single-use guarantee (the unique PK is the atomic gate).
-- Stores only a sha256 hash — never the raw token.
-- =====================================================================

create table if not exists public.consumed_readback_tokens (
  token_hash      text primary key,
  application_id  uuid not null references public.applications on delete cascade,
  consumed_at     timestamptz not null default now()
);

create index if not exists consumed_readback_tokens_app_idx
  on public.consumed_readback_tokens (application_id);

alter table public.consumed_readback_tokens enable row level security;
-- Service-role only (execution choke point). No client policy: invisible + unwritable from clients.

comment on table public.consumed_readback_tokens is
  'Phase 4: single-use readback token ledger. PK collision = replay_detected. Service-role only.';

-- =====================================================================
-- ROLLBACK:
--   drop table if exists public.consumed_readback_tokens;
-- =====================================================================
