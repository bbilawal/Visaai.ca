-- =====================================================================
-- Gate 2 — Phase 2A.2  ocr_runs  (one row per OCR pass)
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: documents, applications (initial schema)
-- =====================================================================

create table if not exists public.ocr_runs (
  id              uuid primary key default uuid_generate_v4(),
  document_id     uuid not null references public.documents on delete cascade,
  application_id  uuid not null references public.applications on delete cascade,
  provider        text not null
                    check (provider in ('mock','openai','azure-di','aws-textract','google-docai')),
  provider_model  text,
  region          text not null default 'global',
  status          text not null default 'complete'
                    check (status in ('complete','failed')),
  page_count      int  check (page_count is null or page_count >= 0),
  raw_text_hash   text,                       -- sha256 of full OCR text; no raw text stored
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- Indexes: latest-run lookup per document; per-application scans.
create index if not exists ocr_runs_document_idx    on public.ocr_runs (document_id, completed_at desc);
create index if not exists ocr_runs_application_idx  on public.ocr_runs (application_id);

alter table public.ocr_runs enable row level security;

-- Owner may READ runs for their own applications (transparency).
-- Writes happen via service role (OCR worker) only -> no client write policy.
drop policy if exists ocr_runs_owner_read on public.ocr_runs;
create policy ocr_runs_owner_read on public.ocr_runs
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
  );

comment on table public.ocr_runs is
  'Gate 2: one row per OCR pass. Provenance run-identity (provider/model/region). Service-role write.';

-- =====================================================================
-- ROLLBACK:
--   drop table if exists public.ocr_runs;   -- (field_provenance.ocr_run_id FK must be dropped first)
-- =====================================================================
