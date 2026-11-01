-- Admin broadcast announcements (Increment 6). Additive. Each broadcast fans
-- out through NotificationsService.emit() (per-user prefs + quiet hours apply).

create table public.notification_broadcasts (
  id             uuid primary key default uuid_generate_v4(),
  title          text not null,
  body           text not null,
  link           text,
  category       text not null default 'system',
  audience       jsonb not null,
  status         text not null default 'sending'
                   check (status in ('sending', 'sent', 'failed')),
  recipient_count int not null default 0,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index notification_broadcasts_created_idx
  on public.notification_broadcasts (created_at desc);

alter table public.notification_broadcasts enable row level security;
-- Service-role writes/reads only (admin API); no public policy.
