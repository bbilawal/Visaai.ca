-- Visa Knowledge System — the retrieval layer over the official-source registry.
--
-- WHAT ALREADY EXISTS, AND WHY THIS DOES NOT REPLACE IT
--
-- 20260820120000_visa_registry_core.sql already models the things this system
-- must never re-invent:
--
--   visa_countries        which destinations exist, and their authorities
--   visa_types            the catalog of visas each authority issues
--   visa_sources          the official pages VisaAI monitors (authority_rank 1-5)
--   visa_source_versions  immutable per-fetch snapshots, with two hashes
--   visa_source_checks    per-run fetch outcomes
--   visa_source_changes   the detected -> ... -> active promotion queue
--   visa_requirements     typed, reviewed requirements citing a source VERSION
--
-- That set answers "what does the government require, and where did we read
-- it". It cannot answer "what does the government's page actually SAY about
-- X", because nothing stores the page's text in a retrievable shape. The sync
-- job hashes normalized text to detect change and throws the text away.
--
-- This migration adds exactly the layer that was missing, and nothing else:
--
--   kb_blobs              one physical copy of any byte-identical file
--   kb_extractions        the text extracted from a version, content-addressed
--   kb_sections           document structure (headings, tables, pages)
--   kb_chunk_texts        one physical copy of any byte-identical chunk text
--   kb_chunks             a chunk instance, with its provenance and filters
--   kb_embeddings         one vector per (chunk text, embedding model version)
--   kb_chunk_scopes       extra country/visa links for SHARED content
--   kb_ingestion_jobs     idempotent, resumable per-version pipeline runs
--   kb_freshness_policies per-risk-class recheck cadence
--   kb_quarantine         extraction failures and suspicious content
--   kb_retrieval_logs     what was retrieved, for evaluation and debugging
--   kb_answer_citations   which chunk backed which sentence of which answer
--   kb_review_queue       human review tasks this layer raises
--
-- THE FOUR DEDUPLICATION POINTS, which are the reason for the table split.
--
--   1. Bytes.  Two countries linking the same PDF, or one page re-fetched
--      unchanged, store ONE kb_blobs row keyed by its sha256.
--   2. Extracted text.  A parser upgrade that produces identical text for a
--      new version reuses the kb_extractions row.
--   3. Chunk text.  Boilerplate that appears on 300 government pages ("You
--      must have a valid passport") is ONE kb_chunk_texts row; the 300
--      provenance records are cheap kb_chunks rows pointing at it.
--   4. Embeddings.  Keyed by (text hash, model), so the 300 chunks above cost
--      one embedding, and re-embedding on a model upgrade never duplicates
--      within a model version.
--
-- WRITE MODEL. Same posture as the registry: these are government facts, not
-- user data. Service-role write only; anon may read the published corpus so
-- public visa pages can cite it. The one exception is kb_retrieval_logs, which
-- records what a specific USER asked and is therefore owner-scoped.
--
-- PRIVATE APPLICANT DOCUMENTS ARE NOT IN SCOPE HERE AND MUST NEVER BE. Nothing
-- in this schema references public.documents, and kb_chunks.source_version_id
-- is NOT NULL, so a chunk can only exist if it came from an official source
-- version. That is the structural guarantee behind "applicant documents are
-- never added to the shared index".

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- pgvector lives in `extensions`, which is already on the API search_path
-- (supabase/config.toml: extra_search_path). Creating it in `public` would put
-- an operator-managed type in the schema PostgREST exposes.
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- Private, like every other bucket here. The contents are public government
-- documents, so the risk is not disclosure — it is that a public bucket makes
-- VisaAI an unmetered CDN for another government's PDFs, and that a cached
-- copy could be mistaken for the authoritative one. Reads go through
-- short-lived signed URLs minted by the API, and citations always point at the
-- authority's own canonical_url, never at the cache.
insert into storage.buckets (id, name, public)
values ('visa-knowledge', 'visa-knowledge', false)
on conflict (id) do update set public = false;

-- No RLS policy on storage.objects for this bucket: nothing user-owned lives
-- here and every read is service-role-signed. Absent policies mean anon cannot
-- reach it at all, which is the intent.

-- ---------------------------------------------------------------------------
-- Content-addressed blob store
-- ---------------------------------------------------------------------------

create table if not exists public.kb_blobs (
  -- The hash IS the identity. No surrogate key: two rows with the same bytes
  -- is the exact thing this table exists to make unrepresentable.
  sha256        text primary key check (sha256 ~ '^[0-9a-f]{64}$'),

  byte_size     bigint not null check (byte_size >= 0),
  -- Sniffed from the bytes, never trusted from the extension or the
  -- Content-Type header. See modules/knowledge/mime.ts.
  content_type  text not null check (char_length(content_type) <= 128),

  --   none  stored as served
  --   gzip  stored gzip-compressed; byte_size is the ORIGINAL size
  compression   text not null default 'none' check (compression in ('none', 'gzip')),
  stored_bytes  bigint check (stored_bytes is null or stored_bytes >= 0),

  -- Object-storage path inside the `visa-knowledge` bucket. Null means the
  -- bytes were deliberately NOT cached — the authority's terms forbid
  -- redistribution (visa_sources.redistribution) — and only the hash and size
  -- are kept, which is enough to detect change and to prove what we read.
  storage_path  text,

  -- How many kb_extractions / visa_source_versions currently point here.
  -- Maintained by the application, not a trigger: the lifecycle sweep needs a
  -- cheap "is anything still using this" and a trigger on every insert path is
  -- a hot-path cost for a cold-path question.
  ref_count     integer not null default 0 check (ref_count >= 0),

  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  created_at    timestamptz not null default now()
);

comment on table public.kb_blobs is
  'Content-addressed store for original official files. One row per distinct '
  'byte sequence, ever. storage_path null = bytes intentionally not cached '
  '(redistribution not permitted); the hash still proves what was read.';

create index if not exists kb_blobs_unreferenced_idx
  on public.kb_blobs (last_seen_at) where ref_count = 0;

-- Link a source version to the bytes it was served. Additive to the registry
-- table; visa_source_versions.storage_path predates this and stays as the
-- legacy pointer so existing readers keep working.
alter table public.visa_source_versions
  add column if not exists blob_sha256 text references public.kb_blobs on delete set null;

create index if not exists visa_source_versions_blob_idx
  on public.visa_source_versions (blob_sha256) where blob_sha256 is not null;

-- ---------------------------------------------------------------------------
-- Extractions
-- ---------------------------------------------------------------------------

create table if not exists public.kb_extractions (
  id                uuid primary key default gen_random_uuid(),
  source_version_id uuid not null references public.visa_source_versions on delete cascade,

  -- The extractor that produced this text. A parser upgrade must produce a NEW
  -- extraction rather than overwrite the old one, or the chunk provenance of
  -- everything already embedded silently changes meaning.
  extractor         text not null check (char_length(extractor) <= 64),
  extractor_version text not null check (char_length(extractor_version) <= 32),

  -- sha256 of the extracted text. Chunk-level dedup keys off chunk text, but
  -- this lets an unchanged re-extraction be recognised without re-chunking.
  text_sha256       text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  char_count        integer not null check (char_count >= 0),

  -- The extracted text itself. Kept in the row rather than object storage:
  -- government pages are tens of KB, it is read on every re-chunk, and TOAST
  -- already stores it out-of-line and compressed.
  text              text not null,

  -- BCP-47-ish, as detected. 'und' when detection was not confident — an
  -- honest "unknown" beats a guessed 'en' that then filters wrongly.
  language          text not null default 'und'
                    check (language ~ '^([a-z]{2}(-[A-Za-z]{2,4})?|und)$'),
  language_confidence numeric(3,2)
                    check (language_confidence is null
                           or (language_confidence >= 0 and language_confidence <= 1)),

  -- Whether OCR was used, and what it reported. OCR text is lower-trust and
  -- retrieval ranks it below natively-extracted text of equal similarity.
  ocr_applied       boolean not null default false,
  ocr_confidence    numeric(3,2)
                    check (ocr_confidence is null
                           or (ocr_confidence >= 0 and ocr_confidence <= 1)),

  page_count        integer check (page_count is null or page_count >= 0),
  table_count       integer not null default 0 check (table_count >= 0),

  -- Non-fatal problems the extractor wants a human to know about: a PDF whose
  -- text layer is partly missing, a table it could not resolve. Retrieval still
  -- serves the text; the admin surface shows the warning.
  warnings          text[] not null default '{}',

  created_at        timestamptz not null default now()
);

comment on table public.kb_extractions is
  'Clean text extracted from one official source version by one extractor '
  'version. Never updated in place: a parser change makes a new row so already-'
  'embedded chunks keep meaning what they meant when they were embedded.';

-- One extraction per (version, extractor, extractor version). Re-running the
-- same extractor on the same version is a no-op, which is what makes the
-- pipeline safe to retry.
create unique index if not exists kb_extractions_identity_idx
  on public.kb_extractions (source_version_id, extractor, extractor_version);
create index if not exists kb_extractions_text_sha_idx on public.kb_extractions (text_sha256);

-- ---------------------------------------------------------------------------
-- Document structure
-- ---------------------------------------------------------------------------

create table if not exists public.kb_sections (
  id             uuid primary key default gen_random_uuid(),
  extraction_id  uuid not null references public.kb_extractions on delete cascade,

  -- Reading order within the document.
  ordinal        integer not null check (ordinal >= 0),

  --   heading   a heading with no body of its own
  --   prose     ordinary body text
  --   list      a bulleted/numbered list, kept whole
  --   table     a table, serialised row-wise with its header repeated
  --   checklist a list the authority frames as required items
  --   figure    caption/figure text
  --   metadata  page furniture that survived stripping
  kind           text not null check (kind in
                   ('heading', 'prose', 'list', 'table', 'checklist', 'figure', 'metadata')),

  -- Full heading path from the document root: ['Eligibility','Who can apply'].
  -- Carried onto every chunk so a retrieved fragment can be re-sited in the
  -- document, and so "under which heading did this appear" is answerable — the
  -- difference between a requirement and an exception is often only that.
  heading_path   text[] not null default '{}',
  heading_level  smallint check (heading_level is null or heading_level between 1 and 6),

  -- 1-based page for paginated formats (PDF/DOCX). Null for HTML.
  page_number    integer check (page_number is null or page_number >= 1),

  -- Character offsets into kb_extractions.text, so a reviewer can jump to the
  -- exact span without re-running the extractor.
  char_start     integer not null check (char_start >= 0),
  char_end       integer not null check (char_end >= 0),
  constraint kb_sections_range check (char_end >= char_start),

  text           text not null,

  -- For kind='table': the header row, kept separately so every chunk cut from
  -- the table can repeat it. A table row without its header is a number with
  -- no unit, which is how a fee for one nationality gets quoted to another.
  table_header   text[],

  created_at     timestamptz not null default now()
);

comment on table public.kb_sections is
  'Structural decomposition of an extraction: headings, prose, lists and '
  'tables in reading order. Chunking cuts along these, never across them.';

create unique index if not exists kb_sections_order_idx
  on public.kb_sections (extraction_id, ordinal);
create index if not exists kb_sections_kind_idx on public.kb_sections (extraction_id, kind);

-- ---------------------------------------------------------------------------
-- Chunk text (deduplicated) + lexical index
-- ---------------------------------------------------------------------------

create table if not exists public.kb_chunk_texts (
  sha256      text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  text        text not null,
  char_count  integer not null check (char_count >= 0),
  -- Approximate; used for context budgeting, not billing.
  token_estimate integer not null check (token_estimate >= 0),

  -- 'simple' rather than 'english': the corpus is multilingual by definition,
  -- and an English stemmer applied to French or Arabic text does damage that a
  -- language-specific config would not. It also leaves official form codes
  -- ('IMM 5257', 'DS-160') as literal lexemes, which is what makes exact
  -- form-number search work.
  tsv         tsvector generated always as (to_tsvector('simple', text)) stored,

  created_at  timestamptz not null default now()
);

comment on table public.kb_chunk_texts is
  'One physical copy of every distinct chunk of text in the corpus. Shared '
  'boilerplate across hundreds of government pages costs one row and one '
  'embedding. tsvector config is deliberately `simple` — multilingual corpus, '
  'and form codes must survive as literal lexemes.';

create index if not exists kb_chunk_texts_tsv_idx on public.kb_chunk_texts using gin (tsv);
-- Trigram index for exact/near-exact form-code lookups that FTS tokenisation
-- can still split ('IMM5257' vs 'IMM 5257').
create extension if not exists pg_trgm with schema extensions;
create index if not exists kb_chunk_texts_trgm_idx
  on public.kb_chunk_texts using gin (text extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Chunk instances
-- ---------------------------------------------------------------------------

create table if not exists public.kb_chunks (
  id                uuid primary key default gen_random_uuid(),

  -- Provenance chain. Every one of these is NOT NULL on purpose: a chunk that
  -- cannot name the official version it came from is exactly the ungrounded
  -- content this system exists to prevent.
  extraction_id     uuid not null references public.kb_extractions on delete cascade,
  source_version_id uuid not null references public.visa_source_versions on delete cascade,
  source_id         uuid not null references public.visa_sources on delete cascade,
  section_id        uuid references public.kb_sections on delete set null,

  text_sha256       text not null references public.kb_chunk_texts on delete restrict,

  ordinal           integer not null check (ordinal >= 0),

  -- DENORMALISED FILTER COLUMNS.
  --
  -- These are derivable by joining through source -> country/visa_type, and
  -- they are copied here anyway. Retrieval filters on country and visa type on
  -- EVERY query — mixing two countries' requirements is the single worst
  -- failure this system can have — and a filter that costs a three-table join
  -- is a filter that gets pushed after ranking to make a query fast. Here it
  -- is an index scan, so the safe thing is also the fast thing.
  country_id        uuid not null references public.visa_countries on delete cascade,
  visa_type_id      uuid references public.visa_types on delete cascade,
  authority_rank    smallint not null check (authority_rank between 1 and 5),
  source_role       text not null,
  language          text not null default 'und',

  heading_path      text[] not null default '{}',
  page_number       integer check (page_number is null or page_number >= 1),
  section_kind      text,

  -- Official artifact codes detected in the chunk ('IMM 5257', 'DS-160').
  -- Extracted at chunk time so an exact-code query can filter rather than hope
  -- the lexical index tokenised it the same way the user typed it.
  form_codes        text[] not null default '{}',

  -- Effective window as the AUTHORITY states it, inherited from the version
  -- and overridden when the section itself carries a date.
  effective_from    date,
  effective_to      date,

  --   current      part of the active version of a live source
  --   superseded   its version was replaced by a newer one
  --   withdrawn    the source itself was removed/deprecated by the authority
  -- Retrieval defaults to `current` only. Superseded rows are kept because
  -- "what did the rule say in March" is a real question, and because deleting
  -- the only copy of a source we once served destroys the audit trail.
  status            text not null default 'current'
                    check (status in ('current', 'superseded', 'withdrawn')),
  superseded_at     timestamptz,
  superseded_by     uuid references public.kb_chunks on delete set null,

  -- Extraction confidence for this chunk (OCR quality, table-resolution
  -- certainty). Feeds ranking and the review threshold.
  confidence        numeric(3,2)
                    check (confidence is null or (confidence >= 0 and confidence <= 1)),

  created_at        timestamptz not null default now()
);

comment on table public.kb_chunks is
  'A retrievable fragment with full provenance and the filters retrieval needs '
  'in one row. country_id/visa_type_id are denormalised so jurisdiction '
  'isolation is an index scan and can never be optimised away.';

create unique index if not exists kb_chunks_identity_idx
  on public.kb_chunks (extraction_id, ordinal);
create index if not exists kb_chunks_text_sha_idx on public.kb_chunks (text_sha256);
-- The retrieval prefilter: current chunks for a destination, optionally a visa.
create index if not exists kb_chunks_scope_idx
  on public.kb_chunks (country_id, visa_type_id, status)
  where status = 'current';
create index if not exists kb_chunks_version_idx on public.kb_chunks (source_version_id);
create index if not exists kb_chunks_form_codes_idx on public.kb_chunks using gin (form_codes);
create index if not exists kb_chunks_source_idx on public.kb_chunks (source_id, status);

-- ---------------------------------------------------------------------------
-- Extra scope links for shared content
-- ---------------------------------------------------------------------------

create table if not exists public.kb_chunk_scopes (
  chunk_id     uuid not null references public.kb_chunks on delete cascade,
  country_id   uuid not null references public.visa_countries on delete cascade,
  visa_type_id uuid references public.visa_types on delete cascade,

  -- Why this chunk applies to a country other than the one that published it.
  --   bloc_member    a Schengen-wide rule applying to a member state
  --   shared_page    one authority page that covers several visa types
  --   mirrored       the same document republished by another authority
  reason       text not null check (reason in ('bloc_member', 'shared_page', 'mirrored')),

  created_at   timestamptz not null default now(),
  id           uuid primary key default gen_random_uuid()
);

-- A composite primary key cannot express "visa_type_id null means all routes"
-- because NULL is not comparable in a key. The uniqueness that actually
-- matters is expressed as an expression index instead, which does allow it.
create unique index if not exists kb_chunk_scopes_identity_idx
  on public.kb_chunk_scopes (
    chunk_id, country_id,
    coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

comment on table public.kb_chunk_scopes is
  'Additional (country, visa type) applicability for a chunk whose publishing '
  'country is not the only one it governs — Schengen rules, shared pages. '
  'Reference, never duplication: the chunk text is stored once.';

create index if not exists kb_chunk_scopes_lookup_idx
  on public.kb_chunk_scopes (country_id, visa_type_id);

-- ---------------------------------------------------------------------------
-- Embeddings
-- ---------------------------------------------------------------------------

create table if not exists public.kb_embeddings (
  text_sha256 text not null references public.kb_chunk_texts on delete cascade,

  -- The exact provider model id ('text-embedding-3-small'). NOT a tier: an
  -- upgrade must be a new row set, comparable side by side, and rolled back by
  -- switching which model retrieval reads.
  model       text not null check (char_length(model) <= 100),
  dimensions  smallint not null check (dimensions between 1 and 2000),

  -- 1536 covers text-embedding-3-small/large-truncated and most open models.
  -- A model with a different native width is stored truncated-and-renormalised
  -- by the provider adapter; `dimensions` records what was actually written.
  embedding   extensions.vector(1536) not null,

  created_at  timestamptz not null default now(),

  -- ONE vector per (text, model). This primary key is the whole of requirement
  -- "no duplicate embeddings for identical chunks using the same model".
  primary key (text_sha256, model)
);

comment on table public.kb_embeddings is
  'One vector per distinct chunk text per embedding model version. Keyed by '
  'text hash, not chunk id, so N provenance records over identical text cost '
  'one embedding.';

-- HNSW over cosine distance. Built per-model would be ideal but pgvector
-- indexes the column, not a partition of it; the model filter is applied in
-- the query and the corpus is small enough (10^4-10^5 vectors) that the
-- residual scan is not the bottleneck.
create index if not exists kb_embeddings_hnsw_idx
  on public.kb_embeddings using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists kb_embeddings_model_idx on public.kb_embeddings (model);

-- ---------------------------------------------------------------------------
-- Ingestion jobs
-- ---------------------------------------------------------------------------

create table if not exists public.kb_ingestion_jobs (
  id            uuid primary key default gen_random_uuid(),

  -- IDEMPOTENCY KEY. Derived from what the job is about, not when it ran:
  -- 'ingest:<source_version_id>:<extractor_version>'. Re-enqueuing the same
  -- work finds this row instead of doing it twice, which is what makes the
  -- BullMQ retry policy safe on a pipeline that writes.
  idempotency_key text not null,

  source_id     uuid references public.visa_sources on delete cascade,
  source_version_id uuid references public.visa_source_versions on delete cascade,

  kind          text not null check (kind in
                  ('discover', 'fetch', 'extract', 'chunk', 'embed', 'reindex', 'sweep')),

  state         text not null default 'queued'
                check (state in ('queued', 'running', 'succeeded', 'failed', 'skipped', 'quarantined')),

  attempt       integer not null default 0 check (attempt >= 0),
  max_attempts  integer not null default 3 check (max_attempts >= 1),

  -- Resume point for a job that processes many units. A backfill killed at
  -- unit 4,000 of 12,000 restarts at 4,000, not at 0.
  checkpoint    jsonb not null default '{}'::jsonb,

  stats         jsonb not null default '{}'::jsonb,
  error_message text check (char_length(error_message) <= 4000),

  run_id        uuid,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.kb_ingestion_jobs is
  'One row per unit of ingestion work, keyed by an idempotency key derived '
  'from its subject. Retries and re-enqueues converge on the same row rather '
  'than duplicating work or double-writing chunks.';

create unique index if not exists kb_ingestion_jobs_idem_idx
  on public.kb_ingestion_jobs (idempotency_key);
create index if not exists kb_ingestion_jobs_state_idx
  on public.kb_ingestion_jobs (state, created_at) where state in ('queued', 'running', 'failed');
create index if not exists kb_ingestion_jobs_source_idx
  on public.kb_ingestion_jobs (source_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Freshness policies
-- ---------------------------------------------------------------------------

create table if not exists public.kb_freshness_policies (
  id            uuid primary key default gen_random_uuid(),

  -- What the policy applies to, most specific wins:
  --   source_role  'fees', 'forms', 'policy' ...
  --   country_id   a jurisdiction that changes unusually fast or slow
  --   visa_type_id a single route under active reform
  -- All three null = the corpus default. Exactly one default row is enforced.
  source_role   text,
  country_id    uuid references public.visa_countries on delete cascade,
  visa_type_id  uuid references public.visa_types on delete cascade,

  --   volatile   fees, forms, temporary measures, processing instructions
  --   standard   ordinary visa guidance
  --   stable     legislation, archived manuals
  risk_class    text not null check (risk_class in ('volatile', 'standard', 'stable')),

  check_interval interval not null,
  -- Past this age the corpus reports the source stale and answers built on it
  -- carry a staleness warning rather than silently serving old law.
  staleness_sla interval not null,

  -- Whether a material change on this class may auto-promote, or always needs
  -- a human. Fees and forms never auto-promote regardless of this flag; see
  -- the check below.
  auto_promote  boolean not null default false,
  constraint kb_freshness_no_autopromote_volatile check (
    risk_class <> 'volatile' or auto_promote = false
  ),

  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.kb_freshness_policies is
  'Per-risk-class recheck cadence and staleness SLA. Volatile classes (fees, '
  'forms, temporary measures) are structurally barred from auto-promotion.';

create unique index if not exists kb_freshness_default_idx
  on public.kb_freshness_policies ((true))
  where source_role is null and country_id is null and visa_type_id is null and active;
create index if not exists kb_freshness_lookup_idx
  on public.kb_freshness_policies (country_id, visa_type_id, source_role) where active;

-- One policy per scope. NULLS NOT DISTINCT is what makes the seed below
-- re-runnable: without it two identical role-only rows are both "unique"
-- because their country_id nulls never compare equal.
create unique index if not exists kb_freshness_scope_idx
  on public.kb_freshness_policies (source_role, country_id, visa_type_id)
  nulls not distinct;

-- ---------------------------------------------------------------------------
-- Quarantine
-- ---------------------------------------------------------------------------

create table if not exists public.kb_quarantine (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid references public.visa_sources on delete cascade,
  source_version_id uuid references public.visa_source_versions on delete cascade,
  blob_sha256   text references public.kb_blobs on delete set null,

  --   extraction_failed   the extractor produced nothing usable
  --   mime_mismatch       sniffed type contradicts the declared type
  --   oversize            beyond the download ceiling
  --   suspicious_content  active content / injection markers in a document
  --   encrypted           password-protected file
  --   low_confidence      OCR or table resolution below threshold
  reason        text not null check (reason in
                  ('extraction_failed', 'mime_mismatch', 'oversize',
                   'suspicious_content', 'encrypted', 'low_confidence')),

  detail        text check (char_length(detail) <= 4000),
  -- Redacted sample of what tripped it, capped. Never the whole document: a
  -- quarantine record is a signal, not a second copy of the payload.
  sample        text check (char_length(sample) <= 2000),

  resolved      boolean not null default false,
  resolved_by   uuid references auth.users on delete set null,
  resolved_at   timestamptz,
  resolution_note text check (char_length(resolution_note) <= 2000),

  created_at    timestamptz not null default now()
);

comment on table public.kb_quarantine is
  'Content the pipeline refused to index, and why. A quarantined version never '
  'reaches retrieval; it reaches an admin.';

create index if not exists kb_quarantine_open_idx
  on public.kb_quarantine (created_at desc) where not resolved;

-- ---------------------------------------------------------------------------
-- Retrieval logs
-- ---------------------------------------------------------------------------

create table if not exists public.kb_retrieval_logs (
  id            uuid primary key default gen_random_uuid(),

  -- Null for system/eval queries. Owner-scoped under RLS when set: a retrieval
  -- log records what a person asked, which is personal even though everything
  -- retrieved is public.
  user_id       uuid references auth.users on delete cascade,
  application_id uuid,

  -- The query as normalised for search, NOT necessarily as typed. The raw
  -- question can carry identity details; retention rules apply either way.
  query_text    text not null check (char_length(query_text) <= 2000),
  query_hash    text not null check (query_hash ~ '^[0-9a-f]{64}$'),

  country_id    uuid references public.visa_countries on delete set null,
  visa_type_id  uuid references public.visa_types on delete set null,
  filters       jsonb not null default '{}'::jsonb,

  strategy      text not null check (strategy in ('vector', 'lexical', 'hybrid', 'form_code')),
  embedding_model text,

  candidate_count integer not null default 0 check (candidate_count >= 0),
  returned_count  integer not null default 0 check (returned_count >= 0),
  top_score       numeric(6,4),

  -- Chunk ids in returned order, so a benchmark run can be replayed and scored
  -- without re-running retrieval.
  returned_chunk_ids uuid[] not null default '{}',

  cache_hit     boolean not null default false,
  latency_ms    integer check (latency_ms is null or latency_ms >= 0),
  -- Whether the caller found sufficient evidence, or refused to answer.
  outcome       text not null default 'answered'
                check (outcome in ('answered', 'insufficient_evidence', 'conflicting', 'error')),

  created_at    timestamptz not null default now()
);

comment on table public.kb_retrieval_logs is
  'Every retrieval, with its filters, strategy and result ids. The evaluation '
  'harness and the relevance dashboard both read this. Owner-scoped: it '
  'records what a person asked.';

create index if not exists kb_retrieval_logs_user_idx
  on public.kb_retrieval_logs (user_id, created_at desc) where user_id is not null;
create index if not exists kb_retrieval_logs_time_idx on public.kb_retrieval_logs (created_at desc);
create index if not exists kb_retrieval_logs_scope_idx
  on public.kb_retrieval_logs (country_id, visa_type_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Answer citations
-- ---------------------------------------------------------------------------

create table if not exists public.kb_answer_citations (
  id            uuid primary key default gen_random_uuid(),
  retrieval_id  uuid not null references public.kb_retrieval_logs on delete cascade,

  chunk_id      uuid not null references public.kb_chunks on delete restrict,
  source_version_id uuid not null references public.visa_source_versions on delete restrict,

  -- Which claim in the answer this citation backs. 0-based index into the
  -- answer's claim list, so "which sentence was unsupported" is answerable.
  claim_index   integer not null check (claim_index >= 0),
  claim_text    text not null check (char_length(claim_text) <= 2000),

  -- The exact quoted span from the chunk that supports the claim. If the
  -- generator cannot produce one, the claim is not citable and must not ship.
  supporting_quote text check (char_length(supporting_quote) <= 2000),

  citation_url  text not null,
  authority     text not null,
  page_number   integer,
  -- Denormalised so a stored answer can render "last checked" without a join
  -- to a version that may later be superseded.
  last_checked_at timestamptz,

  created_at    timestamptz not null default now()
);

comment on table public.kb_answer_citations is
  'Claim-level citations for a generated answer. One row per (claim, source). '
  'A claim with no row here is an unsupported claim, and the generator is '
  'required to drop it.';

create index if not exists kb_answer_citations_retrieval_idx
  on public.kb_answer_citations (retrieval_id, claim_index);
create index if not exists kb_answer_citations_chunk_idx on public.kb_answer_citations (chunk_id);

-- ---------------------------------------------------------------------------
-- Review queue
-- ---------------------------------------------------------------------------

create table if not exists public.kb_review_queue (
  id            uuid primary key default gen_random_uuid(),

  --   coverage_gap        a supported visa type with no indexed source
  --   stale_source        past its staleness SLA
  --   extraction_warning  indexed, but the extractor flagged something
  --   material_change     a semantic diff a human must sign off
  --   conflicting_sources two official sources disagree
  --   low_citation        answers on this scope keep coming back uncited
  --   broken_url          the source no longer resolves
  kind          text not null check (kind in
                  ('coverage_gap', 'stale_source', 'extraction_warning',
                   'material_change', 'conflicting_sources', 'low_citation', 'broken_url')),

  severity      text not null default 'medium'
                check (severity in ('low', 'medium', 'high', 'critical')),

  country_id    uuid references public.visa_countries on delete cascade,
  visa_type_id  uuid references public.visa_types on delete cascade,
  source_id     uuid references public.visa_sources on delete cascade,
  source_change_id uuid references public.visa_source_changes on delete cascade,

  title         text not null check (char_length(title) <= 300),
  detail        text check (char_length(detail) <= 8000),
  evidence      jsonb not null default '{}'::jsonb,

  -- The same open item detected on two consecutive sweeps must update one row,
  -- not create a second. Derived from kind + scope.
  dedupe_key    text not null,

  state         text not null default 'open'
                check (state in ('open', 'acknowledged', 'resolved', 'dismissed')),
  assigned_to   uuid references auth.users on delete set null,
  resolved_by   uuid references auth.users on delete set null,
  resolved_at   timestamptz,
  resolution_note text check (char_length(resolution_note) <= 4000),

  occurrences   integer not null default 1 check (occurrences >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.kb_review_queue is
  'Human review tasks raised by the knowledge layer. dedupe_key collapses a '
  'recurring finding into one row with an occurrence count so a persistent '
  'gap does not become a thousand tickets.';

create unique index if not exists kb_review_queue_open_dedupe_idx
  on public.kb_review_queue (dedupe_key) where state in ('open', 'acknowledged');
create index if not exists kb_review_queue_triage_idx
  on public.kb_review_queue (state, severity, last_seen_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers, matching the registry's convention
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  -- visa_registry_touch_updated_at() is created by the registry core migration
  -- and is the convention these tables follow. If a future refactor renames it
  -- this block must fail loudly rather than leave half the tables without the
  -- trigger.
  if not exists (select 1 from pg_proc where proname = 'visa_registry_touch_updated_at') then
    raise exception 'visa_registry_touch_updated_at() missing — cannot attach updated_at triggers';
  end if;

  foreach t in array array[
    'kb_ingestion_jobs', 'kb_freshness_policies', 'kb_review_queue'
  ] loop
    execute format(
      'drop trigger if exists %I on public.%I', 'set_' || t || '_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.visa_registry_touch_updated_at()',
      'set_' || t || '_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Hybrid retrieval
-- ---------------------------------------------------------------------------
--
-- Reciprocal Rank Fusion of a vector search and a lexical search, with the
-- jurisdiction filter applied INSIDE both arms rather than after the union.
--
-- Why RRF and not a weighted score blend: cosine similarity and ts_rank are on
-- incomparable scales, and their distributions shift with corpus size and
-- query length. Blending them requires a normalisation constant that has to be
-- retuned every time the corpus grows. RRF only reads RANK, so it needs no
-- tuning and cannot be silently miscalibrated by a corpus change.
--
-- Why the filter is inside each arm: a top-k vector search over the whole
-- corpus followed by a country filter returns k results of which zero may be
-- for the requested country. Filtering first means k results for the right
-- country, which is the only correct behaviour when the failure mode is
-- quoting another country's rules.
create or replace function public.kb_search_hybrid(
  p_query_text     text,
  p_query_embedding extensions.vector(1536),
  p_embedding_model text,
  p_country_id     uuid default null,
  p_visa_type_id   uuid default null,
  p_languages      text[] default null,
  p_form_codes     text[] default null,
  p_include_superseded boolean default false,
  p_as_of          date default null,
  p_limit          integer default 20,
  p_candidate_limit integer default 100,
  p_rrf_k          integer default 60
)
returns table (
  chunk_id          uuid,
  text_sha256       text,
  chunk_text        text,
  score             double precision,
  vector_rank       integer,
  lexical_rank      integer,
  vector_similarity double precision,
  lexical_score     double precision,
  country_id        uuid,
  visa_type_id      uuid,
  source_id         uuid,
  source_version_id uuid,
  authority_rank    smallint,
  source_role       text,
  language          text,
  heading_path      text[],
  page_number       integer,
  form_codes        text[],
  status            text,
  effective_from    date,
  effective_to      date
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with scoped as (
    -- The candidate set. Every filter that decides CORRECTNESS lives here, so
    -- neither ranking arm can widen it.
    select c.*
    from public.kb_chunks c
    where (p_include_superseded or c.status = 'current')
      and (
        p_country_id is null
        or c.country_id = p_country_id
        or exists (
          select 1 from public.kb_chunk_scopes s
          where s.chunk_id = c.id
            and s.country_id = p_country_id
            and (p_visa_type_id is null or s.visa_type_id is null or s.visa_type_id = p_visa_type_id)
        )
      )
      -- A country-level chunk (visa_type_id null) is in scope for every visa of
      -- that country: "you need a valid passport" is published once on the
      -- authority's index page and governs every route beneath it.
      and (p_visa_type_id is null or c.visa_type_id is null or c.visa_type_id = p_visa_type_id)
      and (p_languages is null or c.language = any(p_languages) or c.language = 'und')
      and (p_form_codes is null or c.form_codes && p_form_codes)
      and (p_as_of is null
           or ((c.effective_from is null or c.effective_from <= p_as_of)
               and (c.effective_to is null or c.effective_to >= p_as_of)))
  ),
  vec as (
    select
      s.id as chunk_id,
      row_number() over (order by e.embedding <=> p_query_embedding) as rnk,
      1 - (e.embedding <=> p_query_embedding) as sim
    from scoped s
    join public.kb_embeddings e
      on e.text_sha256 = s.text_sha256 and e.model = p_embedding_model
    where p_query_embedding is not null
    order by e.embedding <=> p_query_embedding
    limit p_candidate_limit
  ),
  lex as (
    select
      s.id as chunk_id,
      row_number() over (
        order by ts_rank_cd(t.tsv, websearch_to_tsquery('simple', p_query_text)) desc
      ) as rnk,
      ts_rank_cd(t.tsv, websearch_to_tsquery('simple', p_query_text)) as score
    from scoped s
    join public.kb_chunk_texts t on t.sha256 = s.text_sha256
    where p_query_text is not null
      and p_query_text <> ''
      and t.tsv @@ websearch_to_tsquery('simple', p_query_text)
    order by 3 desc
    limit p_candidate_limit
  ),
  fused as (
    select
      coalesce(v.chunk_id, l.chunk_id) as chunk_id,
      coalesce(1.0 / (p_rrf_k + v.rnk), 0)
        + coalesce(1.0 / (p_rrf_k + l.rnk), 0) as rrf,
      v.rnk::integer as vrank,
      l.rnk::integer as lrank,
      v.sim,
      l.score
    from vec v
    full outer join lex l on l.chunk_id = v.chunk_id
  )
  select
    c.id,
    c.text_sha256,
    t.text,
    -- Authority rank is a tie-break multiplier, not a term added to the fused
    -- score: an immigration department's page and a consulate's page saying
    -- the same thing should rank in that order, but authority must never
    -- promote a badly-matching passage over a well-matching one.
    (f.rrf * (1.0 + (5 - c.authority_rank) * 0.01))::double precision,
    f.vrank,
    f.lrank,
    f.sim::double precision,
    f.score::double precision,
    c.country_id,
    c.visa_type_id,
    c.source_id,
    c.source_version_id,
    c.authority_rank,
    c.source_role,
    c.language,
    c.heading_path,
    c.page_number,
    c.form_codes,
    c.status,
    c.effective_from,
    c.effective_to
  from fused f
  join public.kb_chunks c on c.id = f.chunk_id
  join public.kb_chunk_texts t on t.sha256 = c.text_sha256
  order by 4 desc, c.authority_rank asc, c.id
  limit p_limit;
$$;

comment on function public.kb_search_hybrid is
  'Hybrid vector + lexical retrieval with jurisdiction filtering applied '
  'inside both arms and Reciprocal Rank Fusion over the two rankings.';

-- Storage/dedup accounting for the admin surface. A view rather than a
-- materialised rollup: it is read by one dashboard, not by a request path.
create or replace view public.kb_storage_stats
with (security_invoker = true) as
select
  (select count(*) from public.kb_blobs)                                as blob_count,
  (select coalesce(sum(byte_size), 0) from public.kb_blobs)             as blob_logical_bytes,
  (select coalesce(sum(coalesce(stored_bytes, byte_size)), 0)
     from public.kb_blobs)                                              as blob_stored_bytes,
  (select count(*) from public.kb_chunks)                               as chunk_count,
  (select count(*) from public.kb_chunk_texts)                          as distinct_chunk_texts,
  (select count(*) from public.kb_embeddings)                           as embedding_count,
  (select count(distinct model) from public.kb_embeddings)              as embedding_models,
  (select coalesce(sum(char_count), 0) from public.kb_chunk_texts)      as distinct_chunk_chars,
  (select coalesce(sum(t.char_count), 0)
     from public.kb_chunks c join public.kb_chunk_texts t on t.sha256 = c.text_sha256)
                                                                        as naive_chunk_chars;

comment on view public.kb_storage_stats is
  'Corpus size and the deduplication saving: naive_chunk_chars is what the '
  'corpus would occupy if every chunk instance stored its own text.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- The corpus is government reference text and is readable by anon, exactly
-- like visa_requirements, so public visa pages can quote and cite it. The
-- operational tables (jobs, quarantine, review queue, freshness policy) are
-- authenticated-read. kb_retrieval_logs is OWNER-scoped — the only table here
-- carrying anything personal.
--
-- No policy grants INSERT/UPDATE/DELETE to any role. Writes come from the
-- service-role ingestion worker.

alter table public.kb_blobs             enable row level security;
alter table public.kb_extractions       enable row level security;
alter table public.kb_sections          enable row level security;
alter table public.kb_chunk_texts       enable row level security;
alter table public.kb_chunks            enable row level security;
alter table public.kb_chunk_scopes      enable row level security;
alter table public.kb_embeddings        enable row level security;
alter table public.kb_ingestion_jobs    enable row level security;
alter table public.kb_freshness_policies enable row level security;
alter table public.kb_quarantine        enable row level security;
alter table public.kb_retrieval_logs    enable row level security;
alter table public.kb_answer_citations  enable row level security;
alter table public.kb_review_queue      enable row level security;

-- Corpus: public read of CURRENT content only for anon. Superseded text is
-- history for staff, not something a crawler should index as if it were law.
drop policy if exists kb_chunks_public_read on public.kb_chunks;
create policy kb_chunks_public_read on public.kb_chunks
  for select to anon using (status = 'current');
drop policy if exists kb_chunks_staff_read on public.kb_chunks;
create policy kb_chunks_staff_read on public.kb_chunks
  for select to authenticated using (true);

drop policy if exists kb_chunk_texts_read on public.kb_chunk_texts;
create policy kb_chunk_texts_read on public.kb_chunk_texts
  for select to anon, authenticated using (true);

drop policy if exists kb_chunk_scopes_read on public.kb_chunk_scopes;
create policy kb_chunk_scopes_read on public.kb_chunk_scopes
  for select to anon, authenticated using (true);

drop policy if exists kb_sections_read on public.kb_sections;
create policy kb_sections_read on public.kb_sections
  for select to authenticated using (true);

drop policy if exists kb_extractions_read on public.kb_extractions;
create policy kb_extractions_read on public.kb_extractions
  for select to authenticated using (true);

drop policy if exists kb_blobs_read on public.kb_blobs;
create policy kb_blobs_read on public.kb_blobs
  for select to authenticated using (true);

-- Embeddings are not readable by anyone but the service role. They are a
-- lossy but non-trivial reconstruction surface for the corpus and have no
-- client-side use: retrieval happens server-side through kb_search_hybrid.
-- (RLS enabled above with no SELECT policy = deny for anon/authenticated.)

drop policy if exists kb_ingestion_jobs_read on public.kb_ingestion_jobs;
create policy kb_ingestion_jobs_read on public.kb_ingestion_jobs
  for select to authenticated using (true);

drop policy if exists kb_freshness_policies_read on public.kb_freshness_policies;
create policy kb_freshness_policies_read on public.kb_freshness_policies
  for select to authenticated using (true);

drop policy if exists kb_quarantine_read on public.kb_quarantine;
create policy kb_quarantine_read on public.kb_quarantine
  for select to authenticated using (true);

drop policy if exists kb_review_queue_read on public.kb_review_queue;
create policy kb_review_queue_read on public.kb_review_queue
  for select to authenticated using (true);

-- Owner-scoped. A retrieval log with a null user_id is a system/eval query and
-- is not readable by any end user.
drop policy if exists kb_retrieval_logs_own_read on public.kb_retrieval_logs;
create policy kb_retrieval_logs_own_read on public.kb_retrieval_logs
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists kb_answer_citations_own_read on public.kb_answer_citations;
create policy kb_answer_citations_own_read on public.kb_answer_citations
  for select to authenticated using (
    exists (
      select 1 from public.kb_retrieval_logs l
      where l.id = kb_answer_citations.retrieval_id
        and l.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Function exposure
-- ---------------------------------------------------------------------------
-- kb_search_hybrid is SECURITY INVOKER and reads only tables whose RLS already
-- permits the caller, so exposing it to authenticated is safe and is how the
-- API calls it. anon does not get it: an unauthenticated caller can read the
-- corpus through PostgREST but must not be able to run a similarity search
-- with an attacker-supplied vector at anon rate limits.
revoke all on function public.kb_search_hybrid(
  text, extensions.vector, text, uuid, uuid, text[], text[], boolean, date, integer, integer, integer
) from public, anon;
grant execute on function public.kb_search_hybrid(
  text, extensions.vector, text, uuid, uuid, text[], text[], boolean, date, integer, integer, integer
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Default freshness policies
-- ---------------------------------------------------------------------------
-- Seeded, not hard-coded in the worker, so an operator can retune cadence
-- without a deploy. The role-specific rows encode the risk ordering the spec
-- requires: fees and forms change without announcement, policy pages do not.

insert into public.kb_freshness_policies
  (source_role, risk_class, check_interval, staleness_sla, auto_promote)
values
  (null,               'standard', interval '1 day',   interval '30 days', false),
  ('fees',             'volatile', interval '6 hours', interval '7 days',  false),
  ('forms',            'volatile', interval '6 hours', interval '7 days',  false),
  ('processing_times', 'volatile', interval '12 hours',interval '14 days', false),
  ('application',      'volatile', interval '12 hours',interval '14 days', false),
  ('eligibility',      'standard', interval '1 day',   interval '30 days', false),
  ('requirements',     'standard', interval '1 day',   interval '30 days', false),
  ('documents',        'standard', interval '1 day',   interval '30 days', false),
  -- News/announcement pages change constantly and are the earliest signal a
  -- rule is about to move, so they are checked as often as fees. They do NOT
  -- auto-promote: an announcement is exactly the kind of change a human should
  -- read before it reshapes a requirement.
  ('news',             'volatile', interval '6 hours', interval '7 days',  false),
  ('landing',          'standard', interval '3 days',  interval '45 days', true),
  ('index',            'standard', interval '3 days',  interval '45 days', true),
  ('policy',           'stable',   interval '7 days',  interval '180 days', true)
on conflict (source_role, country_id, visa_type_id) do nothing;

-- ---------------------------------------------------------------------------
-- Post-conditions
-- ---------------------------------------------------------------------------
-- A migration that half-applies is worse than one that fails, and the registry
-- migrations in this repo establish the convention of asserting the end state.

do $$
declare
  missing text[];
  t text;
begin
  foreach t in array array[
    'kb_blobs','kb_extractions','kb_sections','kb_chunk_texts','kb_chunks',
    'kb_chunk_scopes','kb_embeddings','kb_ingestion_jobs','kb_freshness_policies',
    'kb_quarantine','kb_retrieval_logs','kb_answer_citations','kb_review_queue'
  ] loop
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      missing := missing || t;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception 'knowledge layer incomplete, missing: %', missing;
  end if;

  if not exists (select 1 from pg_proc where proname = 'kb_search_hybrid') then
    raise exception 'kb_search_hybrid() was not created';
  end if;

  if (select count(*) from public.kb_freshness_policies) < 12 then
    raise exception 'freshness policies did not seed (found %)',
      (select count(*) from public.kb_freshness_policies);
  end if;

  -- The guarantee that private applicant documents cannot enter the corpus.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'kb_chunks'
      and column_name = 'source_version_id' and is_nullable = 'YES'
  ) then
    raise exception 'kb_chunks.source_version_id must be NOT NULL';
  end if;
end $$;
