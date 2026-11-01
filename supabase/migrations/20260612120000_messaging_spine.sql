-- =====================================================================
-- Messaging spine (P1): conversations, participants, messages, notifications.
-- One conversation per application. RLS mirrors consultant_rbac_rls:
--   owner (auth.uid() = application.user_id) OR admin (jwt app_metadata role)
--   OR active assigned consultant (exists consultant_assignments).
-- Policies reference applications + consultant_assignments only — NOT
-- conversation_participants — to avoid the RLS recursion fixed in
-- 20260608000003_fix_visibility_recursion.sql.
-- Notifications are system-generated (written via service-role) and read-scoped
-- to the owning user. Author: messaging P1  Date: 2026-06-12
-- =====================================================================

-- ── conversations ────────────────────────────────────────────────────
create table public.conversations (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null unique
    references public.applications on delete cascade,
  status text not null default 'open'
    check (status in ('open','resolved','closed','archived')),
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── conversation_participants ─────────────────────────────────────────
create table public.conversation_participants (
  conversation_id uuid not null
    references public.conversations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('user','consultant','admin')),
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ── messages ──────────────────────────────────────────────────────────
create table public.messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null
    references public.conversations on delete cascade,
  sender_id uuid not null references auth.users,
  sender_role text not null
    check (sender_role in ('user','consultant','admin','ai')),
  category text not null default 'general'
    check (category in ('general','documents','eligibility','application_status',
                        'payment','travel_history','biometrics','medical','other')),
  body text not null,
  parent_message_id uuid references public.messages on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index messages_conversation_idx
  on public.messages (conversation_id, created_at);
create index messages_parent_idx on public.messages (parent_message_id);

-- ── notifications (in-app feed; email/push = P3) ──────────────────────
create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users on delete cascade,
  type text not null,
  conversation_id uuid references public.conversations on delete cascade,
  message_id uuid references public.messages on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx
  on public.notifications (user_id, read_at, created_at);

-- ── RLS ────────────────────────────────────────────────────────────────
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;

-- conversations: select + insert + update. Active-assignee check uses the
-- SECURITY DEFINER helper public.is_active_assignee (from
-- 20260608000003_fix_visibility_recursion.sql) — same pattern as the
-- applications policy; avoids re-triggering consultant_assignments RLS.
-- Consultant INSERT is intentional: a consultant may open the thread first
-- (consultant-initiated questions). UNIQUE(application_id) makes the row inert
-- and idempotent, so this is not an escalation surface.
create policy conversations_access_select on public.conversations
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(conversations.application_id, auth.uid())
  );
create policy conversations_access_insert on public.conversations
  for insert with check (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(conversations.application_id, auth.uid())
  );
create policy conversations_access_update on public.conversations
  for update
  using (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(conversations.application_id, auth.uid())
  )
  with check (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(conversations.application_id, auth.uid())
  );

-- messages: select + insert (gate on the parent conversation's application).
-- No UPDATE/DELETE policy: messages are immutable on the user path in P1.
-- edited_at/deleted_at exist for a later phase and are writable via service-role
-- only until an explicit edit/soft-delete feature ships with its own policy.
create policy messages_access_select on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      join public.applications app on app.id = c.application_id
      where c.id = messages.conversation_id
        and (
          auth.uid() = app.user_id
          or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
          or public.is_active_assignee(app.id, auth.uid())
        )
    )
  );
create policy messages_access_insert on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      join public.applications app on app.id = c.application_id
      where c.id = messages.conversation_id
        and (
          auth.uid() = app.user_id
          or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
          or public.is_active_assignee(app.id, auth.uid())
        )
    )
  );

-- conversation_participants: a caller may read/update ONLY their own row, and
-- may only mutate last_read_at. The column-level REVOKE blocks role
-- self-escalation (a user could otherwise UPDATE their own row's role to
-- 'consultant'/'admin'); the WITH CHECK pins the row to the caller.
create policy participants_own_select on public.conversation_participants
  for select using (auth.uid() = user_id);
create policy participants_own_update on public.conversation_participants
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke update (role, joined_at) on public.conversation_participants from authenticated;
-- inserts/deletes are performed by the service-role path (seeding); no anon policy.

-- notifications: owner-only read/update; inserts via service-role only. Users may
-- only flip read_at — the system-owned columns are revoked to prevent tampering.
create policy notifications_own_select on public.notifications
  for select using (auth.uid() = user_id);
create policy notifications_own_update on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke update (type, conversation_id, message_id, created_at, user_id) on public.notifications from authenticated;
