-- =====================================================================
-- Messaging P2: message_attachments, voice_messages, document_requests.
-- RLS mirrors the P1 conversation-access predicate (owner OR admin OR
-- public.is_active_assignee), gating on the parent conversation's application.
-- Files live in the existing private `documents` bucket and are accessed ONLY
-- via service-role signed URLs issued by the API after a conversation-access
-- check — so no storage.objects policy changes are needed here.
-- Author: messaging P2  Date: 2026-06-12
-- =====================================================================

-- ── message_attachments ──────────────────────────────────────────────
create table public.message_attachments (
  id uuid primary key default uuid_generate_v4(),
  message_id uuid not null references public.messages on delete cascade,
  conversation_id uuid not null references public.conversations on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  kind text not null check (kind in ('file','image')),
  created_at timestamptz not null default now()
);
create index message_attachments_message_idx on public.message_attachments (message_id);
create index message_attachments_conversation_idx on public.message_attachments (conversation_id);

-- ── voice_messages ───────────────────────────────────────────────────
create table public.voice_messages (
  id uuid primary key default uuid_generate_v4(),
  message_id uuid not null references public.messages on delete cascade,
  conversation_id uuid not null references public.conversations on delete cascade,
  storage_path text not null,
  mime_type text not null,
  duration_ms integer not null default 0,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);
create index voice_messages_message_idx on public.voice_messages (message_id);

-- ── document_requests ────────────────────────────────────────────────
create table public.document_requests (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations on delete cascade,
  application_id uuid not null references public.applications on delete cascade,
  requested_by uuid not null references auth.users,
  document_type text not null,
  label text not null,
  notes text,
  due_date date,
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  status text not null default 'pending'
    check (status in ('pending','submitted','under_review','approved','rejected')),
  checklist_item_id uuid references public.checklist_items on delete set null,
  fulfilled_attachment_id uuid references public.message_attachments on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index document_requests_conversation_idx on public.document_requests (conversation_id);
create index document_requests_app_status_idx on public.document_requests (application_id, status);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.message_attachments enable row level security;
alter table public.voice_messages enable row level security;
alter table public.document_requests enable row level security;

-- shared predicate: caller may access the conversation behind a row
-- (gates directly on conversation_id -> conversations -> applications).
create policy message_attachments_access_select on public.message_attachments
  for select using (
    exists (
      select 1 from public.conversations c
      join public.applications app on app.id = c.application_id
      where c.id = message_attachments.conversation_id
        and (
          auth.uid() = app.user_id
          or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
          or public.is_active_assignee(app.id, auth.uid())
        )
    )
  );
create policy message_attachments_access_insert on public.message_attachments
  for insert with check (
    exists (
      select 1 from public.conversations c
      join public.applications app on app.id = c.application_id
      where c.id = message_attachments.conversation_id
        and (
          auth.uid() = app.user_id
          or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
          or public.is_active_assignee(app.id, auth.uid())
        )
    )
  );

create policy voice_messages_access_select on public.voice_messages
  for select using (
    exists (
      select 1 from public.conversations c
      join public.applications app on app.id = c.application_id
      where c.id = voice_messages.conversation_id
        and (
          auth.uid() = app.user_id
          or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
          or public.is_active_assignee(app.id, auth.uid())
        )
    )
  );
create policy voice_messages_access_insert on public.voice_messages
  for insert with check (
    exists (
      select 1 from public.conversations c
      join public.applications app on app.id = c.application_id
      where c.id = voice_messages.conversation_id
        and (
          auth.uid() = app.user_id
          or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
          or public.is_active_assignee(app.id, auth.uid())
        )
    )
  );

-- document_requests: select via conversation access; insert restricted to the
-- assignee/admin (consultant-driven). NO update policy — ALL updates go through
-- the service-role client in DocumentRequestService (the status lifecycle is a
-- system-authority operation, and the service enforces role + valid transitions).
-- This prevents a regular user from self-approving via a direct PostgREST UPDATE
-- (would otherwise pass the owner arm of an update policy). See REVOKE below.
create policy document_requests_access_select on public.document_requests
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(application_id, auth.uid())
  );
create policy document_requests_consultant_insert on public.document_requests
  for insert with check (
    requested_by = auth.uid()
    and (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      or public.is_active_assignee(application_id, auth.uid())
    )
  );

-- ── Defense-in-depth column/operation REVOKEs (mirror P1 pattern) ─────────────
-- document_requests: no direct UPDATE for authenticated; the API service writes
-- all transitions via the service-role client. (No update RLS policy exists, so
-- this is the hard backstop against direct PostgREST status manipulation.)
revoke update on public.document_requests from authenticated;
-- attachments + voice are immutable from the user path (no update/delete policy);
-- enforce that at the grant level too. Service-role handles any cleanup.
revoke update, delete on public.message_attachments from authenticated;
revoke update, delete on public.voice_messages from authenticated;
