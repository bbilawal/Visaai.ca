-- =====================================================================
-- Gate 2 — Phase 2A.3  field_provenance  (one row per extracted field value)
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: applications, documents, ocr_runs
-- Append-only by convention: re-extraction inserts a new row and points the
-- prior row's superseded_by at it. Value/source columns are never updated.
-- =====================================================================

create table if not exists public.field_provenance (
  id                  uuid primary key default uuid_generate_v4(),
  application_id      uuid not null references public.applications on delete cascade,
  field_key           text not null,             -- canonical snake_case (== field_verifications.field_key)

  origin              text not null
                        check (origin in ('ocr','intake','inferred','user_entered')),
  value_snapshot      text,                      -- value as extracted (string form)
  value_hash          text,                      -- sha256(value_snapshot); shared join key

  -- document provenance (null when origin in ('intake','user_entered'))
  source_document_id  uuid references public.documents on delete set null,
  source_page         int  check (source_page is null or source_page >= 0),
  source_bbox         jsonb,                     -- { page, unit, x, y, w, h } normalized 0..1
  ocr_run_id          uuid references public.ocr_runs on delete set null,

  -- extraction event
  extraction_timestamp timestamptz not null default now(),
  confidence          numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  confidence_band     text check (confidence_band is null or confidence_band in ('high','medium','low')),

  -- lineage
  superseded_by       uuid references public.field_provenance on delete set null,
  created_at          timestamptz not null default now(),

  -- OCR-origin rows must carry a run id (run-identity is mandatory; bbox is best-effort)
  constraint field_provenance_ocr_requires_run
    check (origin <> 'ocr' or ocr_run_id is not null)
);

-- Exactly ONE current (non-superseded) provenance row per (application, field).
create unique index if not exists field_provenance_current_uidx
  on public.field_provenance (application_id, field_key)
  where superseded_by is null;

-- Cascade / lineage / triage indexes.
create index if not exists field_provenance_document_idx
  on public.field_provenance (source_document_id) where superseded_by is null;
create index if not exists field_provenance_run_idx
  on public.field_provenance (ocr_run_id);
create index if not exists field_provenance_lineage_idx
  on public.field_provenance (application_id, field_key, created_at);
create index if not exists field_provenance_lowconf_idx
  on public.field_provenance (application_id, confidence_band) where superseded_by is null;

alter table public.field_provenance enable row level security;

drop policy if exists field_provenance_owner_read on public.field_provenance;
create policy field_provenance_owner_read on public.field_provenance
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
  );
-- Writes via service role only (OCR/intake/prefill nodes). No client write policy.

comment on table public.field_provenance is
  'Gate 2: where each field value came from (doc/page/bbox/run/origin). Append-only via superseded_by. Service-role write.';

-- =====================================================================
-- ROLLBACK:
--   drop table if exists public.field_provenance;
-- =====================================================================
