-- ============================================================
-- VisaAI — consolidated migration bundle
-- Generated 2026-06-07 — apply in this order on a FRESH project.
-- Run in Supabase SQL editor (or psql). Files concatenated by timestamp.
-- ============================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260531000000_initial_schema.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Users (extends auth.users)
create table public.users (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  full_name text,
  nationality text,
  stripe_customer_id text,
  created_at timestamptz default now() not null
);
alter table public.users enable row level security;
create policy "users_own_rows" on public.users for all using (auth.uid() = id);

-- Country frameworks (visa requirement rules)
create table public.country_frameworks (
  id uuid primary key default uuid_generate_v4(),
  country_code text not null,
  visa_type text not null,
  purpose text not null,
  requirements_json jsonb not null default '{}',
  updated_at timestamptz default now() not null,
  unique (country_code, visa_type, purpose)
);
alter table public.country_frameworks enable row level security;
-- Write-locked via RLS intentionally: mutations must use service role key only (migrations or admin API).
create policy "frameworks_public_read" on public.country_frameworks for select using (true);

-- Applications
create table public.applications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users on delete cascade,
  framework_id uuid references public.country_frameworks,
  status text not null default 'draft' check (status in ('draft','ready','submitted','decided')),
  plan_tier text not null default 'none' check (plan_tier in ('none','self_service','copilot','expert')),
  vri_score int check (vri_score between 0 and 100), -- denormalized cache from vri_scores; updated by VRI agent after each recalculation
  submitted_at timestamptz,
  decision_at timestamptz,
  created_at timestamptz default now() not null
);
alter table public.applications enable row level security;
create policy "applications_own_rows" on public.applications for all using (auth.uid() = user_id);

-- Application profiles (dynamic intake answers)
create table public.application_profiles (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade unique,
  profile_json jsonb not null default '{}',
  risk_indicators_json jsonb not null default '[]',
  last_updated_at timestamptz default now() not null
);
alter table public.application_profiles enable row level security;
create policy "profiles_own_rows" on public.application_profiles
  for all using (
    auth.uid() = (select user_id from public.applications where id = application_id)
  );

-- Checklist items
create table public.checklist_items (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade,
  document_type text not null,
  label text not null,
  required boolean not null default true,
  status text not null default 'missing' check (status in ('missing','uploaded','verified','waived')),
  added_reason text
);
alter table public.checklist_items enable row level security;
create policy "checklist_own_rows" on public.checklist_items
  for all using (
    auth.uid() = (select user_id from public.applications where id = application_id)
  );

-- Documents
create table public.documents (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade,
  checklist_item_id uuid references public.checklist_items,
  storage_path text not null,
  mime_type text not null,
  file_name text not null,
  encrypted boolean not null default true,
  upload_status text not null default 'pending' check (upload_status in ('pending','complete','failed')),
  ocr_status text not null default 'pending' check (ocr_status in ('pending','complete','failed')),
  created_at timestamptz default now() not null
);
alter table public.documents enable row level security;
create policy "documents_own_rows" on public.documents
  for all using (
    auth.uid() = (select user_id from public.applications where id = application_id)
  );

-- Document verifications
create table public.document_verifications (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.documents on delete cascade,
  verification_type text not null check (verification_type in ('identity','expiry','financial','employment')),
  result text not null check (result in ('pass','warn','fail')),
  details_json jsonb not null default '{}',
  verified_at timestamptz default now() not null
);
alter table public.document_verifications enable row level security;
create policy "doc_verifications_own_rows" on public.document_verifications
  for all using (
    auth.uid() = (
      select a.user_id from public.documents d
      join public.applications a on a.id = d.application_id
      where d.id = document_id
    )
  );

-- Cross verifications
create table public.cross_verifications (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade,
  doc_a_id uuid not null references public.documents,
  doc_b_id uuid not null references public.documents,
  field_compared text not null,
  result text not null check (result in ('match','mismatch','warning')),
  details_json jsonb not null default '{}',
  checked_at timestamptz default now() not null
);
alter table public.cross_verifications enable row level security;
create policy "cross_verifications_own_rows" on public.cross_verifications
  for all using (auth.uid() = (select user_id from public.applications where id = application_id));

-- VRI scores
create table public.vri_scores (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade,
  overall_score int not null check (overall_score between 0 and 100),
  documentation_pct int not null default 0,
  financial_pct int not null default 0,
  travel_history_pct int not null default 0,
  home_ties_pct int not null default 0,
  employment_pct int not null default 0,
  consistency_pct int not null default 0,
  calculated_at timestamptz default now() not null
);
alter table public.vri_scores enable row level security;
create policy "vri_scores_own_rows" on public.vri_scores
  for all using (auth.uid() = (select user_id from public.applications where id = application_id));

-- VRI recommendations
create table public.vri_recommendations (
  id uuid primary key default uuid_generate_v4(),
  vri_score_id uuid not null references public.vri_scores on delete cascade,
  factor text not null,
  issue text not null,
  recommendation_text text not null,
  priority int not null default 0
);
alter table public.vri_recommendations enable row level security;
create policy "vri_recs_own_rows" on public.vri_recommendations
  for all using (
    auth.uid() = (
      select a.user_id from public.vri_scores v
      join public.applications a on a.id = v.application_id
      where v.id = vri_score_id
    )
  );

-- Generated documents
create table public.generated_documents (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade,
  doc_type text not null check (doc_type in ('loe','itinerary','cover_letter')),
  content_md text not null,
  approved_by_user boolean not null default false,
  generated_at timestamptz default now() not null
);
alter table public.generated_documents enable row level security;
create policy "gen_docs_own_rows" on public.generated_documents
  for all using (auth.uid() = (select user_id from public.applications where id = application_id));

-- Submission sessions
create table public.submission_sessions (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade,
  extension_session_id text,
  status text not null default 'pending' check (status in ('pending','active','paused','complete','error')),
  portal_url text,
  started_at timestamptz,
  completed_at timestamptz,
  error_log text
);
alter table public.submission_sessions enable row level security;
create policy "sessions_own_rows" on public.submission_sessions
  for all using (auth.uid() = (select user_id from public.applications where id = application_id));

-- Post-submission events
create table public.post_submission_events (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade,
  event_type text not null check (event_type in ('biometrics','passport_request','adr','medical','approval','refusal')),
  raw_email_encrypted text,
  summary text,
  deadline timestamptz,
  status text not null default 'new' check (status in ('new','actioned','complete')),
  received_at timestamptz default now() not null
);
alter table public.post_submission_events enable row level security;
create policy "events_own_rows" on public.post_submission_events
  for all using (auth.uid() = (select user_id from public.applications where id = application_id));

-- Action items
create table public.action_items (
  id uuid primary key default uuid_generate_v4(),
  post_submission_event_id uuid not null references public.post_submission_events on delete cascade,
  task_type text not null,
  status text not null default 'pending' check (status in ('pending','in_progress','complete')),
  due_at timestamptz,
  completed_at timestamptz
);
alter table public.action_items enable row level security;
create policy "action_items_own_rows" on public.action_items
  for all using (
    auth.uid() = (
      select a.user_id from public.post_submission_events e
      join public.applications a on a.id = e.application_id
      where e.id = post_submission_event_id
    )
  );

-- Payments (one-time Stripe payments per application)
create table public.payments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users on delete cascade,
  application_id uuid not null references public.applications on delete cascade,
  stripe_payment_intent_id text unique,
  plan_tier text not null check (plan_tier in ('self_service','copilot','expert')),
  status text not null default 'pending' check (status in ('pending','complete','failed','refunded')),
  created_at timestamptz default now() not null
);
alter table public.payments enable row level security;
create policy "payments_own_rows" on public.payments for all using (auth.uid() = user_id);

-- Auto-create user record on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Canada TRV framework seed
insert into public.country_frameworks (country_code, visa_type, purpose, requirements_json) values (
  'CA', 'TRV', 'tourism',
  '{
    "base_documents": [
      {"type": "passport", "label": "Valid Passport"},
      {"type": "photo", "label": "Passport-sized Photos"},
      {"type": "application_form", "label": "IMM5257 Application Form"},
      {"type": "bank_statement", "label": "Bank Statement (last 6 months)"}
    ],
    "branch_rules": [
      {
        "condition": {"question": "employed", "answer": true},
        "add": [
          {"type": "employment_letter", "label": "Employment Letter"},
          {"type": "pay_stubs", "label": "Recent Pay Stubs (3 months)"},
          {"type": "noa", "label": "Notice of Assessment"}
        ]
      },
      {
        "condition": {"question": "self_employed", "answer": true},
        "add": [
          {"type": "business_registration", "label": "Business Registration"},
          {"type": "financial_statements", "label": "Business Financial Statements"}
        ]
      },
      {
        "condition": {"question": "has_property", "answer": true},
        "add": [
          {"type": "property_deed", "label": "Property Ownership Document"}
        ]
      },
      {
        "condition": {"question": "has_family_in_canada", "answer": true},
        "add": [
          {"type": "invitation_letter", "label": "Letter of Invitation from Canadian Host"},
          {"type": "host_status_proof", "label": "Host Immigration Status Proof"}
        ]
      }
    ]
  }'
);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260531000001_cross_verifications_unique.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Unique constraint so concurrent document graph runs can upsert cross-verification
-- results idempotently instead of racing on delete-then-insert.
alter table public.cross_verifications
  add constraint cross_verifications_unique_pair_field
  unique (application_id, doc_a_id, doc_b_id, field_compared);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260531000002_documents_document_type.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Persist the inferred document type on the documents row so cross-verification
-- can reference it without joining through checklist_items.
alter table public.documents add column if not exists document_type text;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260531000003_application_monitor_token.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Per-application inbound email token. Users forward immigration emails to
-- visaai+<monitor_token>@inbound.postmarkapp.com; Postmark posts the parsed mail
-- and we resolve the application by this token.
alter table public.applications add column if not exists monitor_token text unique;
create index if not exists idx_applications_monitor_token on public.applications (monitor_token);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260601000000_prefill_feature.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Allow generated_documents to store the AI-prefilled application form JSON
alter table public.generated_documents
  drop constraint if exists generated_documents_doc_type_check;

alter table public.generated_documents
  add constraint generated_documents_doc_type_check
  check (doc_type in ('loe','itinerary','cover_letter','prefilled_form_json'));

-- Payments now distinguish plan upgrades from one-time feature purchases (e.g. prefill).
-- Existing rows are plan purchases.
alter table public.payments
  add column if not exists feature text not null default 'plan'
  check (feature in ('plan','prefill'));

-- plan_tier is no longer required for non-plan payments (e.g. one-time prefill fee).
alter table public.payments
  alter column plan_tier drop not null;

-- Index to quickly look up whether a given application has paid for the prefill feature.
create index if not exists payments_application_feature_status_idx
  on public.payments (application_id, feature, status);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260601000001_application_destination.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Add destination country/state to applications so users can start an
-- application without pre-committing to a specific visa framework. The
-- intake agent now operates in "discovery mode" until enough is known
-- about the applicant to recommend (and later attach) a framework.

alter table public.applications
  add column if not exists destination_country text,
  add column if not exists destination_state text;

create index if not exists applications_destination_country_idx
  on public.applications (destination_country);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260601000002_intake_messages.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Persisted transcript of the intake AI interview.
-- Lets the chat survive page reloads and cross-page navigation; the Redis
-- LangGraph checkpoint stays the source of truth for graph state, while this
-- table is the durable user-facing transcript.
create table public.intake_messages (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz default now() not null
);

create index intake_messages_app_idx on public.intake_messages (application_id, created_at);

alter table public.intake_messages enable row level security;
create policy "intake_messages_own_rows" on public.intake_messages
  for all using (
    auth.uid() = (select user_id from public.applications where id = application_id)
  );


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260602000000_vri_visa_suggestions.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- VRI visa category suggestions
-- After VRI calculation, the AI suggests alternative visa categories for the
-- destination country that have higher approval odds for the applicant, along
-- with the official required documents sourced from the country's official
-- visa portal (encoded in the LLM's knowledge base).

create table public.vri_visa_suggestions (
  id uuid primary key default uuid_generate_v4(),
  vri_score_id uuid not null references public.vri_scores on delete cascade,
  country_code text not null,
  visa_category text not null,
  approval_likelihood int not null check (approval_likelihood between 0 and 100),
  reasoning text not null,
  required_documents jsonb not null default '[]',
  official_source text,
  rank int not null default 0
);

alter table public.vri_visa_suggestions enable row level security;
create policy "vri_visa_suggestions_own_rows" on public.vri_visa_suggestions
  for all using (
    auth.uid() = (
      select a.user_id from public.vri_scores v
      join public.applications a on a.id = v.application_id
      where v.id = vri_score_id
    )
  );

create index if not exists vri_visa_suggestions_score_idx
  on public.vri_visa_suggestions (vri_score_id, rank);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260602000001_submission_login_status.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Submission sessions: allow 'awaiting_login' state for the sidecar persistent-profile
-- flow. When the user is not signed in to the destination portal in the sidecar's
-- browser profile, the gateway parks the session in 'awaiting_login' until the
-- sidecar detects a successful sign-in and resumes the fill plan.

alter table public.submission_sessions
  drop constraint if exists submission_sessions_status_check;

alter table public.submission_sessions
  add constraint submission_sessions_status_check
  check (status in ('pending','awaiting_login','active','paused','complete','error'));


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260602000002_checklist_meta_and_forms.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Distinguish "required forms" (e.g. DS-160, IMM 5257) from supporting
-- documents on VRI visa suggestions, and let the application checklist carry
-- form-specific metadata (form code, download URL) so the documents page can
-- group forms separately and link the user straight to the official source.

alter table public.vri_visa_suggestions
  add column if not exists required_forms jsonb not null default '[]';

alter table public.checklist_items
  add column if not exists meta jsonb not null default '{}';

create index if not exists checklist_items_meta_kind_idx
  on public.checklist_items ((meta->>'kind'));


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260602000003_submission_drop_awaiting_login.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Submission sessions: drop the 'awaiting_login' status. It was added for the
-- Electron sidecar's persistent-profile sign-in detection flow, which has been
-- replaced by the Chrome-extension-only flow (the user signs in to the portal
-- in their own browser tab before launching the assistant).

alter table public.submission_sessions
  drop constraint if exists submission_sessions_status_check;

alter table public.submission_sessions
  add constraint submission_sessions_status_check
  check (status in ('pending','active','paused','complete','error'));


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260603000000_checklist_owner.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Checklist items now distinguish who is responsible for each form/document:
-- the visa "applicant" or their "sponsor"/host. The value lives in meta->>'owner'
-- (alongside meta.kind and meta.specs), so no column change is needed — but an
-- index keeps the documents page's owner-grouped queries cheap.

create index if not exists checklist_items_meta_owner_idx
  on public.checklist_items ((meta->>'owner'));


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260603000000_document_privacy.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Document privacy hardening.
--
-- 1. Ensure the `documents` storage bucket exists and is PRIVATE. The bucket
--    was previously assumed to exist (created via the dashboard) — defaulting
--    it here prevents an accidental public bucket from leaking PII.
-- 2. Add path-scoped storage policies so a signed-in user can only read/write
--    objects whose first path segment matches their uid (matches the
--    `${userId}/${applicationId}/...` convention in documents.service.ts).
-- 3. Add `document_access_logs` to record who viewed/downloaded/deleted what,
--    so users can see an audit trail in the Privacy & Security panel.

-- 1. Private bucket --------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;

-- 2. Storage object policies ----------------------------------------------

drop policy if exists "documents_owner_select" on storage.objects;
drop policy if exists "documents_owner_insert" on storage.objects;
drop policy if exists "documents_owner_update" on storage.objects;
drop policy if exists "documents_owner_delete" on storage.objects;

create policy "documents_owner_select" on storage.objects
  for select using (
    bucket_id = 'documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "documents_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "documents_owner_update" on storage.objects
  for update using (
    bucket_id = 'documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "documents_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- 3. Audit log -------------------------------------------------------------

create table if not exists public.document_access_logs (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.documents on delete cascade,
  application_id uuid not null references public.applications on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  action text not null check (action in ('upload','view','download','delete','ocr')),
  occurred_at timestamptz not null default now()
);

create index if not exists document_access_logs_app_time_idx
  on public.document_access_logs (application_id, occurred_at desc);

alter table public.document_access_logs enable row level security;

create policy "access_logs_own_rows" on public.document_access_logs
  for select using (auth.uid() = user_id);


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260603020000_application_activity_view.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Read-only view: derived last-activity per application.
-- greatest() across every child timestamp that signals user activity.
-- No writes to applications; reminders + dashboard read from here.
-- security_invoker enforces the querying user's RLS on the base tables, so the
-- web client (user session) only ever sees its own applications' activity.
-- The reminder job uses the service role, which bypasses RLS as intended.
create or replace view public.application_activity
  with (security_invoker = true) as
select
  a.id as application_id,
  a.user_id,
  greatest(
    a.created_at,
    coalesce(p.last_updated_at, a.created_at),
    coalesce(d.max_created, a.created_at),
    coalesce(g.max_generated, a.created_at),
    coalesce(v.max_calculated, a.created_at),
    coalesce(s.max_session, a.created_at)
  ) as last_active_at
from public.applications a
left join public.application_profiles p on p.application_id = a.id
left join (
  select application_id, max(created_at) as max_created
  from public.documents group by application_id
) d on d.application_id = a.id
left join (
  select application_id, max(generated_at) as max_generated
  from public.generated_documents group by application_id
) g on g.application_id = a.id
left join (
  select application_id, max(calculated_at) as max_calculated
  from public.vri_scores group by application_id
) v on v.application_id = a.id
left join (
  -- submission_sessions has no created/updated column; started_at and
  -- completed_at are the lifecycle timestamps that signal user activity.
  select application_id, max(greatest(started_at, completed_at)) as max_session
  from public.submission_sessions group by application_id
) s on s.application_id = a.id;

comment on view public.application_activity is
  'Derived last-activity per application (Epic B). Read-only, no write-path.';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260603020001_reminders.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Epic B reminders: append-only dedupe log + per-user opt-out.

alter table public.users
  add column if not exists email_reminders boolean not null default true;

create table if not exists public.reminder_log (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  stage text not null,
  kind text not null check (kind in ('stall_3','stall_7','stall_14')),
  sent_at timestamptz not null default now()
);

create unique index if not exists reminder_log_app_kind_idx
  on public.reminder_log (application_id, kind);

alter table public.reminder_log enable row level security;

-- Only the service role writes/reads reminder_log; no client policy granted.
comment on table public.reminder_log is
  'Epic B: append-only reminder dedupe. Service-role only.';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260604000000_analytics.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Analytics + marketing instrumentation (Strategy Action 8 + 19).
--
-- Design rules:
--  * PII-MINIMIZED. `properties` and attribution columns must NEVER contain
--    document contents, passport/financial data, free-text answers, or email
--    bodies. Store IDs, enums, counts, stage names, and campaign tags only.
--    The application layer is responsible for not writing PII here.
--  * RLS-protected. Users can read only their own rows. Inserts come from the
--    authenticated user (own rows) or the API service role (system events).
--  * North-star metric = an application reaching a Readiness (VRI) score.

-- ── Event log ────────────────────────────────────────────────────────────────
create table if not exists public.analytics_events (
  id uuid primary key default uuid_generate_v4(),
  -- user_id null while a visitor is pre-signup; correlate later via anon_id.
  user_id uuid references public.users on delete set null,
  anon_id text,                         -- first-party cookie id, pre-auth
  application_id uuid references public.applications on delete set null,
  event_name text not null,             -- e.g. 'application_readiness_reached'
  stage text,                           -- intake|documents|narrative|readiness|submission|tracking
  properties jsonb not null default '{}'::jsonb,  -- PII-FREE metadata only
  occurred_at timestamptz not null default now()
);

create index if not exists analytics_events_user_time_idx
  on public.analytics_events (user_id, occurred_at desc);
create index if not exists analytics_events_name_time_idx
  on public.analytics_events (event_name, occurred_at desc);
create index if not exists analytics_events_app_idx
  on public.analytics_events (application_id);
create index if not exists analytics_events_anon_idx
  on public.analytics_events (anon_id) where anon_id is not null;

alter table public.analytics_events enable row level security;

create policy "analytics_events_select_own" on public.analytics_events
  for select using (auth.uid() = user_id);
create policy "analytics_events_insert_own" on public.analytics_events
  for insert with check (user_id is null or auth.uid() = user_id);

comment on table public.analytics_events is
  'PII-FREE product + funnel events. Never store document/identity/financial data or free text here.';

-- ── Marketing attribution (one row per user, first + last touch) ─────────────
create table if not exists public.marketing_attribution (
  user_id uuid primary key references public.users on delete cascade,
  anon_id text,
  first_touch_at timestamptz not null default now(),
  last_touch_at timestamptz not null default now(),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referrer_host text,                   -- host only, not full URL with query/PII
  landing_path text                     -- path only, strip query string in app layer
);

alter table public.marketing_attribution enable row level security;

create policy "marketing_attribution_select_own" on public.marketing_attribution
  for select using (auth.uid() = user_id);
create policy "marketing_attribution_upsert_own" on public.marketing_attribution
  for insert with check (auth.uid() = user_id);
create policy "marketing_attribution_update_own" on public.marketing_attribution
  for update using (auth.uid() = user_id);

comment on table public.marketing_attribution is
  'Campaign attribution per user. Store host/path/utm tags only, never full URLs or PII.';

-- ── North-star funnel view ───────────────────────────────────────────────────
-- Furthest stage reached per application, for funnel + north-star (readiness).
-- security_invoker so the querying user only sees their own applications via RLS.
create or replace view public.v_application_funnel
with (security_invoker = on) as
select
  a.id            as application_id,
  a.user_id,
  a.status,
  a.created_at,
  exists (
    select 1 from public.vri_scores v where v.application_id = a.id
  )               as reached_readiness,   -- north-star flag
  (
    select max(e.occurred_at)
    from public.analytics_events e
    where e.application_id = a.id
      and e.event_name = 'application_readiness_reached'
  )               as readiness_reached_at
from public.applications a;

comment on view public.v_application_funnel is
  'North-star funnel: reached_readiness marks an application that earned a VRI score.';

-- ── Outcome reporting (the data moat) ────────────────────────────────────────
-- User-reported real decisions. Over time this is what turns the heuristic VRI
-- score into an outcome-calibrated model. Self-reported, optional, never shared.
create table if not exists public.application_outcomes (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  outcome text not null check (outcome in ('approved','refused','withdrawn','pending')),
  decided_at date,                      -- date only; no need for finer PII granularity
  refusal_reasons text[],               -- optional, user-selected from a fixed list (not free text)
  reported_at timestamptz not null default now(),
  unique (application_id)
);

create index if not exists application_outcomes_outcome_idx
  on public.application_outcomes (outcome);

alter table public.application_outcomes enable row level security;

create policy "application_outcomes_select_own" on public.application_outcomes
  for select using (auth.uid() = user_id);
create policy "application_outcomes_insert_own" on public.application_outcomes
  for insert with check (auth.uid() = user_id);
create policy "application_outcomes_update_own" on public.application_outcomes
  for update using (auth.uid() = user_id);

comment on table public.application_outcomes is
  'Self-reported visa decisions. refusal_reasons must come from a fixed list, not free text (no PII).';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260604000001_ops_analytics.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Agent-company operations analytics (Strategy Action 8, ops layer).
--
-- These tables are INTERNAL operational data, not user-owned. They track the
-- product portfolio, experiments, marketing, revenue, and agent runs.
--
-- Security model: RLS is ENABLED with NO client policies, so anon/authenticated
-- clients get zero access. Only the service-role key (server-side ops jobs)
-- can read/write them. PII-MINIMIZED: store IDs, enums, tags, counts, and
-- aggregates only. Never store end-user identity, document, or contact data here.

-- ── Product portfolio ────────────────────────────────────────────────────────
create table if not exists public.ops_products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  status text not null default 'idea'
    check (status in ('idea','research','building','launched','paused','killed')),
  market text,
  opportunity_score int check (opportunity_score between 0 and 100),
  legal_risk text check (legal_risk in ('low','medium','high','critical')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Experiments ──────────────────────────────────────────────────────────────
create table if not exists public.ops_experiments (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references public.ops_products on delete cascade,
  hypothesis text not null,
  variant text,
  metric text,
  status text not null default 'planned'
    check (status in ('planned','running','complete','abandoned')),
  result text,
  ice_score numeric,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── Marketing events ─────────────────────────────────────────────────────────
create table if not exists public.ops_marketing_events (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references public.ops_products on delete cascade,
  channel text not null,                -- seo|paid_search|content|reddit|linkedin|youtube|product_hunt|referral|partnership
  campaign text,
  event_type text not null,             -- impression|click|signup|activation|spend
  metrics jsonb not null default '{}'::jsonb,  -- counts/costs only, no PII
  occurred_at timestamptz not null default now()
);

create index if not exists ops_marketing_events_product_time_idx
  on public.ops_marketing_events (product_id, occurred_at desc);
create index if not exists ops_marketing_events_channel_idx
  on public.ops_marketing_events (channel);

-- ── Revenue ──────────────────────────────────────────────────────────────────
create table if not exists public.ops_revenue (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references public.ops_products on delete cascade,
  source text not null,                 -- pay_per_app|subscription|consultant|enterprise
  amount_cents bigint not null default 0,
  currency text not null default 'CAD',
  mrr_cents bigint,
  stripe_ref text,                      -- opaque Stripe id, not card data
  occurred_at timestamptz not null default now()
);

create index if not exists ops_revenue_product_time_idx
  on public.ops_revenue (product_id, occurred_at desc);

-- ── Agent runs ───────────────────────────────────────────────────────────────
create table if not exists public.ops_agent_runs (
  id uuid primary key default uuid_generate_v4(),
  agent text not null,                  -- e.g. trend-researcher, backend-architect
  task text,
  product_id uuid references public.ops_products on delete set null,
  status text not null default 'running'
    check (status in ('running','completed','failed')),
  cost_usd numeric,
  tokens int,
  output_ref text,                      -- pointer (path/url), not the full output
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists ops_agent_runs_agent_time_idx
  on public.ops_agent_runs (agent, started_at desc);

-- ── Lock down: service-role only (RLS on, no client policies) ─────────────────
alter table public.ops_products enable row level security;
alter table public.ops_experiments enable row level security;
alter table public.ops_marketing_events enable row level security;
alter table public.ops_revenue enable row level security;
alter table public.ops_agent_runs enable row level security;

comment on table public.ops_products is
  'Internal ops. Service-role only (RLS on, no client policies). No end-user PII.';
comment on table public.ops_revenue is
  'Internal ops. stripe_ref is an opaque id; never store card/payment-instrument data.';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000000_verification_enums.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000001_ocr_runs.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000002_field_provenance.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000003_field_verifications.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000004_audit_events.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000005_consultant_approvals.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000006_preflight_reviews.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000007_evidence_packages.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000008_field_provenance_versioning.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000009_consultant_decision_revoked.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000010_audit_event_execution_ready.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260606000011_audit_events_execution_request.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260607000000_consumed_readback_tokens.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: 20260607000001_audit_event_legacy_blocked.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
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

