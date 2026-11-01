-- =====================================================================
-- Document Intelligence — duplicate detection + expiry + translation
-- Author: AI Engineer   Date: 2026-06-27
-- Depends on: documents, document_verifications (initial schema),
--             ocr_runs (…06000001), field_provenance (…06000002)
--
-- ADDITIVE ONLY. No column drops, no data rewrites. Re-runnable (idempotent
-- guards on every statement). RLS mirrors the existing documents tables.
--
-- Companion design: docs/document-processing/GAPS.md §A/§B/§C.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Duplicate detection — flag a re-upload of the same content within an
--    application. The byte/content signal reuses the SAME sha256 algorithm as
--    ocr_runs.raw_text_hash (computed today but never read back); identity_fphash
--    is a normalized fingerprint over the stable identity tuple, sharing the
--    value_hash normalization spine (trim + NFC) used by field_provenance.
-- ---------------------------------------------------------------------
alter table public.documents
  add column if not exists raw_text_hash   text,        -- sha256 of OCR text (content dup signal)
  add column if not exists identity_fphash text,        -- sha256(document_type|id|name|dob) (re-scan signal)
  add column if not exists duplicate_of    uuid references public.documents on delete set null,
  add column if not exists dup_status      text not null default 'unique'
    check (dup_status in ('unique', 'exact_dup', 'likely_dup'));

-- Fast per-application dup lookup on both signals.
create index if not exists documents_app_contenthash_idx
  on public.documents (application_id, raw_text_hash);
create index if not exists documents_app_identityhash_idx
  on public.documents (application_id, identity_fphash);

-- ---------------------------------------------------------------------
-- B. Expiry detection — store the real extracted expiry date + the deterministic
--    type/travel-aware verdict (was previously only an informational
--    document_verifications row measured from now()).
-- ---------------------------------------------------------------------
alter table public.documents
  add column if not exists expiry_date   date,
  add column if not exists expiry_status text
    check (expiry_status is null or expiry_status in ('pass', 'warn', 'fail', 'unknown'));

-- ---------------------------------------------------------------------
-- C. Translation — non-English document content rendered to English for
--    consultant review. The SOURCE OCR text is never overwritten (residency /
--    fidelity reason OCR avoids translation); a translation is a separate
--    artifact produced via the metered AiService.
-- ---------------------------------------------------------------------
alter table public.documents
  add column if not exists detected_language   text,    -- ISO-639-1, e.g. 'fr', 'ar'
  add column if not exists language_confidence numeric
    check (language_confidence is null or (language_confidence >= 0 and language_confidence <= 1)),
  add column if not exists needs_translation   boolean not null default false;

create table if not exists public.document_translations (
  id              uuid primary key default uuid_generate_v4(),
  document_id     uuid not null references public.documents on delete cascade,
  application_id  uuid not null references public.applications on delete cascade,
  source_lang     text not null,                        -- ISO-639-1 of the source document
  target_lang     text not null default 'en',
  translated_text text not null,
  provider        text,                                 -- AiService provider that produced it
  model           text,
  created_at      timestamptz not null default now(),
  -- One translation per (document, target language); re-translation upserts.
  unique (document_id, target_lang)
);

create index if not exists document_translations_app_idx
  on public.document_translations (application_id);

alter table public.document_translations enable row level security;

-- Owner may READ translations for their own applications (consultant review is
-- served via the consultant-scoped paths / service role). Writes happen via the
-- service-role OCR/translation worker only — no client write policy (mirrors
-- ocr_runs / field_provenance).
drop policy if exists document_translations_owner_read on public.document_translations;
create policy document_translations_owner_read on public.document_translations
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
  );

comment on table public.document_translations is
  'English (or target-lang) rendering of non-English document content for human review. Source OCR text is never overwritten. Service-role write.';

-- ---------------------------------------------------------------------
-- A (cont). Surface a duplicate as a first-class verification/warning row.
-- The initial check constraint allowed only identity/expiry/financial/employment;
-- extend it (additive) so store_verification can write a 'duplicate' verdict.
-- ---------------------------------------------------------------------
alter table public.document_verifications
  drop constraint if exists document_verifications_verification_type_check;
alter table public.document_verifications
  add constraint document_verifications_verification_type_check
  check (verification_type in ('identity', 'expiry', 'financial', 'employment', 'duplicate'));

-- =====================================================================
-- ROLLBACK (manual; additive migration is normally left in place):
--   drop table if exists public.document_translations;
--   alter table public.documents
--     drop column if exists raw_text_hash, drop column if exists identity_fphash,
--     drop column if exists duplicate_of, drop column if exists dup_status,
--     drop column if exists expiry_date, drop column if exists expiry_status,
--     drop column if exists detected_language, drop column if exists language_confidence,
--     drop column if exists needs_translation;
--   alter table public.document_verifications
--     drop constraint if exists document_verifications_verification_type_check;
--   alter table public.document_verifications
--     add constraint document_verifications_verification_type_check
--     check (verification_type in ('identity','expiry','financial','employment'));
-- =====================================================================
