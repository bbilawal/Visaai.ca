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
