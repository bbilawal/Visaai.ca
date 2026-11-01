-- Mobile (Task 9): make message sending idempotent.
--
-- The mobile app queues a message composed while offline and replays it when
-- connectivity returns. If the original POST actually reached the server but the
-- response was lost in transit — the common cellular failure — the replay
-- created a SECOND message. There was no way for the server to tell the two
-- apart, because the request carried nothing to correlate them.
--
-- `client_id` is a caller-supplied idempotency key. Nullable, so every existing
-- caller (web, consultant portal, AI-generated messages) is unaffected and keeps
-- working exactly as before.
--
-- The unique index is partial (`where client_id is not null`) and scoped to
-- (conversation, sender): two different people, or the same person in two
-- conversations, may legitimately reuse a key; the same sender replaying into
-- the same conversation may not.

alter table public.messages
  add column if not exists client_id uuid;

create unique index if not exists messages_client_id_unique
  on public.messages (conversation_id, sender_id, client_id)
  where client_id is not null;

comment on column public.messages.client_id is
  'Client-supplied idempotency key. When present, a repeated send with the same '
  '(conversation_id, sender_id, client_id) resolves to the existing row instead '
  'of inserting a duplicate. Set by the mobile offline queue; optional for all '
  'other callers.';
