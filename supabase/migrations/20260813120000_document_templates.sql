-- Automatic official-DOCUMENT delivery — the cache.
--
-- The other half of the submission package. 20260811120000_form_templates.sql
-- cached the blank form the applicant FILES; this caches everything the
-- authority publishes about the documents they must GATHER: the document
-- checklist (IMM 5484 / IMM 5483 / IMM 5488), the photograph specification
-- every Schengen application is judged against, declaration templates
-- (IMM 5409, I-130A, I-864), and route guidance (UKVI caseworker guidance).
--
-- WHY A SEPARATE TABLE AND NOT A `kind` COLUMN ON form_templates
--
-- form_templates.capability ('acroform' | 'xfa' | 'unknown') and field_count
-- exist to answer ONE question: can pdf-lib fill this for the applicant? Every
-- reader of that table — prefill, the renderer registry, the delivery path's
-- `prefillable` flag — is built on the assumption that a row is a fillable
-- artifact. A checklist is never filled and never prefilled, so adding it
-- there would put rows in front of those readers that are structurally
-- incapable of satisfying them, and `capability` would become a column that
-- means nothing for half the rows. Separate table, separate lifecycle, and
-- form_templates' invariants stay true.
--
-- WHY THIS IS NOT IN public.documents
--
-- Same reason as form_templates: `documents` is applicant evidence.
-- vri/graphs/nodes/load-vri-data.ts scores every row in it and
-- documents/graphs/nodes/check-docs-ready.ts gates cross-verification on all
-- rows reaching a terminal ocr_status. A blank checklist inserted there would
-- inflate the readiness score and — with no OCR job ever enqueued for it —
-- block cross-verification for that application forever.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- Private, like every other bucket here. The contents are public government
-- documents, so the risk is not disclosure — it is that a public bucket makes
-- VisaAI an unmetered CDN for someone else's PDFs. Reads go through
-- short-lived signed URLs minted by the API.

insert into storage.buckets (id, name, public)
values ('document-templates', 'document-templates', false)
on conflict (id) do update set public = false;

-- No RLS policy on storage.objects for this bucket: nothing user-owned lives
-- here and every read is a service-role-signed URL. Absent policies mean the
-- anon role cannot reach it at all, which is the intent.

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

create table if not exists public.document_templates (
  id             uuid primary key default gen_random_uuid(),

  -- Identity. Mirrors strategies/*: country + program + the artifact's code.
  country_code   text not null check (char_length(country_code) between 2 and 12),
  program        text not null check (char_length(program) <= 64),
  template_code  text not null check (char_length(template_code) <= 48),
  template_name  text not null default '' check (char_length(template_name) <= 250),

  -- What the artifact IS, so the UI can label it honestly instead of calling a
  -- caseworker guidance PDF a "form".
  kind           text not null default 'checklist'
                 check (kind in ('checklist', 'guide', 'declaration',
                                 'specification', 'instructions')),

  -- The DocumentRequirement.code this supports ('photo', 'proof_of_status'),
  -- or null when it covers the whole application (a checklist, a route guide).
  document_code  text check (char_length(document_code) <= 64),

  -- Stable, from the strategy table. Either a landing page or, where the
  -- authority publishes stable unversioned URLs (Home Affairs), the PDF itself.
  source_url     text not null,
  -- Versioned, resolved from the landing page. Null before the first run.
  resolved_pdf_url text,
  version_label  text check (char_length(version_label) <= 64),

  -- The cached bytes. storage_path is null until a download succeeds, which is
  -- what "serve the official link instead" keys on.
  storage_path   text,
  sha256         text check (sha256 is null or char_length(sha256) = 64),
  byte_size      integer check (byte_size is null or byte_size > 0),
  content_type   text check (char_length(content_type) <= 128),

  fetched_at     timestamptz,
  last_checked_at timestamptz,

  --   ok         cached copy is current
  --   stale      cached copy served, last refresh failed
  --   blocked    robots.txt disallows this URL; never fetch it
  --   link_only  the authority publishes a web page, not a file — by design,
  --              not a failure. Distinct from 'error' so an operator reading
  --              this table can tell "nothing to cache here" apart from
  --              "caching broke", and so the nightly job stops manufacturing
  --              failures for artifacts that were never fetchable.
  --   error      no usable copy
  status         text not null default 'error'
                 check (status in ('ok', 'stale', 'blocked', 'link_only', 'error')),
  error_message  text check (char_length(error_message) <= 1000),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A row claiming 'ok' or 'stale' asserts a servable cached copy exists —
  -- 'stale' means "cached copy served, last refresh failed", which still
  -- promises bytes on disk. Either status with nothing cached would make the
  -- delivery path promise a download it cannot serve. 'link_only' is
  -- deliberately NOT in this list: it promises no bytes at all.
  constraint document_templates_cached_status_requires_bytes check (
    status not in ('ok', 'stale') or (storage_path is not null and sha256 is not null)
  )
);

comment on table public.document_templates is
  'Cached official document checklists, specifications, declaration templates '
  'and route guidance. One row per (country_code, program, template_code). '
  'Written only by the doc-template-refresh job; read by the delivery path. '
  'Never holds applicant data.';

create unique index if not exists document_templates_identity_idx
  on public.document_templates (country_code, program, template_code);

-- The refresh job's worklist: oldest check first.
create index if not exists document_templates_checked_idx
  on public.document_templates (last_checked_at nulls first);

alter table public.document_templates enable row level security;

-- Government checklists are not user-owned and every authenticated user needs
-- the same rows, so SELECT is open to signed-in users. Writes are service-role
-- only: no policy grants insert, update or delete, and RLS denies by default.
-- The refresh job uses SupabaseService.admin, which bypasses RLS entirely.
create policy document_templates_authenticated_read
  on public.document_templates
  for select
  to authenticated
  using (true);

revoke insert, update, delete on public.document_templates from authenticated, anon;
