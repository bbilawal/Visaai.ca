-- Generalize the messaging notifications feed into a system-event feed (additive).
alter table public.notifications
  add column category text not null default 'system',
  add column title    text,
  add column body     text,
  add column link     text,
  add column data     jsonb not null default '{}'::jsonb;
-- (Existing index notifications_user_unread_idx (user_id, read_at, created_at)
--  already serves the feed query — no new index.)

-- Per-channel delivery tracking + DLQ source. Service-role writes only.
create table public.notification_deliveries (
  id              uuid primary key default uuid_generate_v4(),
  notification_id uuid references public.notifications on delete cascade,
  user_id         uuid not null references auth.users on delete cascade,
  event_type      text not null,
  channel         text not null check (channel in ('in_app','email','web_push')),
  status          text not null default 'queued'
                    check (status in ('queued','sent','failed','skipped','dead')),
  attempts        int  not null default 0,
  error           text,
  dedupe_key      text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index notification_deliveries_status_idx on public.notification_deliveries (status, created_at desc);
alter table public.notification_deliveries enable row level security;
-- Users may read their own delivery rows; writes are service-role only (no policy).
create policy notification_deliveries_own_select on public.notification_deliveries
  for select using (auth.uid() = user_id);
