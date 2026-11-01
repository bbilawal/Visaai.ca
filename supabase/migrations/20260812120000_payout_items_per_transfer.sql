-- Per-order Stripe transfers for the consultant payout sweep.
--
-- The sweep used to emit ONE transfer per consultant per day and store its id on
-- consultant_payouts. That cannot carry Stripe's `source_transaction`, which is
-- keyed to a single charge — so every transfer had to draw on the platform's
-- *settled* balance and failed with `balance_insufficient` whenever the platform
-- held no float.
--
-- The sweep now creates one transfer per service order, funded by that order's
-- own charge. consultant_payouts remains the grouping/reporting unit; the
-- transfer ids move onto its items.

alter table public.consultant_payout_items
  add column if not exists stripe_transfer_id text;

-- One Stripe transfer backs at most one item. Partial UNIQUE so the many rows
-- predating this change (and any failed-payout rows) keep NULL without colliding.
create unique index if not exists consultant_payout_items_transfer_uidx
  on public.consultant_payout_items (stripe_transfer_id)
  where stripe_transfer_id is not null;

-- Grouped payouts no longer carry a transfer of their own. The column stays for
-- the historical rows written before this migration.
comment on column public.consultant_payouts.stripe_transfer_id is
  'Legacy: the single grouped transfer, pre-2026-08-12. New payouts leave this NULL and record transfers on consultant_payout_items.stripe_transfer_id.';

comment on column public.consultant_payout_items.stripe_transfer_id is
  'Stripe transfer that paid this order, created with source_transaction bound to the order''s charge.';
