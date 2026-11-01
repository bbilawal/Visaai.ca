-- Template freshness, revision history, and new-artifact discovery.
--
-- Closes the three gaps the cache shipped with:
--
--   1. STALE WAS FOREVER. Delivery served any row with status in ('ok','stale')
--      with no age check, so a form withdrawn by the government kept being
--      handed to applicants indefinitely — the only trace a WARN line in pm2.
--      `last_verified_at` is the missing fact: the last time we CONFIRMED the
--      cached bytes against the authority, as opposed to the last time we
--      tried (last_checked_at) or the last time bytes changed (fetched_at).
--
--   2. NO HISTORY. Each refresh overwrote the row, so nothing recorded that
--      IMM 5484 changed, when, or from what. template_revisions is an
--      append-only ledger of exactly that, and it is what makes a prefill
--      field-mapping review possible after a form is re-laid-out.
--
--   3. NO WAY TO LEARN ABOUT NEW FORMS. The catalog is a hand-maintained list;
--      an authority publishing a new form was invisible. template_sweep_findings
--      holds what the weekly index crawl found that our catalog does not have.
--      It PROPOSES, never adds: a government URL entering the catalog
--      unreviewed is the exact fabrication risk this product cannot take.

-- ---------------------------------------------------------------------------
-- 1. Freshness
-- ---------------------------------------------------------------------------

alter table public.form_templates
  add column if not exists last_verified_at timestamptz;

alter table public.document_templates
  add column if not exists last_verified_at timestamptz;

comment on column public.form_templates.last_verified_at is
  'Last time the cached bytes were CONFIRMED current against the authority '
  '(a successful refresh, changed or unchanged). Distinct from last_checked_at '
  '(last attempt) and fetched_at (last time the bytes themselves changed). '
  'Drives the freshness gate in the delivery path.';

comment on column public.document_templates.last_verified_at is
  'Last time the cached bytes were CONFIRMED current against the authority. '
  'See form_templates.last_verified_at.';

-- Backfill: a row currently 'ok' was, by definition, confirmed on its last
-- check. A 'stale'/'blocked'/'error' row was NOT, so it stays null and reads as
-- never-verified — which is the honest answer and makes the gate fire for
-- exactly the rows that need review.
update public.form_templates
   set last_verified_at = last_checked_at
 where status = 'ok' and last_verified_at is null;

update public.document_templates
   set last_verified_at = last_checked_at
 where status = 'ok' and last_verified_at is null;

-- ---------------------------------------------------------------------------
-- 2. Revision ledger
-- ---------------------------------------------------------------------------
-- One table for both caches. This is the opposite call from the one that kept
-- form_templates and document_templates apart, and for a specific reason: that
-- split exists because form_templates' READERS (prefill, the renderer registry)
-- assume every row is a fillable artifact. This table has no such readers — it
-- is append-only audit, nothing branches on `source` except a report — so one
-- table gives operators a single chronological view of everything that moved.

create table if not exists public.template_revisions (
  id             uuid primary key default gen_random_uuid(),

  -- Which cache the row belongs to. Not a foreign key: the ledger must outlive
  -- the row it describes, including a catalog entry that is later removed.
  source         text not null check (source in ('form', 'document')),
  country_code   text not null check (char_length(country_code) between 2 and 12),
  program        text not null check (char_length(program) <= 64),
  code           text not null check (char_length(code) <= 48),
  name           text not null default '' check (char_length(name) <= 250),

  --   first_cache      nothing was cached before this run
  --   revision         a new version label AND new bytes — the normal case
  --   silent_reissue   SAME version label, DIFFERENT bytes. The dangerous one:
  --                    any field mapping built against the old revision keeps
  --                    filling boxes that may have moved, and nothing in the
  --                    label would ever tell you.
  change_kind    text not null
                 check (change_kind in ('first_cache', 'revision', 'silent_reissue')),

  previous_sha256 text check (previous_sha256 is null or char_length(previous_sha256) = 64),
  new_sha256      text not null check (char_length(new_sha256) = 64),
  previous_version_label text check (char_length(previous_version_label) <= 64),
  new_version_label      text check (char_length(new_version_label) <= 64),

  -- Forms only. A field-count move on a prefillable form is the signal that a
  -- mapping review is due; null for documents, which are never filled.
  previous_field_count integer check (previous_field_count is null or previous_field_count >= 0),
  new_field_count      integer check (new_field_count is null or new_field_count >= 0),

  resolved_url   text,
  byte_size      integer check (byte_size is null or byte_size > 0),
  storage_path   text,

  -- Set when an operator has looked at the change. Null = unreviewed, which is
  -- what the health check counts.
  reviewed_at    timestamptz,
  reviewed_by    uuid,

  created_at     timestamptz not null default now()
);

comment on table public.template_revisions is
  'Append-only history of every change to a cached government form or '
  'document. Written by the refresh jobs; read by ops. Never holds applicant data.';

create index if not exists template_revisions_recent_idx
  on public.template_revisions (created_at desc);

-- The ops queue: unreviewed changes, newest first.
create index if not exists template_revisions_unreviewed_idx
  on public.template_revisions (created_at desc)
  where reviewed_at is null;

create index if not exists template_revisions_identity_idx
  on public.template_revisions (source, country_code, program, code, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Sweep findings
-- ---------------------------------------------------------------------------

create table if not exists public.template_sweep_findings (
  id             uuid primary key default gen_random_uuid(),

  -- Which authority index produced it, e.g. 'ircc', 'uscis'.
  authority      text not null check (char_length(authority) <= 32),
  code           text not null check (char_length(code) <= 48),
  title          text not null default '' check (char_length(title) <= 250),
  url            text not null,

  --   new           seen on the authority's index, absent from our catalog
  --   acknowledged  an operator has seen it
  --   added         it is now in the catalog (a code change, not a data change)
  --   ignored       deliberately out of scope (a form for a route we do not serve)
  -- 'added' and 'ignored' are terminal and suppress the finding from the queue.
  status         text not null default 'new'
                 check (status in ('new', 'acknowledged', 'added', 'ignored')),
  note           text check (char_length(note) <= 1000),

  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.template_sweep_findings is
  'Artifacts found on a government forms index that are not in VisaAI''s '
  'catalog. A PROPOSAL queue for a human — the sweep never edits the catalog '
  'itself, because an unreviewed government URL must never reach an applicant.';

create unique index if not exists template_sweep_findings_identity_idx
  on public.template_sweep_findings (authority, code);

create index if not exists template_sweep_findings_open_idx
  on public.template_sweep_findings (last_seen_at desc)
  where status in ('new', 'acknowledged');

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
-- These three are OPS tables, not user-facing: unlike form_templates, no
-- applicant request path reads them. RLS on with NO policy at all therefore
-- denies anon and authenticated completely (RLS denies by default), while the
-- service-role client the jobs and the admin API use bypasses RLS entirely.
-- The explicit revokes below make that intent legible rather than implied.

alter table public.template_revisions enable row level security;
alter table public.template_sweep_findings enable row level security;

revoke insert, update, delete on public.template_revisions from authenticated, anon;
revoke insert, update, delete on public.template_sweep_findings from authenticated, anon;
revoke select on public.template_revisions from authenticated, anon;
revoke select on public.template_sweep_findings from authenticated, anon;
