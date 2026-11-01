-- =====================================================================
-- Messaging P3b: push_subscriptions + notification_preferences.
-- Both are OWNER-ONLY (user_id = auth.uid()) for select/insert/update/delete.
-- The notification dispatcher + email job read across users via the
-- service-role client (background/system path), so no cross-user RLS arm.
-- Author: messaging P3b  Date: 2026-06-13
-- =====================================================================

create table public.push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.notification_preferences (
  user_id uuid primary key references auth.users on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;

create policy push_subscriptions_owner_all on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notification_preferences_owner_all on public.notification_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
