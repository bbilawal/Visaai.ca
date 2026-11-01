-- =====================================================================
-- Re-key account lockouts on (email, ip) — the real SEC-001 fix.
-- Author: Audit (Phase 11)   Date: 2026-08-09
--
-- THE DEFECT. `POST /auth/record-login` is unauthenticated and takes `success`
-- from the CLIENT, and `account_lockouts` is keyed on email alone: five
-- failures lock that email for fifteen minutes. So anyone can POST
-- {email: <victim>, success: false} five times and lock a named person out of
-- their own account. A throttle shipped as a mitigation (5/min per IP), which
-- cut the rate roughly twelvefold but left the mechanism intact.
--
-- THE FIX, and the trade it makes. Keying on (email, ip) means an attacker can
-- only lock the victim *at the attacker's own address* — the victim signing in
-- from their own network is unaffected. But that alone would weaken brute-force
-- defence: an attacker with N addresses would get 5 attempts each.
--
-- So this keeps BOTH:
--   * per (email, ip)  — 5 failures, the existing aggressive lock
--   * per email overall — a much higher threshold that still catches a
--     distributed attempt, without letting one address lock an account
--
-- The email-wide counter is derived rather than stored: sum failed_count across
-- that email's rows. That way there is no second row to keep consistent, and no
-- single row an attacker can drive on the victim's behalf.
--
-- MIGRATION SAFETY. Existing rows have no ip. They are preserved under the
-- sentinel '0.0.0.0', which no real request presents (Nest's @Ip() yields the
-- socket address or an X-Forwarded-For entry). Those legacy rows therefore
-- expire naturally and can never be matched by a live attempt.
--
-- NOT YET APPLIED TO PRODUCTION. Blocked on BLK-1 — no backup exists there.
-- =====================================================================

alter table public.account_lockouts
  add column if not exists ip text not null default '0.0.0.0';

-- Rebuild the key. A composite PK on (email, ip) is what makes one address
-- unable to speak for the whole account.
alter table public.account_lockouts
  drop constraint if exists account_lockouts_pkey;

alter table public.account_lockouts
  add constraint account_lockouts_pkey primary key (email, ip);

-- The email-wide aggregate is read on every attempt; without this it is a
-- sequential scan of the whole table per sign-in.
create index if not exists account_lockouts_email_idx
  on public.account_lockouts (email);

comment on column public.account_lockouts.ip is
  'Source address of the failed attempt. Part of the primary key so one address cannot lock an account for everyone (SEC-001). Legacy rows carry the sentinel 0.0.0.0 and can never match a live request.';

comment on table public.account_lockouts is
  'Per (email, ip) failed-login state. A per-pair lock stops brute force from one source; the email-wide sum of failed_count is checked separately so a distributed attempt is still caught. Never key a lock on email alone — that is a remote account-denial primitive.';

-- =====================================================================
-- ROLLBACK:
--   drop index if exists public.account_lockouts_email_idx;
--   alter table public.account_lockouts drop constraint account_lockouts_pkey;
--   delete from public.account_lockouts a using public.account_lockouts b
--     where a.email = b.email and a.ip > b.ip;          -- collapse to one row per email
--   alter table public.account_lockouts add constraint account_lockouts_pkey primary key (email);
--   alter table public.account_lockouts drop column if exists ip;
-- =====================================================================
