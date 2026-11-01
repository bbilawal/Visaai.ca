-- Canonical visa data model: country registry, visa catalog, official-source
-- provenance and versioning.
--
-- WHAT THIS REPLACES
--
-- Before this migration the entire notion of "which countries and visas does
-- VisaAI support" lived in TypeScript under apps/api/src/strategies: four
-- hand-written country strategy classes, a Schengen member array, and six visa
-- program classes. The only visa-requirement table in the database,
-- public.country_frameworks, ships exactly one seeded row (CA/TRV/tourism,
-- 20260531000000_initial_schema.sql:255) and stores its requirements as an
-- untyped blob in requirements_json.
--
-- Three things were impossible in that shape and are the reason for this table
-- set:
--
--   1. Provenance. Nothing recorded WHERE a requirement came from, so no
--      requirement could be traced to the government page that mandates it,
--      and no page could show a defensible "last verified" date.
--   2. Versioning. When a government replaces a form or changes a rule, the
--      old text was simply gone. There was no history to diff against, so no
--      change could be detected, classified or reviewed before going live.
--   3. Query. A country/visa catalog expressed as classes cannot be joined,
--      counted, validated in SQL, or turned into public pages.
--
-- country_frameworks is intentionally LEFT IN PLACE and untouched. Live code
-- paths read it (intake/graphs/nodes/load-framework.ts, forms/form-catalog.ts,
-- vri/graphs/nodes/load-vri-data.ts, matching, billing). Migrating those
-- readers is a separate, staged change; breaking them here would take the
-- product down for a schema improvement. This migration is purely additive.
--
-- WRITE MODEL
--
-- Every table here is service-role-write / authenticated-or-anon-read. These
-- are government facts, not user data: no row is owned by a user, and the
-- public visa pages must be able to read them unauthenticated. Writes come
-- from migrations, the sync job, and admin review actions — never from a user
-- session. RLS denies by default and no policy grants INSERT/UPDATE/DELETE.

-- ---------------------------------------------------------------------------
-- Country registry
-- ---------------------------------------------------------------------------

create table if not exists public.visa_countries (
  id                    uuid primary key default gen_random_uuid(),

  -- ISO 3166-1 alpha-2 for states. Blocs that issue a shared authorization but
  -- are not an ISO country (the Schengen area) use an uppercase pseudo-code,
  -- which is why this is not constrained to exactly 2 characters. is_bloc
  -- distinguishes them so callers never treat SCHENGEN as a nationality.
  code                  text not null check (code = upper(code) and char_length(code) between 2 and 12),
  is_bloc               boolean not null default false,

  -- Canonical English name, and the slug used in public URLs (/visas/{slug}).
  -- The slug is stored rather than derived so a rename never breaks a live URL.
  name                  text not null check (char_length(name) between 1 and 120),
  slug                  text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- Localized display names keyed by locale ({"fr": "Canada", "ar": "..."}).
  -- jsonb rather than a side table: this is display chrome read on every page
  -- render, never joined or filtered on.
  localized_names       jsonb not null default '{}'::jsonb,

  -- The authority that decides visas, and (where different) the ministry that
  -- runs consular services. Names are as the government writes them.
  immigration_authority text check (char_length(immigration_authority) <= 200),
  immigration_authority_url text,
  foreign_affairs_authority text check (char_length(foreign_affairs_authority) <= 200),
  foreign_affairs_authority_url text,

  -- Official portals. official_visa_url is the government's own "find a visa"
  -- index; evisa_portal_url is the eTA/ESTA/ETA-style authorization portal
  -- where one exists. Null means "this government does not publish one", which
  -- is a fact, not a gap.
  official_visa_url     text,
  evisa_portal_url      text,

  -- Languages the authority publishes in, ISO 639-1. Drives which source
  -- language a requirement was read in.
  official_languages    text[] not null default '{}',

  -- Currency of government fees, ISO 4217. Fees are quoted in the currency the
  -- authority charges in; converting them would make VisaAI the source of a
  -- number the government never published.
  fee_currency          text check (fee_currency is null or fee_currency ~ '^[A-Z]{3}$'),

  --   supported   VisaAI has verified data and serves this destination
  --   preview     data exists but is incomplete; not offered in the picker
  --   unsupported explicitly out of scope
  support_state         text not null default 'preview'
                        check (support_state in ('supported', 'preview', 'unsupported')),

  --   verified    every linked source was reachable and re-read
  --   stale       past its freshness SLA
  --   unverified  never checked
  --   failing     last check errored
  data_quality          text not null default 'unverified'
                        check (data_quality in ('verified', 'stale', 'unverified', 'failing')),

  last_verified_at      timestamptz,

  -- Free-text provenance note for jurisdictions whose classification is
  -- contested. VisaAI models the ENTRY RULE as the controlling authority
  -- publishes it and makes no sovereignty claim; this column records that
  -- framing so it is visible rather than implied.
  jurisdiction_note     text check (char_length(jurisdiction_note) <= 1000),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.visa_countries is
  'Canonical destination registry: one row per country or bloc VisaAI can '
  'serve, with its immigration authority and official portals. Government '
  'reference data — never user-owned. Service-role write only.';

create unique index if not exists visa_countries_code_idx on public.visa_countries (code);
create unique index if not exists visa_countries_slug_idx on public.visa_countries (slug);
create index if not exists visa_countries_support_idx
  on public.visa_countries (support_state) where support_state = 'supported';

-- ---------------------------------------------------------------------------
-- Visa catalog
-- ---------------------------------------------------------------------------

create table if not exists public.visa_types (
  id               uuid primary key default gen_random_uuid(),
  country_id       uuid not null references public.visa_countries on delete cascade,

  -- Stable, human-readable, immutable identifier used by code, tests, fixtures
  -- and public URLs: 'au-visitor-600', 'gb-standard-visitor'. Deliberately not
  -- the uuid: a uuid in a URL or a test fixture tells a reader nothing, and
  -- re-seeding must not churn identifiers that pages are indexed under.
  visaai_id        text not null check (visaai_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- VisaAI's normalized bucket, used for cross-country comparison and to map
  -- to the existing strategies/visa-program classes. The check list is
  -- deliberately broad but CLOSED: adding a category is a migration, which
  -- forces the question "does an authority actually offer this?" to be
  -- answered once rather than per-row.
  category         text not null check (category in (
                     'visitor', 'tourism', 'business', 'transit', 'student',
                     'work', 'skilled_worker', 'temporary_worker',
                     'seasonal_work', 'working_holiday', 'youth_mobility',
                     'digital_nomad', 'investor', 'entrepreneur', 'family',
                     'spouse_partner', 'parent', 'dependant',
                     'family_reunification', 'research', 'academic',
                     'exchange', 'medical', 'religious', 'volunteer',
                     'diplomatic', 'official', 'media', 'crew', 'performer',
                     'cultural_sport', 'humanitarian', 'permanent_residence',
                     'evisa', 'eta', 'other')),

  -- The name EXACTLY as the authority writes it, e.g.
  -- 'Visitor visa (subclass 600)'. This is quoted to users, so it must never
  -- be a VisaAI paraphrase.
  official_name    text not null check (char_length(official_name) between 1 and 250),

  -- Official subclass / stream / class code where the authority publishes one
  -- ('600', 'B-1/B-2'). Null where none exists — Canada does not number its
  -- temporary resident visa, and inventing a code would be fabrication.
  official_code    text check (char_length(official_code) <= 64),
  official_stream  text check (char_length(official_stream) <= 120),

  -- URL slug, unique within the country: /visas/{country.slug}/{slug}.
  slug             text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- Search terms and colloquialisms ('tourist visa', 'B2'). Powers on-site
  -- search and alias redirects; NOT indexed as separate pages.
  aliases          text[] not null default '{}',

  -- What the visa is FOR, in the authority's framing, and the authority's own
  -- description. official_description is quoted government text; when we
  -- cannot quote it, it stays null rather than being paraphrased into a fact.
  purpose          text check (char_length(purpose) <= 500),
  official_description text,

  --   active        currently offered
  --   discontinued  the authority has withdrawn it (kept for history + SEO)
  --   proposed      announced but not yet open
  lifecycle_state  text not null default 'active'
                   check (lifecycle_state in ('active', 'discontinued', 'proposed')),
  effective_from   date,
  effective_to     date,
  constraint visa_types_effective_range check (
    effective_from is null or effective_to is null or effective_to >= effective_from
  ),

  --   Maps to strategies/visa-program/*.strategy.ts so the existing pipeline
  --   can resolve a catalog row to its runtime strategy. Null = no strategy
  --   implemented yet, which is exactly what "we list it but cannot process it"
  --   should look like.
  program_id       text check (char_length(program_id) <= 64),

  last_verified_at timestamptz,
  data_quality     text not null default 'unverified'
                   check (data_quality in ('verified', 'stale', 'unverified', 'failing')),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.visa_types is
  'Per-destination catalog of visa, permit and entry-authorization categories '
  'as the issuing authority defines them. official_name/official_code are '
  'government wording and must never be paraphrased.';

create unique index if not exists visa_types_visaai_id_idx on public.visa_types (visaai_id);
create unique index if not exists visa_types_country_slug_idx on public.visa_types (country_id, slug);
create index if not exists visa_types_country_active_idx
  on public.visa_types (country_id) where lifecycle_state = 'active';
create index if not exists visa_types_category_idx on public.visa_types (category);

-- ---------------------------------------------------------------------------
-- Official sources
-- ---------------------------------------------------------------------------

create table if not exists public.visa_sources (
  id             uuid primary key default gen_random_uuid(),
  country_id     uuid not null references public.visa_countries on delete cascade,
  -- Null = a country-level source (the authority's visa index, its fee page).
  visa_type_id   uuid references public.visa_types on delete cascade,

  -- What this page IS to VisaAI. A requirement may only cite a source whose
  -- role can carry it: a fee cannot be sourced from a 'forms' page.
  role           text not null check (role in (
                   'index', 'landing', 'eligibility', 'requirements',
                   'documents', 'forms', 'fees', 'processing_times',
                   'application', 'policy', 'news')),

  -- The authority that publishes it, and where it sits in the hierarchy the
  -- spec mandates (1 = immigration authority ... 5 = other official source).
  -- Anything above 5 is not an official source and cannot be stored here.
  authority      text not null check (char_length(authority) <= 200),
  authority_rank smallint not null default 1 check (authority_rank between 1 and 5),

  -- canonical_url is the stable address VisaAI links users to and cites.
  -- source_url is what the fetcher actually retrieves; they differ when the
  -- authority serves a versioned PDF from a stable landing page.
  canonical_url  text not null,
  source_url     text not null,
  title          text check (char_length(title) <= 500),
  language       text not null default 'en' check (language ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$'),

  -- Fetch policy. robots_state records the ROBOTS DECISION for this exact URL,
  -- re-evaluated on each run: a 'disallowed' source is never fetched again,
  -- and its requirements fall back to linking users to the official page.
  robots_state   text not null default 'unknown'
                 check (robots_state in ('allowed', 'disallowed', 'unknown')),
  -- Whether the authority's terms permit us to CACHE the bytes. Unknown is
  -- treated as "do not redistribute": metadata only, link out for the file.
  redistribution text not null default 'unknown'
                 check (redistribution in ('permitted', 'prohibited', 'unknown')),
  check_interval interval not null default '1 day',

  -- Freshness SLA for this source; a country whose sources exceed it is
  -- reported stale rather than silently serving old law.
  freshness_sla  interval not null default '30 days',

  active         boolean not null default true,

  first_seen_at  timestamptz not null default now(),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_changed_at timestamptz,
  -- Consecutive failures; the alerting threshold, and the backoff input.
  failure_streak integer not null default 0 check (failure_streak >= 0),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.visa_sources is
  'Registry of official government pages VisaAI monitors. Every visa '
  'requirement must cite a version of one of these rows. Third-party sites are '
  'not permitted here — authority_rank 1-5 are all government sources.';

create unique index if not exists visa_sources_url_idx on public.visa_sources (source_url);
create index if not exists visa_sources_country_idx on public.visa_sources (country_id);
create index if not exists visa_sources_visa_type_idx on public.visa_sources (visa_type_id)
  where visa_type_id is not null;
-- The sync job's worklist: due sources, oldest first.
create index if not exists visa_sources_due_idx
  on public.visa_sources (last_checked_at nulls first) where active;

-- ---------------------------------------------------------------------------
-- Source versions
-- ---------------------------------------------------------------------------

create table if not exists public.visa_source_versions (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references public.visa_sources on delete cascade,

  -- Monotonic per source. Lets a requirement cite "version 3 of this page"
  -- in a way a human can reason about.
  version_number    integer not null check (version_number > 0),

  -- Two hashes, deliberately. raw_sha256 is the bytes as served; it changes
  -- when a CSRF token or a build id changes. normalized_sha256 is the hash of
  -- the extracted, whitespace-collapsed, boilerplate-stripped text — the ONLY
  -- one that may raise a change event. Without the split, every nightly run
  -- reports a policy change on every government page that stamps a nonce.
  raw_sha256        text not null check (char_length(raw_sha256) = 64),
  normalized_sha256 text not null check (char_length(normalized_sha256) = 64),

  http_status       integer,
  content_type      text check (char_length(content_type) <= 128),
  byte_size         integer check (byte_size is null or byte_size >= 0),

  -- Cached bytes, when redistribution = 'permitted'. Null is the normal case
  -- and is not an error: metadata + a link to the official page is the default
  -- posture, not a degraded one.
  storage_path      text,

  -- Dates the AUTHORITY published, where it says so. Distinct from fetched_at:
  -- a page fetched today may state an effective date months away.
  published_at      date,
  effective_from    date,

  -- Version of the extractor that produced normalized_sha256 and any parsed
  -- fields. A parser upgrade changes normalized text without the government
  -- changing anything, so the diff engine must compare like with like.
  extractor_version text not null default 'v1' check (char_length(extractor_version) <= 32),

  fetched_at        timestamptz not null default now(),

  -- Exactly one active version per source is the pointer public pages read.
  -- A new version becomes active only after validation (see
  -- visa_source_changes); until then the previous version keeps serving.
  is_active         boolean not null default false,
  superseded_by     uuid references public.visa_source_versions on delete set null,

  created_at        timestamptz not null default now()
);

comment on table public.visa_source_versions is
  'Immutable snapshots of an official page. Never updated in place and never '
  'deleted: history is what makes a change detectable and a requirement '
  'defensible. normalized_sha256 is the only hash a change event may key on.';

create unique index if not exists visa_source_versions_seq_idx
  on public.visa_source_versions (source_id, version_number);
create unique index if not exists visa_source_versions_one_active_idx
  on public.visa_source_versions (source_id) where is_active;
create index if not exists visa_source_versions_norm_idx
  on public.visa_source_versions (source_id, normalized_sha256);

-- ---------------------------------------------------------------------------
-- Check log
-- ---------------------------------------------------------------------------

create table if not exists public.visa_source_checks (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid not null references public.visa_sources on delete cascade,
  run_id       uuid not null,
  checked_at   timestamptz not null default now(),

  --   ok           fetched, parsed, unchanged
  --   changed      fetched, parsed, normalized content differs
  --   unavailable  network/5xx/timeout
  --   blocked      robots.txt or an authority block (403/429) — NOT an error
  --                to fix by retrying harder; the correct response is to stop
  --   parse_error  fetched but the extractor could not produce usable text
  --   redirected   the URL moved; needs a registry update
  status       text not null check (status in
                 ('ok', 'changed', 'unavailable', 'blocked', 'parse_error', 'redirected')),
  http_status  integer,
  duration_ms  integer check (duration_ms is null or duration_ms >= 0),
  redirect_url text,
  version_id   uuid references public.visa_source_versions on delete set null,
  error_message text check (char_length(error_message) <= 2000),

  created_at   timestamptz not null default now()
);

comment on table public.visa_source_checks is
  'Per-run outcome for every source check. Powers sync metrics, freshness SLAs '
  'and persistent-failure alerts.';

create index if not exists visa_source_checks_source_idx
  on public.visa_source_checks (source_id, checked_at desc);
create index if not exists visa_source_checks_run_idx on public.visa_source_checks (run_id);

-- ---------------------------------------------------------------------------
-- Sync runs
-- ---------------------------------------------------------------------------

create table if not exists public.visa_sync_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  trigger         text not null default 'schedule'
                  check (trigger in ('schedule', 'manual', 'backfill')),
  sources_checked integer not null default 0,
  ok_count        integer not null default 0,
  changed_count   integer not null default 0,
  unavailable_count integer not null default 0,
  blocked_count   integer not null default 0,
  parse_error_count integer not null default 0,
  status          text not null default 'running'
                  check (status in ('running', 'completed', 'failed')),
  error_message   text check (char_length(error_message) <= 2000),
  created_at      timestamptz not null default now()
);

comment on table public.visa_sync_runs is
  'One row per morning synchronization run. The numerator/denominator behind '
  'every sync metric and the operational report.';

create index if not exists visa_sync_runs_started_idx on public.visa_sync_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Structured requirements
-- ---------------------------------------------------------------------------

create table if not exists public.visa_requirements (
  id             uuid primary key default gen_random_uuid(),
  visa_type_id   uuid not null references public.visa_types on delete cascade,

  -- Stable within the visa type: 'passport', 'imm5257', 'proof_of_funds'.
  requirement_code text not null check (requirement_code ~ '^[a-z0-9_]+$'),

  --   form              an official form the applicant files
  --   evidence          supporting evidence the authority requires
  --   condition         a rule that must hold (age, passport validity)
  --   fee               a government charge
  --   step              a procedural step (biometrics, interview)
  --   recommended       VisaAI's case-strengthening suggestion, NOT official
  -- 'recommended' is a separate kind rather than a boolean because the UI must
  -- never be able to render it in the same list as an official requirement by
  -- forgetting a flag.
  kind           text not null check (kind in
                   ('form', 'evidence', 'condition', 'fee', 'step', 'recommended')),

  -- Whether the AUTHORITY says it is required. A 'recommended' kind is always
  -- false here; the constraint below enforces that the two can never disagree.
  officially_required boolean not null default true,
  constraint visa_requirements_recommended_not_official check (
    kind <> 'recommended' or officially_required = false
  ),

  label          text not null check (char_length(label) between 1 and 300),
  description    text,

  -- Official artifact identifiers where the requirement IS a document:
  -- 'IMM 5257', 'DS-160'. Null for conditions and fees.
  official_form_code text check (char_length(official_form_code) <= 64),
  official_form_url  text,

  -- The conditional rule. Null = unconditional (always required).
  -- Shape (evaluated by apps/api/src/modules/visa-rules/rule-evaluator.ts):
  --   {"all":[{"fact":"nationality","op":"in","value":["IN","PK"]}]}
  --   {"any":[{"fact":"age","op":"lt","value":18}]}
  --   {"not":{"fact":"has_sponsor","op":"eq","value":true}}
  -- Kept as data rather than TypeScript conditionals so it can be validated,
  -- tested, diffed against a source version, and shown to the user as the
  -- reason a document appeared.
  rule           jsonb,

  -- Typed detail per kind, e.g. {"amount": 100, "currency": "AUD"} for a fee,
  -- {"months": 6} for passport validity. Typed so a fee change is a numeric
  -- diff, not a prose diff.
  parameters     jsonb not null default '{}'::jsonb,

  -- PROVENANCE. Not nullable: a requirement with no source is exactly the
  -- thing this migration exists to make impossible.
  source_version_id uuid not null references public.visa_source_versions on delete restrict,
  -- Where on the page it was found, for a reviewer to re-check quickly.
  source_excerpt text check (char_length(source_excerpt) <= 4000),

  -- How the row was produced, and how much to trust it.
  extraction_method text not null default 'manual'
                    check (extraction_method in ('manual', 'parser', 'ai_assisted')),
  confidence     numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  --   draft     extracted, not yet reviewed
  --   active    validated and serving
  --   retired   superseded or withdrawn by the authority
  status         text not null default 'draft'
                 check (status in ('draft', 'active', 'retired')),

  display_order  integer not null default 100,
  last_verified_at timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.visa_requirements is
  'Typed, sourced, conditionally-scoped visa requirements. Every row cites the '
  'exact source VERSION it was read from. kind = recommended is VisaAI advice '
  'and is structurally barred from claiming official status.';

create unique index if not exists visa_requirements_identity_idx
  on public.visa_requirements (visa_type_id, requirement_code)
  where status <> 'retired';
create index if not exists visa_requirements_type_active_idx
  on public.visa_requirements (visa_type_id, display_order) where status = 'active';
create index if not exists visa_requirements_source_idx
  on public.visa_requirements (source_version_id);

-- ---------------------------------------------------------------------------
-- Change promotion workflow
-- ---------------------------------------------------------------------------

create table if not exists public.visa_source_changes (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references public.visa_sources on delete cascade,
  from_version_id uuid references public.visa_source_versions on delete set null,
  to_version_id  uuid not null references public.visa_source_versions on delete cascade,
  run_id         uuid,

  -- Lifecycle from the spec: detected -> parsed -> validated -> tested ->
  -- approved -> active, with rejected/failed as terminal states. A government
  -- edit never reaches users without passing through this.
  state          text not null default 'detected'
                 check (state in ('detected', 'parsed', 'validated', 'tested',
                                  'approved', 'active', 'rejected', 'failed')),

  --   cosmetic     markup/boilerplate only after normalization
  --   editorial    wording changed, no requirement changed
  --   material     a requirement, fee, form or eligibility rule changed
  --   structural   the page moved or was restructured
  classification text not null default 'cosmetic'
                 check (classification in ('cosmetic', 'editorial', 'material', 'structural')),

  -- Why it needs a human. Populated for anything the auto-promoter refuses:
  -- eligibility removed, new mandatory form, threshold changed, subclass
  -- discontinued, parser confidence below threshold, sources conflicting.
  escalation_reasons text[] not null default '{}',
  requires_review boolean not null default true,

  summary        text check (char_length(summary) <= 4000),
  diff           jsonb,

  reviewed_by    uuid references auth.users on delete set null,
  reviewed_at    timestamptz,
  review_note    text check (char_length(review_note) <= 2000),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A change that is live must have been through review or been explicitly
  -- auto-approvable. Enforced here rather than in the job so a manual UPDATE
  -- cannot skip the gate either.
  constraint visa_source_changes_active_was_reviewed check (
    state <> 'active' or requires_review = false or reviewed_at is not null
  )
);

comment on table public.visa_source_changes is
  'Promotion queue for detected government changes. detected -> parsed -> '
  'validated -> tested -> approved -> active. Material changes always require '
  'human review before they reach a user.';

create index if not exists visa_source_changes_pending_idx
  on public.visa_source_changes (created_at desc)
  where state in ('detected', 'parsed', 'validated', 'tested');
create index if not exists visa_source_changes_source_idx
  on public.visa_source_changes (source_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Countries, visa types and requirements are the content of the public visa
-- pages, which must render for a logged-out crawler, so `anon` gets SELECT.
-- Sources, versions, checks, runs and changes are operational: authenticated
-- read (the admin UI) and nothing else. No table grants writes to any role —
-- RLS denies by default and the sync job uses the service role.

alter table public.visa_countries        enable row level security;
alter table public.visa_types            enable row level security;
alter table public.visa_requirements     enable row level security;
alter table public.visa_sources          enable row level security;
alter table public.visa_source_versions  enable row level security;
alter table public.visa_source_checks    enable row level security;
alter table public.visa_sync_runs        enable row level security;
alter table public.visa_source_changes   enable row level security;

create policy visa_countries_public_read on public.visa_countries
  for select to anon, authenticated using (true);

create policy visa_types_public_read on public.visa_types
  for select to anon, authenticated using (true);

-- Only ACTIVE requirements are public. A draft is unreviewed extraction and
-- must never reach a page; a retired one is history for the admin timeline.
create policy visa_requirements_public_read on public.visa_requirements
  for select to anon, authenticated using (status = 'active');

create policy visa_requirements_staff_read on public.visa_requirements
  for select to authenticated using (true);

-- Sources are cited on public pages (canonical_url is shown next to a claim),
-- so the registry itself is readable; the fetch bookkeeping around it is not
-- sensitive either, but there is no reason to expose it to anon.
create policy visa_sources_public_read on public.visa_sources
  for select to anon, authenticated using (active);

create policy visa_source_versions_read on public.visa_source_versions
  for select to authenticated using (true);

create policy visa_source_checks_read on public.visa_source_checks
  for select to authenticated using (true);

create policy visa_sync_runs_read on public.visa_sync_runs
  for select to authenticated using (true);

create policy visa_source_changes_read on public.visa_source_changes
  for select to authenticated using (true);

revoke insert, update, delete on public.visa_countries       from anon, authenticated;
revoke insert, update, delete on public.visa_types           from anon, authenticated;
revoke insert, update, delete on public.visa_requirements    from anon, authenticated;
revoke insert, update, delete on public.visa_sources         from anon, authenticated;
revoke insert, update, delete on public.visa_source_versions from anon, authenticated;
revoke insert, update, delete on public.visa_source_checks   from anon, authenticated;
revoke insert, update, delete on public.visa_sync_runs       from anon, authenticated;
revoke insert, update, delete on public.visa_source_changes  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.visa_registry_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger visa_countries_touch before update on public.visa_countries
  for each row execute function public.visa_registry_touch_updated_at();
create trigger visa_types_touch before update on public.visa_types
  for each row execute function public.visa_registry_touch_updated_at();
create trigger visa_sources_touch before update on public.visa_sources
  for each row execute function public.visa_registry_touch_updated_at();
create trigger visa_requirements_touch before update on public.visa_requirements
  for each row execute function public.visa_registry_touch_updated_at();
create trigger visa_source_changes_touch before update on public.visa_source_changes
  for each row execute function public.visa_registry_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Publication gate
-- ---------------------------------------------------------------------------
-- The single predicate that decides whether a visa page may be indexed. It
-- lives in SQL so the sitemap builder, the page renderer and the data-quality
-- report cannot drift apart by each re-implementing "is this good enough".
--
-- A page qualifies when: the country is supported, the visa is active, it has
-- at least one active OFFICIAL requirement (a page of VisaAI suggestions is
-- not a visa page), and it has at least one active, reachable official source.

create or replace view public.visa_publishable_pages
with (security_invoker = true) as
select
  c.code                              as country_code,
  c.slug                              as country_slug,
  c.name                              as country_name,
  t.id                                as visa_type_id,
  t.visaai_id,
  t.slug                              as visa_slug,
  t.official_name,
  t.category,
  count(r.id) filter (where r.status = 'active' and r.officially_required) as official_requirement_count,
  count(distinct s.id) filter (where s.active)                             as source_count,
  max(greatest(coalesce(t.last_verified_at, 'epoch'::timestamptz),
               coalesce(c.last_verified_at, 'epoch'::timestamptz)))        as last_verified_at
from public.visa_countries c
join public.visa_types t on t.country_id = c.id
left join public.visa_requirements r on r.visa_type_id = t.id
left join public.visa_sources s on s.visa_type_id = t.id
where c.support_state = 'supported'
  and t.lifecycle_state = 'active'
group by c.code, c.slug, c.name, t.id, t.visaai_id, t.slug, t.official_name, t.category
having count(r.id) filter (where r.status = 'active' and r.officially_required) > 0
   and count(distinct s.id) filter (where s.active) > 0;

comment on view public.visa_publishable_pages is
  'The ONLY definition of an indexable visa page: supported country, active '
  'visa type, at least one active official requirement, at least one active '
  'official source. Sitemap, renderer and quality report all read this.';
