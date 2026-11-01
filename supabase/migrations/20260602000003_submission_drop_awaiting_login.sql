-- Submission sessions: drop the 'awaiting_login' status. It was added for the
-- Electron sidecar's persistent-profile sign-in detection flow, which has been
-- replaced by the Chrome-extension-only flow (the user signs in to the portal
-- in their own browser tab before launching the assistant).

alter table public.submission_sessions
  drop constraint if exists submission_sessions_status_check;

alter table public.submission_sessions
  add constraint submission_sessions_status_check
  check (status in ('pending','active','paused','complete','error'));
