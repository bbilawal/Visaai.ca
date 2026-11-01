-- ============================================================
-- VisaAI — Gate 2 / Phase 3 / Phase 4 migrations ONLY
-- Run on a project that ALREADY has the base schema (users, applications, ...).
-- All statements are idempotent (create-if-not-exists / guarded enums / create-or-replace).
-- Apply in the Supabase SQL editor for project xaemxugqnxoxlqnboxyb.
-- ============================================================

-- >>> 20260606000000_verification_enums.sql
-- =====================================================================
-- Gate 2 — Phase 2A.1  ENUMS + extensions (foundation, no tables yet)
-- Author: Database Architect   Date: 2026-06-06
--
-- Production-safe: each type creation is guarded (duplicate_object => no-op)
-- so the migration is idempotent / re-runnable. No existing object touched.
-- =====================================================================

-- pgcrypto provides digest() used by the audit hash chain (Phase 2A.5).
create extension if not exists "pgcrypto";

-- ---- verification_state -------------------------------------------------
-- Declared WEAKEST -> STRONGEST so min(state) over a section's fields means
-- "weakest field wins" (Postgres compares enums by declaration order).
do $$ begin
  create type verification_state as enum (
    'EXTRACTED',
    'USER_CONFIRMED',
    'CONSULTANT_REVIEWED',
    'CONSULTANT_APPROVED',
    'EXECUTION_READY',
    'EXECUTED'
  );
exception when duplicate_object then null; end $$;

-- ---- audit event taxonomy ----------------------------------------------
do $$ begin
  create type audit_event_type as enum (
    'DOCUMENT_UPLOADED',
    'OCR_COMPLETED',
    'FIELD_EXTRACTED',
    'FIELD_EDITED',
    'USER_CONFIRMED',
    'CONSULTANT_REVIEWED',
    'CONSULTANT_APPROVED',
    'PREFLIGHT_STARTED',
    'PREFLIGHT_COMPLETED',
    'EXECUTION_STARTED',
    'EXECUTION_COMPLETED',
    'EXECUTION_FAILED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type audit_actor_role as enum ('system', 'applicant', 'consultant');
exception when duplicate_object then null; end $$;

-- ---- consultant decision ------------------------------------------------
do $$ begin
  create type consultant_decision as enum ('reviewed', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ---- preflight status ---------------------------------------------------
do $$ begin
  create type preflight_status as enum ('in_review', 'completed', 'invalidated');
exception when duplicate_object then null; end $$;

-- =====================================================================
-- ROLLBACK (manual; run in reverse, only if no dependent columns exist):
--   drop type if exists preflight_status;
--   drop type if exists consultant_decision;
--   drop type if exists audit_actor_role;
--   drop type if exists audit_event_type;
--   drop type if exists verification_state;
--   -- pgcrypto left installed (shared); drop only if certain nothing uses it.
-- NOTE: a type cannot be dropped while any table column uses it. Drop the
-- Phase 2A tables (reverse order) BEFORE dropping these types.
-- =====================================================================


-- >>> 20260606000001_ocr_runs.sql
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


-- >>> 20260606000002_field_provenance.sql
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


-- >>> 20260606000003_field_verifications.sql
-- =====================================================================
-- Gate 2 — Phase 2A.4  field_verifications  (per-field verification state)
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: applications, users, documents, verification_state enum
-- state is a CACHE of the latest transition; the audit log is authoritative.
-- =====================================================================

create table if not exists public.field_verifications (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,

  field_key       text not null,
  section         text,                          -- rollup group ("Personal","Passport"...)

  state           verification_state not null default 'EXTRACTED',

  -- value binding for drift detection (EC-1)
  value_snapshot      text,
  value_hash          text,
  source              text check (source is null or source in ('profile','document','inferred')),
  source_document_id  uuid references public.documents on delete set null,

  -- actor + audit timestamps (who advanced it last)
  user_confirmed_by        uuid references public.users on delete set null,
  user_confirmed_at        timestamptz,
  consultant_reviewed_by   uuid references public.users on delete set null,
  consultant_reviewed_at   timestamptz,
  consultant_approved_by   uuid references public.users on delete set null,
  consultant_approved_at   timestamptz,
  executed_at              timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (application_id, field_key)
);

create index if not exists field_verifications_app_idx
  on public.field_verifications (application_id);
create index if not exists field_verifications_app_section_idx
  on public.field_verifications (application_id, section);
create index if not exists field_verifications_app_state_idx
  on public.field_verifications (application_id, state);

-- keep updated_at honest
create or replace function public.touch_field_verifications()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

drop trigger if exists field_verifications_touch on public.field_verifications;
create trigger field_verifications_touch
  before update on public.field_verifications
  for each row execute function public.touch_field_verifications();

-- Derived section rollup: weakest field in a section drives the section state.
create or replace view public.section_verification as
select application_id,
       section,
       min(state) as section_state,
       count(*)                                              as field_count,
       count(*) filter (where state >= 'EXECUTION_READY')    as ready_count
from public.field_verifications
group by application_id, section;

alter table public.field_verifications enable row level security;

-- Owner may READ. Applicant-role confirm transitions and consultant/system
-- transitions go through guarded service paths (service role) -> no broad
-- client write policy here (keeps EXECUTION_READY/EXECUTED out of client reach).
drop policy if exists field_verifications_owner_read on public.field_verifications;
create policy field_verifications_owner_read on public.field_verifications
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
  );

comment on table public.field_verifications is
  'Gate 2: per-field verification state cache. Canonical history lives in audit_events. Service-role write.';

-- =====================================================================
-- ROLLBACK:
--   drop view if exists public.section_verification;
--   drop trigger if exists field_verifications_touch on public.field_verifications;
--   drop function if exists public.touch_field_verifications();
--   drop table if exists public.field_verifications;
-- =====================================================================


-- >>> 20260606000004_audit_events.sql
-- =====================================================================
-- Gate 2 — Phase 2A.5  audit_events  (immutable, append-only, hash-chained)
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: applications, users, documents, submission_sessions, ocr_runs,
--             pgcrypto, audit_event_type/audit_actor_role enums
--
-- Guarantees: INSERT-only (UPDATE/DELETE blocked 3 ways), per-application
-- hash chain, value HASHES only (no raw PII).
-- =====================================================================

-- ---- per-application chain head (serializes appends, holds chain tip) ----
create table if not exists public.audit_chain_state (
  application_id uuid primary key references public.applications on delete cascade,
  last_seq       bigint not null default 0,
  last_row_hash  text   not null
);

-- ---- the append-only log ------------------------------------------------
create table if not exists public.audit_events (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,
  seq             bigint not null,
  event_type      audit_event_type not null,

  actor_id        uuid references public.users on delete set null,
  actor_role      audit_actor_role not null,

  document_id           uuid references public.documents on delete set null,
  ocr_run_id            uuid references public.ocr_runs on delete set null,
  field_key             text,
  submission_session_id uuid references public.submission_sessions on delete set null,

  from_state      text,
  to_state        text,

  payload         jsonb not null default '{}',   -- PII as value_hash only
  value_hash      text,
  payload_hash    text not null,
  prev_hash       text not null,
  row_hash        text not null,

  hash_algo       text not null default 'sha256',
  canon_version   smallint not null default 1,

  extension_version text,
  schema_version    text,

  occurred_at     timestamptz not null default now(),  -- SERVER time

  unique (application_id, seq),
  unique (application_id, row_hash)
);

create index if not exists audit_events_app_seq_idx  on public.audit_events (application_id, seq);
create index if not exists audit_events_type_idx     on public.audit_events (application_id, event_type);
create index if not exists audit_events_field_idx    on public.audit_events (application_id, field_key);
create index if not exists audit_events_session_idx  on public.audit_events (submission_session_id);
create index if not exists audit_events_occurred_idx on public.audit_events (occurred_at);

-- ---- IMMUTABILITY: trigger guard (layer 1) ------------------------------
create or replace function public.audit_no_mutate()
returns trigger as $$
begin
  raise exception 'audit_events is append-only: % not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$ language plpgsql;

drop trigger if exists audit_events_no_update on public.audit_events;
create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function public.audit_no_mutate();

drop trigger if exists audit_events_no_delete on public.audit_events;
create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function public.audit_no_mutate();

-- ---- RLS (layer 2): owner read only; writes only via definer fn ---------
alter table public.audit_events      enable row level security;
alter table public.audit_chain_state enable row level security;

drop policy if exists audit_events_owner_read on public.audit_events;
create policy audit_events_owner_read on public.audit_events
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
  );
-- no insert/update/delete policy -> only service role / definer fn writes.
-- audit_chain_state: no policy at all -> client-invisible; definer fn manages it.

-- ---- APPEND function: computes seq + hash chain atomically --------------
create or replace function public.audit_append(
  p_application_id        uuid,
  p_event_type           audit_event_type,
  p_actor_id             uuid,
  p_actor_role           audit_actor_role,
  p_payload              jsonb,
  p_value_hash           text default null,
  p_document_id          uuid default null,
  p_ocr_run_id           uuid default null,
  p_field_key            text default null,
  p_submission_session_id uuid default null,
  p_from_state           text default null,
  p_to_state             text default null,
  p_extension_version    text default null,
  p_schema_version       text default null
) returns public.audit_events as $$
declare
  v_seq          bigint;
  v_prev_hash    text;
  v_payload_hash text;
  v_row_hash     text;
  v_occurred     timestamptz := now();
  v_row          public.audit_events;
begin
  -- genesis = sha256(application_id)
  insert into public.audit_chain_state (application_id, last_seq, last_row_hash)
  values (p_application_id, 0, encode(digest(p_application_id::text, 'sha256'), 'hex'))
  on conflict (application_id) do nothing;

  select last_seq, last_row_hash into v_seq, v_prev_hash
  from public.audit_chain_state
  where application_id = p_application_id
  for update;                                   -- row lock => chain serialization

  v_seq := v_seq + 1;
  v_payload_hash := encode(digest(p_payload::text, 'sha256'), 'hex');
  v_row_hash := encode(digest(
    v_prev_hash || p_event_type::text || coalesce(p_field_key,'') ||
    coalesce(p_document_id::text,'') || v_payload_hash || v_occurred::text ||
    coalesce(p_actor_id::text,'system'),
    'sha256'), 'hex');

  insert into public.audit_events (
    application_id, seq, event_type, actor_id, actor_role,
    document_id, ocr_run_id, field_key, submission_session_id,
    from_state, to_state, payload, value_hash,
    payload_hash, prev_hash, row_hash,
    extension_version, schema_version, occurred_at
  ) values (
    p_application_id, v_seq, p_event_type, p_actor_id, p_actor_role,
    p_document_id, p_ocr_run_id, p_field_key, p_submission_session_id,
    p_from_state, p_to_state, p_payload, p_value_hash,
    v_payload_hash, v_prev_hash, v_row_hash,
    p_extension_version, p_schema_version, v_occurred
  ) returning * into v_row;

  update public.audit_chain_state
    set last_seq = v_seq, last_row_hash = v_row_hash
  where application_id = p_application_id;

  return v_row;
end;
$$ language plpgsql security definer;

-- ---- VERIFY function (layer 3): recompute chain, locate first break -----
create or replace function public.audit_verify_chain(p_application_id uuid)
returns table(broken_at_seq bigint, reason text) as $$
declare
  r      public.audit_events;
  v_prev text := encode(digest(p_application_id::text, 'sha256'), 'hex');
  v_calc text;
begin
  for r in
    select * from public.audit_events where application_id = p_application_id order by seq
  loop
    if r.prev_hash <> v_prev then
      broken_at_seq := r.seq; reason := 'prev_hash mismatch (gap or edit)'; return next; return;
    end if;
    v_calc := encode(digest(
      r.prev_hash || r.event_type::text || coalesce(r.field_key,'') ||
      coalesce(r.document_id::text,'') || r.payload_hash || r.occurred_at::text ||
      coalesce(r.actor_id::text,'system'), 'sha256'), 'hex');
    if v_calc <> r.row_hash then
      broken_at_seq := r.seq; reason := 'row_hash mismatch (tampered)'; return next; return;
    end if;
    v_prev := r.row_hash;
  end loop;
  return;  -- intact
end;
$$ language plpgsql stable;

comment on table public.audit_events is
  'Gate 2: append-only, hash-chained audit log. UPDATE/DELETE blocked. value_hash only, no raw PII.';

-- =====================================================================
-- ROLLBACK:
--   drop function if exists public.audit_verify_chain(uuid);
--   drop function if exists public.audit_append(uuid,audit_event_type,uuid,audit_actor_role,jsonb,text,uuid,uuid,text,uuid,text,text,text,text);
--   drop trigger if exists audit_events_no_update on public.audit_events;
--   drop trigger if exists audit_events_no_delete on public.audit_events;
--   drop function if exists public.audit_no_mutate();
--   drop table if exists public.audit_events;
--   drop table if exists public.audit_chain_state;
-- =====================================================================


-- >>> 20260606000005_consultant_approvals.sql
-- =====================================================================
-- Gate 2 — Phase 2A.6  consultant_assignments + consultant_approvals
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: applications, users, consultant_decision enum
-- Consultant = a user assigned to an application (Path 3 marketplace).
-- =====================================================================

-- ---- assignment (who may review which application) ----------------------
create table if not exists public.consultant_assignments (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,
  consultant_id   uuid not null references public.users on delete cascade,
  status          text not null default 'active'
                    check (status in ('active','released')),
  assigned_at     timestamptz not null default now(),
  released_at     timestamptz,
  unique (application_id, consultant_id)
);

-- At most one ACTIVE consultant per application (marketplace MVP rule).
create unique index if not exists consultant_assignments_one_active_uidx
  on public.consultant_assignments (application_id)
  where status = 'active';

create index if not exists consultant_assignments_consultant_idx
  on public.consultant_assignments (consultant_id, status);

-- ---- approvals (field / section / application level) --------------------
create table if not exists public.consultant_approvals (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,
  consultant_id   uuid not null references public.users on delete cascade,

  scope           text not null check (scope in ('field','section','application')),
  field_key       text,                          -- required when scope='field'
  section         text,                          -- required when scope='section'

  decision        consultant_decision not null,  -- reviewed | approved | rejected
  value_hash      text,                          -- value the consultant acted on (drift binding)
  reason          text,                          -- required for rejections (app-enforced)

  decided_at      timestamptz not null default now(),

  constraint consultant_approvals_scope_field
    check (scope <> 'field'   or field_key is not null),
  constraint consultant_approvals_scope_section
    check (scope <> 'section' or section   is not null)
);

create index if not exists consultant_approvals_app_idx
  on public.consultant_approvals (application_id, scope, decided_at desc);
create index if not exists consultant_approvals_app_field_idx
  on public.consultant_approvals (application_id, field_key);
create index if not exists consultant_approvals_consultant_idx
  on public.consultant_approvals (consultant_id, decided_at desc);

alter table public.consultant_assignments enable row level security;
alter table public.consultant_approvals   enable row level security;

-- Applicant reads assignments/approvals on their own application (transparency).
drop policy if exists consultant_assignments_owner_read on public.consultant_assignments;
create policy consultant_assignments_owner_read on public.consultant_assignments
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or auth.uid() = consultant_id
  );

drop policy if exists consultant_approvals_owner_read on public.consultant_approvals;
create policy consultant_approvals_owner_read on public.consultant_approvals
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or auth.uid() = consultant_id
  );
-- Writes via guarded service paths (assignment-checked) / service role.
-- A dedicated consultant DB role + write policies land with the consultant module.

comment on table public.consultant_approvals is
  'Gate 2: consultant review/approve/reject decisions, value_hash-bound. Append-style (new row per decision). Service-role write.';

-- =====================================================================
-- ROLLBACK:
--   drop table if exists public.consultant_approvals;
--   drop table if exists public.consultant_assignments;
-- =====================================================================


-- >>> 20260606000006_preflight_reviews.sql
-- =====================================================================
-- Gate 2 — Phase 2A.7  preflight_reviews
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: applications, submission_sessions, users, preflight_status enum
-- One row per preflight diff-review session. checklist must be all-true to
-- reach 'completed'; locked_diff_hash anchors the exact mapping reviewed.
-- =====================================================================

create table if not exists public.preflight_reviews (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,
  submission_session_id uuid references public.submission_sessions on delete set null,

  status          preflight_status not null default 'in_review',
  reviewer_id     uuid references public.users on delete set null,  -- consultant (expert) or applicant
  reviewer_role   audit_actor_role,                                 -- 'consultant' | 'applicant'

  -- the six mandatory checks
  passport_reviewed       boolean not null default false,
  dates_reviewed          boolean not null default false,
  travel_history_reviewed boolean not null default false,
  addresses_reviewed      boolean not null default false,
  employment_reviewed     boolean not null default false,
  final_approval          boolean not null default false,

  locked_diff_hash text,            -- sha256 of the locked 3-col diff; null until completed
  extension_version text,
  schema_version    text,

  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  invalidated_at  timestamptz,

  -- completion integrity: 'completed' requires all six checks + a locked hash
  constraint preflight_completed_requires_all_checks
    check (
      status <> 'completed' or (
        passport_reviewed and dates_reviewed and travel_history_reviewed
        and addresses_reviewed and employment_reviewed and final_approval
        and locked_diff_hash is not null and completed_at is not null
      )
    )
);

create index if not exists preflight_reviews_app_idx
  on public.preflight_reviews (application_id, started_at desc);
create index if not exists preflight_reviews_session_idx
  on public.preflight_reviews (submission_session_id);

-- At most one IN_REVIEW preflight per application at a time.
create unique index if not exists preflight_reviews_one_inreview_uidx
  on public.preflight_reviews (application_id)
  where status = 'in_review';

alter table public.preflight_reviews enable row level security;

drop policy if exists preflight_reviews_owner_read on public.preflight_reviews;
create policy preflight_reviews_owner_read on public.preflight_reviews
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or auth.uid() = reviewer_id
  );
-- Writes via guarded preflight service / service role.

comment on table public.preflight_reviews is
  'Gate 2: mandatory preflight diff review. completed requires all 6 checks + locked_diff_hash. Service-role write.';

-- =====================================================================
-- ROLLBACK:
--   drop table if exists public.preflight_reviews;
-- =====================================================================


-- >>> 20260606000007_evidence_packages.sql
-- =====================================================================
-- Gate 2 — Phase 2A.8  evidence_packages
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: applications, submission_sessions, users
-- Immutable artifact reference (the package body lives in object storage).
-- One row per generated package; re-execution => a new version, never update.
-- =====================================================================

create table if not exists public.evidence_packages (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,
  submission_session_id uuid references public.submission_sessions on delete set null,

  version         int not null default 1,

  consultant_id        uuid references public.users on delete set null,
  approval_timestamp   timestamptz,
  execution_timestamp  timestamptz,

  audit_hash      text not null,          -- chain head row_hash anchored at generation
  chain_verified  boolean not null default false,
  signature       text not null,          -- service signature over canonical package
  storage_path    text not null,          -- object-storage location of the package body
  region          text not null default 'global',  -- residency-bound

  extension_version text,
  schema_version    text,
  package_version   text not null default '1.0',
  hash_algo         text not null default 'sha256',
  canon_version     smallint not null default 1,

  generated_at    timestamptz not null default now(),

  unique (application_id, version)
);

create index if not exists evidence_packages_app_idx
  on public.evidence_packages (application_id, version desc);
create index if not exists evidence_packages_session_idx
  on public.evidence_packages (submission_session_id);

-- Immutability: evidence rows are write-once. Block UPDATE/DELETE (reuse the
-- audit no-mutate guard created in 20260606000004).
drop trigger if exists evidence_packages_no_update on public.evidence_packages;
create trigger evidence_packages_no_update
  before update on public.evidence_packages
  for each row execute function public.audit_no_mutate();

drop trigger if exists evidence_packages_no_delete on public.evidence_packages;
create trigger evidence_packages_no_delete
  before delete on public.evidence_packages
  for each row execute function public.audit_no_mutate();

alter table public.evidence_packages enable row level security;

drop policy if exists evidence_packages_owner_read on public.evidence_packages;
create policy evidence_packages_owner_read on public.evidence_packages
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or auth.uid() = consultant_id
  );
-- Writes via service role (evidence generator) only.

comment on table public.evidence_packages is
  'Gate 2: immutable, signed evidence-package references. Write-once; re-exec => new version. Service-role write.';

-- =====================================================================
-- ROLLBACK:
--   drop trigger if exists evidence_packages_no_update on public.evidence_packages;
--   drop trigger if exists evidence_packages_no_delete on public.evidence_packages;
--   drop table if exists public.evidence_packages;
-- =====================================================================


-- >>> 20260606000008_field_provenance_versioning.sql
-- =====================================================================
-- Gate 2 — SCHEMA CORRECTNESS AMENDMENT  field_provenance atomic versioning
-- Author: Backend (Provenance)   Date: 2026-06-06
-- Classification: Schema Correctness Amendment (NOT a new feature). Enforces the
-- already-approved invariant "supersede creates a new immutable version without
-- rewriting history", which the shipped one-current partial-unique model cannot
-- otherwise satisfy safely.
--
-- Corrective dependency for ProvenanceService supersede/versioning. The
-- one-current partial-unique index (field_provenance_current_uidx) makes the
-- "insert new current while old current still null" ordering impossible without
-- superseding the old row FIRST. Superseding first requires the self-FK to allow
-- a not-yet-existing target until commit -> make it DEFERRABLE, and do both
-- writes inside one function (update-old-then-insert-new).
--
-- Additive + idempotent. No data change.
-- =====================================================================

-- 1) Make the lineage self-FK deferrable so update-first ordering is legal.
alter table public.field_provenance
  drop constraint if exists field_provenance_superseded_by_fkey;

alter table public.field_provenance
  add constraint field_provenance_superseded_by_fkey
  foreign key (superseded_by) references public.field_provenance(id)
  on delete set null
  deferrable initially deferred;

-- 2) Atomic version creation: supersede current (if any) -> insert new current.
--    Order matters: UPDATE clears the old null (0 current) BEFORE INSERT adds the
--    new null (1 current), so the partial-unique index is never violated. The
--    deferred FK tolerates superseded_by = v_new_id until commit, when the new
--    row exists. SECURITY DEFINER: provenance is a service-role write path.
create or replace function public.field_provenance_create_version(
  p_application_id     uuid,
  p_field_key         text,
  p_origin            text,
  p_value_snapshot    text,
  p_value_hash        text,
  p_source_document_id uuid,
  p_source_page       int,
  p_source_bbox       jsonb,
  p_ocr_run_id        uuid,
  p_confidence        numeric,
  p_confidence_band   text
) returns public.field_provenance as $$
declare
  v_new_id uuid := uuid_generate_v4();
  v_row    public.field_provenance;
begin
  -- supersede the existing current row (if present) -> point it at the new id
  update public.field_provenance
     set superseded_by = v_new_id
   where application_id = p_application_id
     and field_key = p_field_key
     and superseded_by is null;

  insert into public.field_provenance (
    id, application_id, field_key, origin, value_snapshot, value_hash,
    source_document_id, source_page, source_bbox, ocr_run_id,
    confidence, confidence_band
  ) values (
    v_new_id, p_application_id, p_field_key, p_origin, p_value_snapshot, p_value_hash,
    p_source_document_id, p_source_page, p_source_bbox, p_ocr_run_id,
    p_confidence, p_confidence_band
  ) returning * into v_row;

  return v_row;
end;
$$ language plpgsql security definer;

comment on function public.field_provenance_create_version is
  'Gate 2 / 2E: atomic supersede-then-insert. One current per (application,field). Append-only versioning.';

-- =====================================================================
-- ROLLBACK:
--   drop function if exists public.field_provenance_create_version(uuid,text,text,text,text,uuid,int,jsonb,uuid,numeric,text);
--   alter table public.field_provenance drop constraint if exists field_provenance_superseded_by_fkey;
--   alter table public.field_provenance
--     add constraint field_provenance_superseded_by_fkey
--     foreign key (superseded_by) references public.field_provenance(id) on delete set null;
-- =====================================================================


-- >>> 20260606000009_consultant_decision_revoked.sql
-- =====================================================================
-- Gate 2 — SCHEMA CORRECTNESS AMENDMENT  consultant_decision += 'revoked'
-- Author: Backend (Consultant)   Date: 2026-06-06
-- Classification: Schema Correctness Amendment (NOT a new feature).
--
-- Revocation is a first-class consultant action distinct from rejection
-- (withdrawing a previously GRANTED approval vs declining during review). The
-- consultant_approvals.decision enum needs a dedicated value so rollups and
-- evidence can tell the two apart. Idempotent; PG12+ allows ADD VALUE IF NOT
-- EXISTS (value added here, not used in this same migration).
-- =====================================================================

alter type consultant_decision add value if not exists 'revoked';

-- =====================================================================
-- ROLLBACK:
--   Postgres does not support removing a value from an enum type. To revert,
--   the enum must be recreated and dependent columns recast (heavy). Forward-fix
--   preferred: stop writing 'revoked' at the application layer if reverting.
-- =====================================================================


-- >>> 20260606000010_audit_event_execution_ready.sql
-- =====================================================================
-- Gate 2 — AUDIT TAXONOMY AMENDMENT  audit_event_type += 'EXECUTION_READY'
-- Author: Backend (Eligibility)   Date: 2026-06-06
--
-- ExecutionEligibilityService emits EXECUTION_READY when all four predicates
-- pass (the final compliance gate). It is distinct from EXECUTION_STARTED
-- (eligibility is read-only and does NOT start execution). Idempotent; PG12+
-- ADD VALUE IF NOT EXISTS (value added here, not used in this migration).
--
-- Ordering note: declared after PREFLIGHT_COMPLETED / before EXECUTION_STARTED
-- in the TS union for readability; enum value position in PG does not affect the
-- audit hash chain (the chain hashes the text value, not its ordinal).
-- =====================================================================

alter type audit_event_type add value if not exists 'EXECUTION_READY';

-- =====================================================================
-- ROLLBACK:
--   Postgres cannot remove an enum value. Forward-fix only: stop emitting
--   'EXECUTION_READY' at the application layer if reverting.
-- =====================================================================


-- >>> 20260606000011_audit_events_execution_request.sql
-- =====================================================================
-- Gate 2 — AUDIT TAXONOMY AMENDMENT  audit_event_type += request signals
-- Author: Backend (Execution Request Gate)   Date: 2026-06-07
--
-- Phase 3F backend gate emits, on a validated request:
--   READBACK_CONFIRMED  — user confirmed the readback side-by-side (optional)
--   EXECUTION_REQUESTED — gate passed revalidation (NOT execution start)
-- Both distinct from EXECUTION_STARTED (no execution occurs in this layer).
-- Idempotent; PG12+ ADD VALUE IF NOT EXISTS.
-- =====================================================================

alter type audit_event_type add value if not exists 'READBACK_CONFIRMED';
alter type audit_event_type add value if not exists 'EXECUTION_REQUESTED';

-- =====================================================================
-- ROLLBACK: Postgres cannot remove enum values. Forward-fix only.
-- =====================================================================


-- >>> 20260607000000_consumed_readback_tokens.sql
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


-- >>> 20260607000001_audit_event_legacy_blocked.sql
-- =====================================================================
-- Phase 4B — AUDIT TAXONOMY AMENDMENT  audit_event_type += LEGACY_AUTOMATION_BLOCKED
-- Author: Backend (Bypass Elimination)   Date: 2026-06-07
--
-- Emitted (audit-only, non-mutating) when a legacy socket-fill execution attempt
-- is blocked because LEGACY_AUTOMATION_WRITE_ENABLED is off (default). Records
-- the deprecation event without performing any DOM write. Idempotent.
-- =====================================================================

alter type audit_event_type add value if not exists 'LEGACY_AUTOMATION_BLOCKED';

-- ROLLBACK: Postgres cannot remove enum values. Forward-fix only.

