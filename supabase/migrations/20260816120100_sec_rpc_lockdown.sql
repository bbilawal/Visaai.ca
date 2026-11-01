-- SEC RPC lockdown (Master Security Audit 2026-08-16)
-- Several SECURITY DEFINER functions were written assuming only the trusted
-- service-role NestJS client would call them, but were never revoked from
-- PUBLIC. PostgREST auto-exposes every such function as an RPC endpoint callable
-- by anon/authenticated. Confirmed live: proacl carried `anon=X | authenticated=X`.
--
--   SEC-4001  audit_append()            forge chain-linked audit entries as any actor
--   SEC-4002  field_provenance_create_version()  forge document-verification evidence
--   SEC-4003  claim_outbox_batch()      read cross-tenant PII + disrupt delivery
--   SEC-4004  bump_delivery_attempt()   tamper with any delivery record
--   SEC-4005  consume_review_credit()   deplete another user's paid credits (trusts p_user_id)
--   (+ redeem_coupon, enqueue_application_status_changed, refresh_consultant_rating,
--      audit_verify_chain, audit_no_mutate — same class, locked down defensively)
--
-- All of these are invoked in application code ONLY via `this.supabase.admin`
-- (service-role) or fire as triggers — never via a user-scoped `forUser` client —
-- so revoking anon/authenticated EXECUTE changes no legitimate path.
--
-- NOTE: the RLS-helper predicates (is_active_assignee, consultant_covers_country,
-- app_has_active_consultant, app_destination_country, is_marketplace_admin,
-- is_analytics_admin, is_pricing_admin, is_risk_admin) are deliberately NOT
-- touched — RLS evaluates them as the calling user, so they MUST keep
-- authenticated EXECUTE.

do $$
declare
  fn text;
  target_fns text[] := array[
    'audit_append',
    'audit_verify_chain',
    'audit_no_mutate',
    'field_provenance_create_version',
    'claim_outbox_batch',
    'bump_delivery_attempt',
    'consume_review_credit',
    'redeem_coupon',
    'enqueue_application_status_changed',
    'refresh_consultant_rating'
  ];
  sig text;
begin
  foreach fn in array target_fns loop
    -- lock down every overload of each name
    for sig in
      select p.oid::regprocedure::text
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = fn
    loop
      execute format('revoke all on function %s from public, anon, authenticated', sig);
      execute format('grant execute on function %s to service_role', sig);
      raise notice 'SEC rpc-lockdown: revoked public/anon/authenticated on %', sig;
    end loop;
  end loop;
end $$;
