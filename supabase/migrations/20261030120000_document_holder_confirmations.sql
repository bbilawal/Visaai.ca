-- =====================================================================
-- The applicant's own "this passport is mine" on a held document.
-- Date: 2026-10-30
--
-- sync_profile holds a passport / ID whose printed name shares nothing with
-- the name the applicant gave (document_verifications.details_json
-- .holder_mismatch.needs_confirmation): nothing is written from it and it is
-- not attached to a portal until confirmed. Until now only a consultant
-- approval (application_item_reviews) confirmed it. This table records the
-- APPLICANT's confirmation: append-only, one row per confirmation, kept
-- separate from application_item_reviews so it never reads as (or replaces)
-- the consultant's latest review decision.
--
-- It is the audit trail the consultant sees, and the source of truth that
-- releases the hold (prefill load-context / held-identity, preflight
-- portal-documents): details_json is rewritten on every re-read and is
-- writable by the owner under its RLS policy, so it cannot be.
--
-- A clearly-someone-else's document (holder_mismatch.clearly_other) is never
-- released by this: the API refuses to record one, and readers ignore it.
--
-- Writes are service-role only (the API checks ownership with the caller's
-- own client first). NOT APPLIED — apply BEFORE deploying the API code:
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Rollback: rollback/20261030120000_document_holder_confirmations.down.sql
-- =====================================================================

create table if not exists public.document_holder_confirmations (
  id              uuid primary key default uuid_generate_v4(),
  document_id     uuid not null references public.documents on delete cascade,
  application_id  uuid not null references public.applications on delete cascade,
  confirmed_by    uuid references public.users on delete set null,
  -- The names the held note showed when the applicant confirmed (audit).
  holder_name     text check (holder_name is null or length(holder_name) <= 300),
  stated_name     text check (stated_name is null or length(stated_name) <= 300),
  created_at      timestamptz not null default now()
);

create index if not exists document_holder_confirmations_app_idx
  on public.document_holder_confirmations (application_id, document_id, created_at desc);

alter table public.document_holder_confirmations enable row level security;

drop policy if exists document_holder_confirmations_select on public.document_holder_confirmations;
create policy document_holder_confirmations_select on public.document_holder_confirmations
  for select using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(application_id, auth.uid())
    or auth.uid() = (select user_id from public.applications where id = application_id)
  );
-- No insert/update/delete policies: service-role writes only.

comment on table public.document_holder_confirmations is
  'Applicant confirmations that a held passport/ID (holder_mismatch.needs_confirmation) is their own. Append-only audit; releases the hold like a consultant approval. Service-role write.';
