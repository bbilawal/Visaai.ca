-- Admin-managed notification templates (Increment 4). Optional override of the
-- code catalog copy per (event_type, locale); catalog is the fallback.

create table public.notification_templates (
  id          uuid primary key default uuid_generate_v4(),
  event_type  text not null,
  locale      text not null default 'en',
  subject     text,
  title       text not null,
  body        text not null,
  variables   text[] not null default '{}',
  version     int  not null default 1,
  is_active   boolean not null default true,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

-- At most one ACTIVE template per (event_type, locale). Editing inserts a new
-- version + deactivates the prior; all rows are retained = version history.
create unique index notification_templates_active_uidx
  on public.notification_templates (event_type, locale) where is_active;
create index notification_templates_lookup_idx
  on public.notification_templates (event_type, locale, version desc);

alter table public.notification_templates enable row level security;
-- Service-role writes/reads only (admin API); no public policy.
