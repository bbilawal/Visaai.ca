-- Mobile (Task 9): native device push tokens.
--
-- push_subscriptions (20260613120000) models a *Web Push* endpoint — an
-- endpoint URL plus the p256dh/auth ECDH keys required by VAPID. iOS and
-- Android deliver through APNs/FCM instead, where the credential is a single
-- opaque device token with no key material. Overloading push_subscriptions
-- would mean nullable p256dh/auth columns and a NOT NULL contract that no
-- longer holds, so mobile gets its own table.
--
-- The token is a routing address, not a secret capability: possession alone
-- lets a holder send a notification to that device, so it stays RLS-owner
-- scoped and is never returned to any client but its owner.

create table if not exists public.device_push_tokens (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.users on delete cascade,
  -- APNs/FCM/Expo token. Unique so a device that reinstalls or changes account
  -- re-homes the row to the new owner instead of double-delivering.
  token         text not null unique,
  platform      text not null check (platform in ('ios', 'android')),
  device_name   text,
  app_version   text,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists device_push_tokens_user_idx
  on public.device_push_tokens (user_id);
-- Pruning sweep predicate (stale tokens are dropped after long inactivity).
create index if not exists device_push_tokens_last_seen_idx
  on public.device_push_tokens (last_seen_at);

alter table public.device_push_tokens enable row level security;

-- Owner-only, mirroring push_subscriptions_owner_all. The dispatch path reads
-- cross-user via the service-role client, which bypasses RLS by design.
create policy device_push_tokens_owner_all on public.device_push_tokens
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
