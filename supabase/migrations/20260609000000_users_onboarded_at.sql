-- Onboarding completion marker. Nullable; new signups start null and enter the
-- onboarding flow. Existing users are backfilled as already-onboarded.
alter table public.users add column if not exists onboarded_at timestamptz;
update public.users set onboarded_at = now() where onboarded_at is null;
