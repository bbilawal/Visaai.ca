-- Epic B reminders: append-only dedupe log + per-user opt-out.

alter table public.users
  add column if not exists email_reminders boolean not null default true;

create table if not exists public.reminder_log (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  stage text not null,
  kind text not null check (kind in ('stall_3','stall_7','stall_14')),
  sent_at timestamptz not null default now()
);

create unique index if not exists reminder_log_app_kind_idx
  on public.reminder_log (application_id, kind);

alter table public.reminder_log enable row level security;

-- Only the service role writes/reads reminder_log; no client policy granted.
comment on table public.reminder_log is
  'Epic B: append-only reminder dedupe. Service-role only.';
