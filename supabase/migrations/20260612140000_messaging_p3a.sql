-- =====================================================================
-- Messaging P3a: consultant_notes + escalation_history (STAFF-ONLY) and a
-- consultant_state column on conversations (staff-set triage indicator).
-- Staff-only RLS uses (admin OR public.is_active_assignee) with NO owner arm —
-- the application owner (user) must never read internal notes or escalations.
-- consultant_state lives on conversations (which has an owner UPDATE arm from
-- P1), so direct authenticated UPDATE of that column is REVOKED; staff set it
-- via the service-role client in MessagingService.setConsultantState.
-- Author: messaging P3a  Date: 2026-06-12
-- =====================================================================

-- ── consultant_notes (staff-only) ─────────────────────────────────────
create table public.consultant_notes (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations on delete cascade,
  application_id uuid not null references public.applications on delete cascade,
  author_id uuid not null references auth.users,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index consultant_notes_conversation_idx on public.consultant_notes (conversation_id, created_at);

-- ── escalation_history (staff-only) ───────────────────────────────────
create table public.escalation_history (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations on delete cascade,
  application_id uuid not null references public.applications on delete cascade,
  escalated_by uuid not null references auth.users,
  escalation_type text not null
    check (escalation_type in ('complex_case','legal_review','supervisor_review','specialist_review')),
  reason text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  resolved_by uuid references auth.users,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index escalation_history_conversation_idx on public.escalation_history (conversation_id, created_at);
create index escalation_history_app_status_idx on public.escalation_history (application_id, status);

-- ── conversations.consultant_state ────────────────────────────────────
alter table public.conversations
  add column consultant_state text
    check (consultant_state in ('pending_user_response','waiting_documents','under_review','resolved'));

-- ── RLS: staff-only (admin OR active assignee), NO owner arm ───────────
alter table public.consultant_notes enable row level security;
alter table public.escalation_history enable row level security;

create policy consultant_notes_staff_select on public.consultant_notes
  for select using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(application_id, auth.uid())
  );
create policy consultant_notes_staff_insert on public.consultant_notes
  for insert with check (
    author_id = auth.uid()
    and (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      or public.is_active_assignee(application_id, auth.uid())
    )
  );
create policy consultant_notes_staff_update on public.consultant_notes
  for update using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(application_id, auth.uid())
  )
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(application_id, auth.uid())
  );

create policy escalation_staff_select on public.escalation_history
  for select using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(application_id, auth.uid())
  );
create policy escalation_staff_insert on public.escalation_history
  for insert with check (
    escalated_by = auth.uid()
    and (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      or public.is_active_assignee(application_id, auth.uid())
    )
  );
create policy escalation_staff_update on public.escalation_history
  for update using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(application_id, auth.uid())
  )
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(application_id, auth.uid())
  );

-- consultant_state: prevent direct authenticated UPDATE (owner could otherwise
-- set it via the conversations owner UPDATE arm). Staff write via service-role.
revoke update (consultant_state) on public.conversations from authenticated;
