-- =====================================================================
-- Messaging P4: full-text search over messages.body. A generated, stored
-- tsvector column (config 'simple' = language-agnostic, fits EN/FR + names/
-- document terms) kept in sync automatically + a GIN index. No RLS change —
-- the existing messages SELECT policy scopes search results to conversations
-- the caller can access.
-- Author: messaging P4  Date: 2026-06-14
-- =====================================================================

alter table public.messages
  add column search_tsv tsvector
    generated always as (to_tsvector('simple', coalesce(body, ''))) stored;

create index messages_search_gin on public.messages using gin (search_tsv);
