-- Messaging Delivered status: a per-participant "delivered up to" watermark,
-- mirroring last_read_at. Server-derived from SSE presence; cosmetic.
alter table public.conversation_participants
  add column if not exists delivered_at timestamptz;
