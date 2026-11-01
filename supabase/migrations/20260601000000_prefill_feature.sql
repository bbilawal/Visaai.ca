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
