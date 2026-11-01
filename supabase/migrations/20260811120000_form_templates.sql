-- Automatic official-form delivery — the cache.
-- Design: docs/superpowers/specs/2026-08-11-auto-form-fetch-design.md
--
-- WHY A CACHE AND NOT A FETCH
--
-- Blank government forms are identical for every applicant, so fetching one
-- per user would point VisaAI's entire user base at government servers for no
-- gain. One scheduled fetch fills this table; every request path reads it.
-- Government-site availability is therefore never on a user request path.
--
-- WHY sha256 AND version_label BOTH
--
-- IRCC puts the revision date in the URL path
-- (…/forms/imm5257/01-09-2023/imm5257e.pdf), so version_label usually moves
-- when a form is revised. "Usually" is not "always" — a silent re-issue under
-- the same path is the failure mode that matters most here, because any field
-- mapping built against the old revision would keep filling the wrong boxes.
-- The checksum catches that; the label makes it legible to a human.
--
-- WHY THIS IS NOT IN public.documents
--
-- `documents` is applicant evidence. vri/graphs/nodes/load-vri-data.ts scores
-- every row in it, and documents/graphs/nodes/check-docs-ready.ts gates
-- cross-verification on all rows reaching a terminal ocr_status. A blank form
-- inserted there would inflate the readiness score and — with no OCR job ever
-- enqueued for it — block cross-verification for that application forever.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- Private, like every other bucket in this project. The contents are public
-- government documents, so the risk is not disclosure — it is that a public
-- bucket makes VisaAI an unmetered CDN for someone else's PDFs. Reads go
-- through short-lived signed URLs minted by the API.

insert into storage.buckets (id, name, public)
values ('form-templates', 'form-templates', false)
on conflict (id) do update set public = false;

-- No RLS policy on storage.objects for this bucket: nothing user-owned lives
-- here, and every read is a service-role-signed URL. Absent policies mean the
-- anon role cannot reach it at all, which is the intent.

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

create table if not exists public.form_templates (
  id             uuid primary key default gen_random_uuid(),

  -- Identity. Mirrors strategies/*: country + program + FormSpec.formCode.
  country_code   text not null check (char_length(country_code) between 2 and 12),
  program        text not null check (char_length(program) <= 64),
  form_code      text not null check (char_length(form_code) <= 32),
  form_name      text not null default '' check (char_length(form_name) <= 200),

  -- Stable, from FormSpec.sourceUrl or the module's landing-URL catalogue.
  landing_url    text not null,
  -- Versioned, discovered from the landing page. Null before the first run.
  resolved_pdf_url text,
  version_label  text check (char_length(version_label) <= 64),

  -- The cached bytes. storage_path is null until a download succeeds, which
  -- is what "serve the official link instead" keys on.
  storage_path   text,
  sha256         text check (sha256 is null or char_length(sha256) = 64),
  byte_size      integer check (byte_size is null or byte_size > 0),

  -- Can pdf-lib fill it? Drives prefill vs. blank-plus-data-sheet delivery.
  capability     text not null default 'unknown'
                 check (capability in ('acroform', 'xfa', 'unknown')),
  field_count    integer check (field_count is null or field_count >= 0),

  fetched_at     timestamptz,
  last_checked_at timestamptz,

  --   ok       cached copy is current
  --   stale    cached copy served, last refresh failed
  --   blocked  robots.txt disallows this URL; never fetch it
  --   error    no usable copy
  status         text not null default 'error'
                 check (status in ('ok', 'stale', 'blocked', 'error')),
  error_message  text check (char_length(error_message) <= 1000),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A row claiming 'ok' or 'stale' asserts a servable cached copy exists —
  -- 'stale' means "cached copy served, last refresh failed", which still
  -- promises bytes on disk. Either status with nothing cached would make the
  -- delivery path promise a download it cannot serve.
  constraint form_templates_cached_status_requires_bytes check (
    status not in ('ok', 'stale') or (storage_path is not null and sha256 is not null)
  )
);

comment on table public.form_templates is
  'Cached blank official government forms. One row per '
  '(country_code, program, form_code). Written only by the form-refresh job; '
  'read by the delivery path. Never holds applicant data.';

create unique index if not exists form_templates_identity_idx
  on public.form_templates (country_code, program, form_code);

-- The refresh job''s worklist: oldest check first.
create index if not exists form_templates_checked_idx
  on public.form_templates (last_checked_at nulls first);

alter table public.form_templates enable row level security;

-- Blank government forms are not user-owned, and every authenticated user
-- needs the same rows, so SELECT is open to signed-in users. Writes are
-- service-role only: no policy grants insert, update, or delete, and RLS
-- denies by default. The refresh job uses SupabaseService.admin, which
-- bypasses RLS entirely.
create policy form_templates_authenticated_read
  on public.form_templates
  for select
  to authenticated
  using (true);

revoke insert, update, delete on public.form_templates from authenticated, anon;
