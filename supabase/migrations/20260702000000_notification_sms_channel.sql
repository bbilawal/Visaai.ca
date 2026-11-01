-- SMS as an opt-in notification delivery channel (Increment 3). Additive.

-- Opt-IN (default false): SMS is intrusive + costs money, unlike email/push.
alter table public.notification_preferences
  add column sms_enabled boolean not null default false;

-- Extend the delivery-channel CHECK to allow 'sms'.
alter table public.notification_deliveries
  drop constraint notification_deliveries_channel_check,
  add constraint notification_deliveries_channel_check
    check (channel in ('in_app', 'email', 'web_push', 'sms'));
