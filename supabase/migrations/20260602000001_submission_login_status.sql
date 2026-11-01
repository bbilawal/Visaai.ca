-- Submission sessions: allow 'awaiting_login' state for the sidecar persistent-profile
-- flow. When the user is not signed in to the destination portal in the sidecar's
-- browser profile, the gateway parks the session in 'awaiting_login' until the
-- sidecar detects a successful sign-in and resumes the fill plan.

alter table public.submission_sessions
  drop constraint if exists submission_sessions_status_check;

alter table public.submission_sessions
  add constraint submission_sessions_status_check
  check (status in ('pending','awaiting_login','active','paused','complete','error'));
