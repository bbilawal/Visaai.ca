-- Notification outbox (Increment 7). Guarantees `application.status_changed`
-- delivery regardless of which code path writes applications.status: an
-- AFTER UPDATE trigger enqueues an outbox row, drained by OutboxProcessor which
-- publishes to NotificationEventBus -> emit() (per-user prefs + quiet hours apply).
-- Additive. Service-role only.

create table public.notification_outbox (
  id           uuid primary key default uuid_generate_v4(),
  event_type   text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  attempts     int not null default 0,
  last_error   text
);

-- Partial index: the drain only ever scans unprocessed rows, oldest first.
create index notification_outbox_unprocessed_idx
  on public.notification_outbox (created_at) where processed_at is null;

alter table public.notification_outbox enable row level security;
-- Service-role writes/reads only (trigger + drain worker); no public policy.

-- Enqueue an application.status_changed event whenever applications.status
-- actually changes. `is distinct from` handles NULLs and skips no-op updates.
create or replace function public.enqueue_application_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.notification_outbox (event_type, payload)
    values (
      'application.status_changed',
      jsonb_build_object(
        'userId', new.user_id,
        'applicationId', new.id,
        'data', jsonb_build_object('status', new.status)
      )
    );
  end if;
  return new;
end;
$$;

create trigger trg_application_status_changed
  after update of status on public.applications
  for each row
  execute function public.enqueue_application_status_changed();
