-- PAY-009: a ledger entry is evidence of receipt, not proof its domain work ran.
--
-- The old UNIQUE payment_events.provider_event_id gate was claimed before the
-- handler. If a handler then threw, Stripe retried but was acknowledged as a
-- duplicate: entitlement/reconciliation work was permanently lost. Keep the
-- immutable ledger, but make completion a separate durable state machine.

create table if not exists public.payment_event_processing (
  provider_event_id text primary key references public.payment_events(provider_event_id) on delete restrict,
  status text not null check (status in ('processing', 'processed', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  claimed_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  constraint payment_event_processing_processed_at_check check (
    (status = 'processed' and processed_at is not null and last_error is null)
    or (status <> 'processed' and processed_at is null)
  )
);

alter table public.payment_event_processing enable row level security;

-- Every ledger event created before this migration was already acknowledged by
-- the old endpoint, so retrying it could duplicate financial effects. Seed it
-- as completed; only new events follow the retryable processing path.
insert into public.payment_event_processing (provider_event_id, status, processed_at)
select provider_event_id, 'processed', recorded_at
from public.payment_events
on conflict (provider_event_id) do nothing;

create or replace function public.claim_payment_webhook_event(
  p_provider text,
  p_event_type text,
  p_provider_event_id text,
  p_provider_object_id text,
  p_amount_minor bigint,
  p_currency text,
  p_direction text,
  p_user_id uuid,
  p_related_entity jsonb,
  p_occurred_at timestamptz
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  -- Insert the immutable receipt and the first processing lease in one
  -- transaction. No client can observe a recorded event without a state row.
  insert into public.payment_events (
    provider, event_type, provider_event_id, provider_object_id, amount_minor,
    currency, direction, user_id, related_entity, occurred_at
  ) values (
    p_provider, p_event_type, p_provider_event_id, p_provider_object_id,
    p_amount_minor, p_currency, p_direction, p_user_id,
    coalesce(p_related_entity, '{}'::jsonb), p_occurred_at
  ) on conflict (provider_event_id) do nothing;

  insert into public.payment_event_processing (provider_event_id, status)
  values (p_provider_event_id, 'processing')
  on conflict (provider_event_id) do nothing;
  if found then return 'claimed'; end if;

  -- A failed request is immediately retryable. A process crash is reclaimable
  -- after ten minutes; before that callers must return 5xx so the provider does
  -- not mark a concurrently-running delivery successful.
  update public.payment_event_processing
  set status = 'processing', attempt_count = attempt_count + 1,
      claimed_at = now(), last_error = null
  where provider_event_id = p_provider_event_id
    and (status = 'failed' or (status = 'processing' and claimed_at < now() - interval '10 minutes'))
  returning status into v_status;
  if found then return 'claimed'; end if;

  select status into v_status
  from public.payment_event_processing
  where provider_event_id = p_provider_event_id;
  return coalesce(v_status, 'processing');
end;
$$;

create or replace function public.complete_payment_webhook_event(
  p_provider_event_id text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payment_event_processing
  set status = 'processed', processed_at = now(), last_error = null
  where provider_event_id = p_provider_event_id and status = 'processing';
  if not found then
    raise exception 'payment webhook % is not processing', p_provider_event_id;
  end if;
end;
$$;

create or replace function public.fail_payment_webhook_event(
  p_provider_event_id text,
  p_error text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payment_event_processing
  set status = 'failed', last_error = left(coalesce(p_error, 'webhook handler failed'), 1000)
  where provider_event_id = p_provider_event_id and status = 'processing';
  if not found then
    raise exception 'payment webhook % is not processing', p_provider_event_id;
  end if;
end;
$$;

-- SECURITY DEFINER RPCs must never be PostgREST-callable by users. Nest calls
-- these only through the service-role client.
revoke all on function public.claim_payment_webhook_event(text, text, text, text, bigint, text, text, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_payment_webhook_event(text) from public, anon, authenticated;
revoke all on function public.fail_payment_webhook_event(text, text) from public, anon, authenticated;
grant execute on function public.claim_payment_webhook_event(text, text, text, text, bigint, text, text, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.complete_payment_webhook_event(text) to service_role;
grant execute on function public.fail_payment_webhook_event(text, text) to service_role;
