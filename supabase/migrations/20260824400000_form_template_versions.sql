-- Preserve superseded government forms instead of overwriting them.
--
-- WHAT WAS WRONG
--
-- `form_templates` carries a UNIQUE index on (country_code, program, form_code),
-- so there is exactly one row per form and a new revision has nowhere to go but
-- on top of the old one. Specification §9 is explicit in the other direction:
-- "Never silently overwrite a prior official form. Preserve versions", then
-- "store a new version", "mark the prior version superseded", "preserve
-- history".
--
-- The FILE bytes were never actually lost — `storagePathFor` is version-scoped,
-- so a new revision lands at a new object-storage path. What was lost is every
-- pointer to it. Once the row was overwritten nothing in the database referred
-- to the previous PDF, leaving an orphan blob that no query could find and no
-- reviewer could compare against. "The bytes are still in a bucket somewhere"
-- is not preserved history.
--
-- The code knew. form-template.store.ts says the previous-revision promise is
-- "a caller obligation, not something this method enforces" — and this codebase
-- has already paid for that arrangement once, when two Schengen lists held
-- together by a comment reading "MUST stay byte-identical" drifted for about
-- nineteen months. A comment is not an enforcement mechanism.
--
-- WHY THIS SHAPE
--
-- It deliberately mirrors `visa_source_versions`, which solves the identical
-- problem for HTML sources and has 162 rows of operating history: a monotonic
-- version_number per parent, a sha256, one active version at a time. Using the
-- proven local pattern beats inventing a second one, and it means B-23's lesson
-- carries over — version numbers come from the HIGHEST existing version, never
-- from the active one, because an inactive version above the active one is a
-- normal state rather than a corruption.

create table if not exists public.form_template_versions (
  id                uuid primary key default gen_random_uuid(),
  form_template_id  uuid not null references public.form_templates(id) on delete cascade,
  version_number    integer not null,
  sha256            text not null,
  storage_path      text not null,
  version_label     text,
  byte_size         integer,
  capability        text,
  field_count       integer,
  -- The URL this revision actually came from. Authorities move PDFs between
  -- paths while keeping the form number, so the parent row's current URL is not
  -- evidence about where an older revision was fetched.
  resolved_pdf_url  text,
  fetched_at        timestamptz not null default now(),
  is_active         boolean not null default true,
  superseded_at     timestamptz,
  created_at        timestamptz not null default now(),

  constraint form_template_versions_seq_uniq unique (form_template_id, version_number),
  -- A superseded version must say when, and an active one must not claim to
  -- have been superseded. Without this the flag and the timestamp can disagree
  -- and neither can be trusted.
  constraint form_template_versions_supersede_ck
    check ((is_active and superseded_at is null) or (not is_active and superseded_at is not null))
);

-- Exactly one active revision per form. A partial unique index rather than a
-- trigger: the database refuses the second active row outright, so a concurrent
-- refresh cannot briefly publish two.
create unique index if not exists form_template_versions_one_active_idx
  on public.form_template_versions (form_template_id)
  where is_active;

create index if not exists form_template_versions_sha_idx
  on public.form_template_versions (sha256);

comment on table public.form_template_versions is
  'Version history for cached official government forms (spec §9). One active '
  'row per form_template; superseded rows keep their storage_path so the '
  'previous PDF stays reachable and comparable.';

-- Backfill: every currently cached form becomes version 1, active.
--
-- This is the honest starting point rather than a reconstruction. Revisions
-- that were overwritten before this table existed are gone as records — their
-- bytes may still sit in the bucket, but nothing knows their version label,
-- their fetch date or which form they belonged to, and inventing those would be
-- worse than admitting the history starts here.
insert into public.form_template_versions
  (form_template_id, version_number, sha256, storage_path, version_label,
   byte_size, capability, field_count, resolved_pdf_url, fetched_at, is_active)
select
  t.id, 1, t.sha256, t.storage_path, t.version_label,
  t.byte_size, t.capability, t.field_count, t.resolved_pdf_url,
  coalesce(t.fetched_at, t.created_at, now()), true
from public.form_templates t
where t.sha256 is not null
  and t.storage_path is not null
  and not exists (
    select 1 from public.form_template_versions v where v.form_template_id = t.id
  );

alter table public.form_template_versions enable row level security;

-- Service-role only, matching form_templates: these are operational records
-- about cached government files, not user-owned data.
drop policy if exists form_template_versions_service_all on public.form_template_versions;
create policy form_template_versions_service_all
  on public.form_template_versions
  for all
  to service_role
  using (true)
  with check (true);

-- Assert what this migration claims, before it commits. Every promotion
-- migration in this repository does the same, and one of them has already
-- refused to commit on a claim that turned out to be false.
do $$
declare
  cached_forms   integer;
  backfilled     integer;
  multi_active   integer;
begin
  select count(*) into cached_forms
    from public.form_templates
   where sha256 is not null and storage_path is not null;

  select count(*) into backfilled from public.form_template_versions;

  if backfilled <> cached_forms then
    raise exception
      'form_template_versions backfill mismatch: % cached forms but % version rows',
      cached_forms, backfilled;
  end if;

  select count(*) into multi_active from (
    select form_template_id
      from public.form_template_versions
     where is_active
     group by form_template_id
    having count(*) > 1
  ) x;

  if multi_active <> 0 then
    raise exception '% form(s) have more than one active version', multi_active;
  end if;

  raise notice 'form_template_versions: % form(s) backfilled as version 1', backfilled;
end $$;
