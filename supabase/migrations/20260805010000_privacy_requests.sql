-- Privacy / data-subject request log (GDPR Art. 17 / 20, PIPEDA).
--
-- Retained record of export + erasure requests. Deliberately NOT cascade-linked
-- to users: it must SURVIVE the erasure it records (the "record of processing"
-- a regulator expects). user_id is kept for correlation but nulls out if the
-- user row is deleted; subject_email is stored plainly as the durable handle.
--
-- Locked down: RLS enabled with NO permissive policy, so only the service-role
-- client (background/system path) can read or write it — never a user token.

create table if not exists public.privacy_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.users on delete set null,
  subject_email text not null,
  kind          text not null check (kind in ('export', 'deletion')),
  status        text not null default 'completed'
                  check (status in ('completed', 'failed')),
  details       jsonb not null default '{}'::jsonb,
  requested_at  timestamptz not null default now()
);

create index if not exists privacy_requests_user_idx
  on public.privacy_requests (user_id, requested_at desc);
create index if not exists privacy_requests_email_idx
  on public.privacy_requests (subject_email, requested_at desc);

alter table public.privacy_requests enable row level security;
-- No policy on purpose → service-role only.
