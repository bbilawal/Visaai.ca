-- Atomic delivery attempt counter (Increment 7). Replaces the app-side
-- read-modify-write in NotificationDeliveryRepository.markStatus, which was
-- only safe because BullMQ runs one job per delivery. The RPC increments in a
-- single statement so the counter is correct under any concurrency.

create or replace function public.bump_delivery_attempt(
  p_delivery_id uuid,
  p_status text,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_deliveries
     set attempts   = attempts + 1,
         status     = p_status,
         error      = p_error,
         updated_at = now()
   where id = p_delivery_id;
$$;
