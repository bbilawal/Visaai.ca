-- Atomic batch claim for the notification outbox drain (Increment 7).
-- Selects the oldest unprocessed rows with FOR UPDATE SKIP LOCKED so multiple
-- workers never claim the same row, bumps attempts, and returns the claimed
-- rows. The worker then emit()s each and stamps processed_at (or last_error).

create or replace function public.claim_outbox_batch(p_limit int)
returns setof public.notification_outbox
language sql
security definer
set search_path = public
as $$
  update public.notification_outbox o
     set attempts = o.attempts + 1
   where o.id in (
     select id
       from public.notification_outbox
      where processed_at is null
      order by created_at
      for update skip locked
      limit p_limit
   )
  returning o.*;
$$;
