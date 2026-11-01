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
