-- Task 15 §6 — beta feedback capture.
--
-- WHY THIS EXISTS
--
-- `apps/api/src/modules/` had 46 modules and none of them collected feedback:
-- no bug report, no satisfaction score, no AI-response rating, no support
-- ticket. The only "feedback" string in the backend belonged to the consultant
-- marketplace's review feature. Task 15's completion gate requires feedback to
-- be *active*, so the capture path is built rather than described.
--
-- PRIVACY POSTURE — the constraint that shaped this table
--
-- Task 15 §6 ends with "Do not capture sensitive application data
-- unnecessarily." Immigration feedback is an unusually dangerous free-text
-- field: a frustrated user describing a bug will paste a passport number, a
-- refusal letter, or a family member's medical history without being asked to.
-- Three structural mitigations, in order of how much they actually buy:
--
--   1. `message` is capped at 2000 characters and is the ONLY free-text field
--      a client can write. There is no "paste your application here" affordance
--      anywhere in the schema.
--   2. `context` is a jsonb blob the SERVER builds from an allowlist
--      (`FEEDBACK_CONTEXT_KEYS` in feedback.service.ts) — the client cannot put
--      arbitrary keys in it. Client-supplied device metadata lands in
--      `device` and is likewise allowlisted.
--   3. `application_id` is a reference, never a copy. Support reads the case
--      through the normal RLS-scoped path with its own authorization, so
--      feedback never becomes a second, unpoliced copy of case data.
--
-- Screenshots are opt-in twice over: the client must set `diagnostics_consent`
-- AND upload to the private `feedback` bucket under its own uid prefix. No
-- screenshot is ever captured automatically.
--
-- RETENTION
--
-- Feedback is operational data, not a record of processing: it is deleted with
-- the user (`on delete cascade`), unlike `privacy_requests` which must survive
-- erasure. `docs/beta-launch/feedback-process.md` records the 24-month
-- operational retention ceiling and who reviews it.

-- ---------------------------------------------------------------------------
-- Private screenshot bucket
-- ---------------------------------------------------------------------------
-- Same shape as `documents`: private, path-scoped to `<uid>/…`. Created here
-- rather than assumed-from-dashboard, for the reason the document-privacy
-- migration gives — an accidentally public bucket holding user screenshots of
-- an immigration app is a reportable breach.

insert into storage.buckets (id, name, public)
values ('feedback', 'feedback', false)
on conflict (id) do update set public = false;

drop policy if exists "feedback_owner_select" on storage.objects;
drop policy if exists "feedback_owner_insert" on storage.objects;
drop policy if exists "feedback_owner_delete" on storage.objects;

create policy "feedback_owner_select" on storage.objects
  for select using (
    bucket_id = 'feedback'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "feedback_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'feedback'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- No owner UPDATE policy: a screenshot attached to a filed report must not be
-- swapped out from under the reviewer. Deletion stays available so a user can
-- withdraw an attachment they regret.
create policy "feedback_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'feedback'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ---------------------------------------------------------------------------
-- Feedback
-- ---------------------------------------------------------------------------

create table if not exists public.beta_feedback (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users on delete cascade,

  kind           text not null check (kind in (
                   'bug',                -- something is broken
                   'feature_request',    -- something is missing
                   'satisfaction',       -- CSAT / NPS-style score
                   'ai_response',        -- rating of one AI answer
                   'consultant',         -- rating of a consultant interaction
                   'other'
                 )),

  -- 1–5 for satisfaction/ai_response/consultant; null for bug/feature_request.
  -- The pairing is enforced below rather than left to the service, because a
  -- satisfaction row with no score is silently useless in a metrics rollup.
  rating         smallint check (rating between 1 and 5),

  message        text not null default '' check (char_length(message) <= 2000),

  -- Where it came from. Drives per-surface crash/quality metrics and tells
  -- support which build to reproduce on.
  surface        text not null check (surface in ('web', 'ios', 'android', 'extension')),
  app_version    text not null default '' check (char_length(app_version) <= 64),

  -- SERVER-BUILT, allowlisted. See FEEDBACK_CONTEXT_KEYS.
  context        jsonb not null default '{}'::jsonb,
  -- CLIENT-SUPPLIED, allowlisted and size-capped by the service.
  device         jsonb not null default '{}'::jsonb,

  -- Reference, never a copy.
  application_id uuid references public.applications on delete set null,

  diagnostics_consent boolean not null default false,
  -- `<uid>/<feedback-id>.<ext>` in the private `feedback` bucket.
  screenshot_path text,

  -- Triage. Task 15 §6 "Feedback classification / ownership / response status".
  status         text not null default 'new' check (status in (
                   'new', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate'
                 )),
  severity       text check (severity in ('critical', 'high', 'medium', 'low')),
  owner_id       uuid references public.users on delete set null,
  resolution     text check (char_length(resolution) <= 2000),
  resolved_at    timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A score-bearing kind must carry a score; a text-only kind must not pretend
  -- to have one.
  constraint beta_feedback_rating_matches_kind check (
    (kind in ('satisfaction', 'ai_response', 'consultant') and rating is not null)
    or (kind in ('bug', 'feature_request', 'other') and rating is null)
  ),
  -- An attachment without consent is a privacy defect, so make it unstorable.
  constraint beta_feedback_screenshot_requires_consent check (
    screenshot_path is null or diagnostics_consent
  )
);

comment on table public.beta_feedback is
  'Closed-beta feedback (Task 15 §6). message is the only client free-text '
  'field; context/device are allowlisted. Never store application content.';

-- Support queue: "everything not yet resolved, newest first".
create index if not exists beta_feedback_triage_idx
  on public.beta_feedback (status, created_at desc);

create index if not exists beta_feedback_user_idx
  on public.beta_feedback (user_id, created_at desc);

-- Quality rollups slice by kind+surface over a window.
create index if not exists beta_feedback_kind_surface_idx
  on public.beta_feedback (kind, surface, created_at desc);

alter table public.beta_feedback enable row level security;

-- A user may file feedback as themselves and read their own back (the beta UI
-- shows "your reports" and their status — Task 15 §6 "Resolution
-- communication"). They may not change it after filing: an editable bug report
-- invalidates the reviewer's copy. Triage writes are service-role only.
-- Dropped first, like the storage policies above. CREATE POLICY has no
-- IF NOT EXISTS in PostgreSQL, so without these the file cannot be re-run —
-- which matters the moment a run fails partway. It did: an earlier production
-- attempt created the table and both policies, then aborted on the missing
-- touch_updated_at(), and the retry died on "policy already exists" rather
-- than finishing the job.
drop policy if exists beta_feedback_self_insert on public.beta_feedback;
drop policy if exists beta_feedback_self_read on public.beta_feedback;

create policy beta_feedback_self_insert
  on public.beta_feedback
  for insert
  with check (auth.uid() = user_id);

create policy beta_feedback_self_read
  on public.beta_feedback
  for select
  using (auth.uid() = user_id);

drop trigger if exists beta_feedback_touch on public.beta_feedback;
create trigger beta_feedback_touch
  before update on public.beta_feedback
  for each row execute function public.touch_updated_at();
