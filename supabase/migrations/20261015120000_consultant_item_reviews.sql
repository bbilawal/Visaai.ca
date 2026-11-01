-- =====================================================================
-- Consultant review of every uploaded document and generated item.
-- Date: 2026-10-15
--
-- 1. application_item_reviews — append-only per-item review decisions the
--    assigned consultant records on an uploaded document (documents.id), a
--    generated letter (generated_documents.id: loe / itinerary / cover_letter)
--    or the prefilled application form (generated_documents.id,
--    doc_type prefilled_form_json). The latest row per item is the current
--    decision. The applicant can read decisions on their own application.
--
-- 2. generated_document_revisions — the content of a generated document as it
--    was BEFORE each overwrite: a consultant edit (review panel) or an
--    applicant "approve with edits" (narrative approve). generated_documents is
--    edited in place, so without this either side's text could be erased with
--    no way back; the audit trail (audit_events) carries only hashes.
--
-- Writes are service-role only (the API checks the active assignment first).
-- Apply BEFORE deploying the API code that uses it:
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- =====================================================================

create table if not exists public.application_item_reviews (
  id             uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade,
  item_kind      text not null check (item_kind in ('document', 'generated')),
  -- documents.id (item_kind = 'document') or generated_documents.id
  -- (item_kind = 'generated'). Not an FK: one column spans two tables.
  item_id        uuid not null,
  decision       text not null
                   check (decision in ('approved', 'needs_reupload', 'changes_requested', 'rejected')),
  note           text check (note is null or length(note) <= 2000),
  reviewer_id    uuid references public.users on delete set null,
  reviewer_role  text not null check (reviewer_role in ('consultant', 'admin')),
  created_at     timestamptz not null default now(),
  -- anything other than an approval must say why — the applicant acts on it
  constraint application_item_reviews_note_required
    check (decision = 'approved' or (note is not null and length(btrim(note)) > 0)),
  constraint application_item_reviews_reupload_is_document
    check (decision <> 'needs_reupload' or item_kind = 'document')
);

create index if not exists application_item_reviews_item_idx
  on public.application_item_reviews (application_id, item_kind, item_id, created_at desc);

alter table public.application_item_reviews enable row level security;

drop policy if exists application_item_reviews_select on public.application_item_reviews;
create policy application_item_reviews_select on public.application_item_reviews
  for select using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(application_id, auth.uid())
    or auth.uid() = (select user_id from public.applications where id = application_id)
  );
-- No insert/update/delete policies: service-role writes only.

comment on table public.application_item_reviews is
  'Consultant per-item review decisions (documents, generated letters, prefilled form). Append-only; latest row per item wins. Service-role write.';

create table if not exists public.generated_document_revisions (
  id                     uuid primary key default uuid_generate_v4(),
  generated_document_id  uuid not null references public.generated_documents on delete cascade,
  application_id         uuid not null references public.applications on delete cascade,
  content_md             text not null,   -- the content BEFORE the edit
  edited_by              uuid references public.users on delete set null,
  edited_role            text not null check (edited_role in ('applicant', 'consultant', 'admin')),
  note                   text,
  created_at             timestamptz not null default now()
);

create index if not exists generated_document_revisions_doc_idx
  on public.generated_document_revisions (generated_document_id, created_at desc);

alter table public.generated_document_revisions enable row level security;

drop policy if exists generated_document_revisions_select on public.generated_document_revisions;
create policy generated_document_revisions_select on public.generated_document_revisions
  for select using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(application_id, auth.uid())
    or auth.uid() = (select user_id from public.applications where id = application_id)
  );

comment on table public.generated_document_revisions is
  'Prior content of a generated document, captured before each overwrite (consultant edit or applicant approve-with-edits). Service-role write.';
