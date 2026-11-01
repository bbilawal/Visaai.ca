-- SEC RLS hardening (Master Security Audit 2026-08-16)
-- Closes DAST-confirmed RLS defects reachable via direct PostgREST with a
-- user's own JWT (the anon key + user JWT are both public in the browser):
--   SEC-4090  consultant self-approves KYC/license/payouts + hijacks payout acct
--   SEC-4091  consultation participant rewrites ownership + injects meeting URL
--   SEC-4092  anonymous read of internal pricing margin/COGS
--   SEC-4093  RLS infinite recursion applications <-> consultant_assignments
--   SEC-4094  applications.plan_tier owner-writable => paid-tier entitlement bypass
--
-- Design: the application already restricts owner writes to a safe column set
-- (ProfileWriteInput, PlanGuard entitlement, etc.). All privileged writes to the
-- protected columns go through the service-role client (auth.role()='service_role')
-- or an admin JWT (is_marketplace_admin()). These triggers make RLS enforce the
-- same intent so the direct-PostgREST bypass is closed WITHOUT changing any
-- legitimate code path.

begin;

-- ---------------------------------------------------------------------------
-- Helper: is the current caller privileged (service-role or marketplace admin)?
-- Triggers fire even for service_role (which bypasses RLS but NOT triggers),
-- so protected-column writes from the admin client must be explicitly allowed.
-- ---------------------------------------------------------------------------
create or replace function public.sec_is_privileged_writer()
returns boolean
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select coalesce(auth.role() = 'service_role', false)
      or public.is_marketplace_admin();
$$;

-- ===========================================================================
-- SEC-4090 : freeze trust / payout / rating columns on consultant_profiles
-- ===========================================================================
create or replace function public.sec_guard_consultant_profiles()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $$
begin
  if public.sec_is_privileged_writer() then
    return new;  -- service-role / admin may set anything
  end if;

  -- A non-privileged owner may NOT change any of these system-controlled fields.
  if new.kyc_status               is distinct from old.kyc_status
     or new.license_verified      is distinct from old.license_verified
     or new.payouts_enabled       is distinct from old.payouts_enabled
     or new.rating_avg            is distinct from old.rating_avg
     or new.rating_count          is distinct from old.rating_count
     or new.stripe_connect_account_id is distinct from old.stripe_connect_account_id then
    raise exception 'SEC-4090: consultant may not modify verification/payout/rating columns'
      using errcode = '42501';
  end if;

  -- active_status: owner may only self-serve draft <-> pending_review.
  -- Going 'active' / 'suspended' is an admin/system transition.
  if new.active_status is distinct from old.active_status
     and new.active_status not in ('draft', 'pending_review') then
    raise exception 'SEC-4090: consultant may not set active_status=%', new.active_status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sec_guard_consultant_profiles on public.consultant_profiles;
create trigger trg_sec_guard_consultant_profiles
  before update on public.consultant_profiles
  for each row execute function public.sec_guard_consultant_profiles();

-- ===========================================================================
-- SEC-4091 : consultations — tighten WITH CHECK, freeze ownership, validate URL
-- ===========================================================================
-- 1) The UPDATE policy's WITH CHECK was literally `true` (any row shape allowed).
--    Re-scope it to the same participant predicate as USING so a participant
--    cannot rewrite a consultation into one they are not part of.
drop policy if exists consultations_participant_write on public.consultations;
create policy consultations_participant_write on public.consultations
  for update to public
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.consultant_profiles cp
      where cp.id = consultations.consultant_id
        and cp.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.consultant_profiles cp
      where cp.id = consultations.consultant_id
        and cp.user_id = (select auth.uid())
    )
  );

-- 2) Freeze the immutable identity columns and constrain meeting_url to the
--    known conferencing providers so a participant cannot inject a phishing URL.
create or replace function public.sec_guard_consultations()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $$
begin
  if public.sec_is_privileged_writer() then
    return new;
  end if;

  if new.user_id           is distinct from old.user_id
     or new.consultant_id  is distinct from old.consultant_id
     or new.application_id  is distinct from old.application_id
     or new.service_order_id is distinct from old.service_order_id then
    raise exception 'SEC-4091: consultation identity columns are immutable to participants'
      using errcode = '42501';
  end if;

  if new.meeting_url is distinct from old.meeting_url
     and new.meeting_url is not null
     and new.meeting_url !~* '^https://([a-z0-9-]+\.)*(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)(/|$)' then
    raise exception 'SEC-4091: meeting_url host not in the allowed provider set'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sec_guard_consultations on public.consultations;
create trigger trg_sec_guard_consultations
  before update on public.consultations
  for each row execute function public.sec_guard_consultations();

-- ===========================================================================
-- SEC-4092 : stop anonymous/public read of internal pricing margin + COGS
-- ===========================================================================
-- pricing_quotes carries gross_margin / total_cogs / floor_price — commercial-
-- confidential. It was readable by the public (anon) role. Restrict to
-- authenticated callers (still broad, but off the anon key) and drop margin/COGS
-- from any exposure by revoking column access from anon.
drop policy if exists quotes_read on public.pricing_quotes;
create policy quotes_read on public.pricing_quotes
  for select to authenticated
  using (true);
revoke select on public.pricing_quotes from anon;

-- ===========================================================================
-- SEC-9002 : payments must be owner-READ-ONLY (writes are webhook/service-role)
-- ===========================================================================
-- `payments_own_rows FOR ALL` let an applicant INSERT a fabricated
-- {feature:'prefill', status:'complete'} row for their own application_id,
-- which `prefill.hasPaid()` (prefill.service.ts:269) reads to unlock the paid
-- feature — free. Every legitimate payments write goes through the Stripe
-- webhook via the service-role client, so owners need only SELECT.
drop policy if exists payments_own_rows on public.payments;
create policy payments_own_read on public.payments
  for select to public
  using ((select auth.uid()) = user_id);

-- ===========================================================================
-- SEC-4093 : break the applications <-> consultant_assignments RLS recursion
-- ===========================================================================
-- consultant_assignments policies sub-select public.applications directly (not
-- via a SECURITY DEFINER helper), which re-enters applications' RLS and loops.
-- Route the owner lookup through a definer helper so no cycle forms.
create or replace function public.sec_application_owner(p_app uuid)
returns uuid
language sql
stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select a.user_id from public.applications a where a.id = p_app;
$$;
revoke all on function public.sec_application_owner(uuid) from public, anon;
grant execute on function public.sec_application_owner(uuid) to authenticated, service_role;

drop policy if exists consultant_assignments_owner_read on public.consultant_assignments;
create policy consultant_assignments_owner_read on public.consultant_assignments
  for select to public
  using (
    (select auth.uid()) = public.sec_application_owner(application_id)
    or (select auth.uid()) = consultant_id
  );

drop policy if exists consultant_assignments_owner_admin_update on public.consultant_assignments;
create policy consultant_assignments_owner_admin_update on public.consultant_assignments
  for update to public
  using (
    is_marketplace_admin()
    or (select auth.uid()) = public.sec_application_owner(application_id)
  );

-- ===========================================================================
-- SEC-4094 : pin security-controlling columns on applications
-- ===========================================================================
-- plan_tier drives PlanGuard entitlement; vri_score/status/submitted_at/
-- decision_at/monitor_token are system-controlled. Owners may write their own
-- application rows (applications_own_rows FOR ALL) but must not set these.
create or replace function public.sec_guard_applications()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $$
begin
  if public.sec_is_privileged_writer() then
    return new;
  end if;

  if new.plan_tier      is distinct from old.plan_tier
     or new.vri_score   is distinct from old.vri_score
     or new.submitted_at is distinct from old.submitted_at
     or new.decision_at is distinct from old.decision_at
     or new.monitor_token is distinct from old.monitor_token then
    raise exception 'SEC-4094: applications system columns are not owner-writable'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sec_guard_applications on public.applications;
create trigger trg_sec_guard_applications
  before update on public.applications
  for each row execute function public.sec_guard_applications();

commit;
