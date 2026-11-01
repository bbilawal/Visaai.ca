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

drop policy if exists "access_logs_own_rows" on public.document_access_logs;
create policy "access_logs_own_rows" on public.document_access_logs
  for select using (auth.uid() = user_id);
