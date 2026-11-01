-- Per-application inbound email token. Users forward immigration emails to
-- visaai+<monitor_token>@inbound.postmarkapp.com; Postmark posts the parsed mail
-- and we resolve the application by this token.
alter table public.applications add column if not exists monitor_token text unique;
create index if not exists idx_applications_monitor_token on public.applications (monitor_token);
