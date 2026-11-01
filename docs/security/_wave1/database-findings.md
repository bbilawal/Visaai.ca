# VisaAI — Database & Supabase Security Audit (Wave 1)

Scope: static, read-only analysis of `supabase/migrations/*.sql` (106 files) and the
code paths in `apps/api`, `apps/web`, `apps/mobile`, `apps/extension` that talk to the
database (RLS, policies, SECURITY DEFINER functions, storage buckets, service-role
usage, grants). No migration was run, no file was edited, no production database was
touched. All evidence is `path:line` + quoted SQL/code from this repository.

**Important caveat that applies to the whole report:** two migrations
(`20260809120000_revoke_unused_dml_grants.sql`, `20260809140000_hoist_rls_auth_calls.sql`)
carry their own header stating *"NOT YET APPLIED TO PRODUCTION. Blocked on BLK-1 —
no backup exists there."* Everything below is evaluated against the migration
**files**, i.e. the intended/latest schema. Whether every migration file has actually
been applied to the live VPS-hosted Postgres is **UNVERIFIED** (out of scope — no
production connection was made). Findings that only exist because a fix migration
hasn't shipped are called out explicitly (SEC-4012).

---

## 1. Table inventory (required deliverable)

135 tables created across the migration set. **All 135 have `ENABLE ROW LEVEL
SECURITY`** (one apparent "table with no RLS" from an automated grep was a false
positive — a `format('...public.%I...')` string inside `ensure_month_partition()`,
not a real table; verified by reading
`supabase/migrations/20260706020000_analytics_foundation.sql:22-45`, which shows
`analytics_event_stream` itself does carry `enable row level security` at line 44).

**34 tables have RLS enabled with zero policies.** For every one of these, verified
individually that this is deny-all-to-anon/authenticated-by-design (service-role-only
tables — background jobs, audit/ops/analytics writers, secret material). This is not
automatically a vulnerability (RLS-enabled + 0 policies = nobody except a role with
`BYPASSRLS`/table ownership can read or write, which is the *safe* default), but per
the audit brief it is flagged below and the "OK" table is only asserted after
confirming no RPC or view re-exposes the data (see §3 for two cases where this
assumption was violated).

| Table | RLS | Policies | Commands covered | Sensitive columns (heuristic) | Verdict |
|---|---|---|---|---|---|
| `account_lockouts` | yes | 0 | — | email,lockout state | deny-all (service-role only) |
| `action_items` | yes | 1 | ALL | — | OK |
| `addon_purchases` | yes | 1 | SELECT | — | OK |
| `ai_usage_events` | yes | 2 | SELECT | usage/cost, user linkage | OK |
| `analytics_alert_event` | yes | 0 | — | — | deny-all (service-role only) |
| `analytics_alert_rule` | yes | 0 | — | — | deny-all (service-role only) |
| `analytics_daily_active` | yes | 1 | SELECT | — | OK |
| `analytics_event_daily` | yes | 1 | SELECT | — | OK |
| `analytics_event_stream` | yes | 1 | SELECT | user_id,application_id,event props | OK |
| `analytics_events` | yes | 2 | INSERT,SELECT | — | OK |
| `analytics_identity_map` | yes | 0 | — | — | deny-all (service-role only) |
| `analytics_report_run` | yes | 0 | — | — | deny-all (service-role only) |
| `analytics_saved_report` | yes | 0 | — | — | deny-all (service-role only) |
| `analytics_scheduled_report` | yes | 0 | — | — | deny-all (service-role only) |
| `application_outcomes` | yes | 3 | INSERT,SELECT,UPDATE | — | OK |
| `application_profiles` | yes | 1 | ALL | applicant profile PII | OK |
| `applications` | yes | 6 | ALL,SELECT,UPDATE | destination_country,profile links | OK |
| `audit_chain_state` | yes | 0 | — | — | deny-all (service-role only) |
| `audit_events` | yes | 1 | SELECT | immutable audit payloads (PII possible) | see SEC-4001 |
| `auth_audit_log` | yes | 0 | — | ip,user_agent,security events | deny-all (service-role only) |
| `beta_cohort_members` | yes | 1 | SELECT | — | OK |
| `beta_cohorts` | yes | 0 | — | — | deny-all (service-role only) |
| `beta_feedback` | yes | 2 | INSERT,SELECT | free-text feedback (potential PII), screenshot path | OK |
| `checklist_items` | yes | 1 | ALL | application-linked | OK |
| `consultant_approvals` | yes | 2 | INSERT,SELECT | — | OK |
| `consultant_assignments` | yes | 5 | INSERT,SELECT,UPDATE | — | OK |
| `consultant_availability` | yes | 2 | ALL,SELECT | — | OK |
| `consultant_commission_rules` | yes | 1 | ALL | — | OK |
| `consultant_countries` | yes | 2 | ALL,SELECT | — | OK |
| `consultant_notes` | yes | 3 | INSERT,SELECT,UPDATE | case notes (PII) | OK |
| `consultant_payout_items` | yes | 1 | SELECT | — | OK |
| `consultant_payouts` | yes | 1 | SELECT | financial payout amounts | OK |
| `consultant_profiles` | yes | 3 | ALL,SELECT | — | OK |
| `consultant_reviews` | yes | 3 | INSERT,SELECT,UPDATE | — | OK |
| `consultant_service_orders` | yes | 1 | SELECT | — | OK |
| `consultant_skills` | yes | 2 | ALL,SELECT | — | OK |
| `consultant_tax_profiles` | yes | 1 | SELECT | tax ID / financial | OK |
| `consultations` | yes | 3 | INSERT,SELECT,UPDATE | meeting_url, scheduling | see SEC-4006 |
| `consumed_readback_tokens` | yes | 0 | — | — | deny-all (service-role only) |
| `conversation_participants` | yes | 2 | SELECT,UPDATE | — | OK |
| `conversations` | yes | 3 | INSERT,SELECT,UPDATE | — | OK |
| `country_frameworks` | yes | 1 | SELECT | — | OK (public reference data) |
| `coupons` | yes | 2 | ALL,SELECT | — | see SEC-4007 |
| `cross_verifications` | yes | 1 | ALL | PII cross-checks | OK |
| `device_push_tokens` | yes | 1 | ALL | push token | OK |
| `discount_redemptions` | yes | 1 | SELECT | — | OK |
| `document_access_logs` | yes | 1 | SELECT | access audit | OK |
| `document_requests` | yes | 2 | INSERT,SELECT | — | OK |
| `document_templates` | yes | 1 | SELECT | — | OK |
| `document_translations` | yes | 1 | SELECT | translated document content | OK |
| `document_verifications` | yes | 1 | ALL | verification data | OK |
| `documents` | yes | 1 | ALL | document contents (storage_path) | OK |
| `escalation_history` | yes | 3 | INSERT,SELECT,UPDATE | — | OK |
| `escalation_thresholds` | yes | 2 | ALL,SELECT | — | OK |
| `evidence_packages` | yes | 1 | SELECT | application evidence | OK |
| `feature_flag_audit` | yes | 0 | — | — | deny-all (service-role only) |
| `feature_flags` | yes | 0 | — | — | deny-all (service-role only) |
| `field_provenance` | yes | 1 | SELECT | extracted document field values (PII) | see SEC-4002 |
| `field_verifications` | yes | 1 | SELECT | verification state of PII fields | OK (view leak already fixed — 20260806120000) |
| `form_templates` | yes | 1 | SELECT | — | OK |
| `generated_documents` | yes | 1 | ALL | generated legal documents | OK |
| `intake_messages` | yes | 1 | ALL | intake chat content | OK |
| `kpi_funnel_daily` | yes | 0 | — | — | deny-all (service-role only) |
| `kpi_metric_daily` | yes | 0 | — | — | deny-all (service-role only) |
| `kpi_retention_cohort` | yes | 0 | — | — | deny-all (service-role only) |
| `login_history` | yes | 1 | SELECT | ip,user_agent | OK |
| `marketing_attribution` | yes | 3 | INSERT,SELECT,UPDATE | — | OK |
| `message_attachments` | yes | 2 | INSERT,SELECT | file refs (documents) | OK |
| `messages` | yes | 2 | INSERT,SELECT | message content | OK |
| `notification_broadcasts` | yes | 0 | — | — | deny-all (service-role only) |
| `notification_deliveries` | yes | 1 | SELECT | delivery metadata | see SEC-4004 |
| `notification_outbox` | yes | 0 | — | — | see SEC-4003 (RPC bypass) |
| `notification_preferences` | yes | 1 | ALL | — | OK |
| `notification_templates` | yes | 0 | — | — | deny-all (service-role only) |
| `notifications` | yes | 2 | SELECT,UPDATE | — | OK |
| `ocr_runs` | yes | 1 | SELECT | OCR output linkage | OK |
| `ops_agent_runs` | yes | 0 | — | — | deny-all (service-role only) |
| `ops_experiments` | yes | 0 | — | — | deny-all (service-role only) |
| `ops_marketing_events` | yes | 0 | — | — | deny-all (service-role only) |
| `ops_products` | yes | 0 | — | — | deny-all (service-role only) |
| `ops_revenue` | yes | 0 | — | — | deny-all (service-role only) |
| `organization_invitations` | yes | 1 | SELECT | — | OK |
| `organization_members` | yes | 1 | SELECT | org membership | OK |
| `organizations` | yes | 1 | SELECT | — | OK |
| `partner_access_tokens` | yes | 0 | — | token_hash (secret) | deny-all (service-role only) |
| `partner_api_keys` | yes | 1 | SELECT | key_hash (secret) | OK |
| `partner_api_requests` | yes | 1 | SELECT | — | OK |
| `partner_applications` | yes | 1 | SELECT | — | OK |
| `partner_authorization_codes` | yes | 0 | — | code_hash (secret) | deny-all (service-role only) |
| `partner_events` | yes | 0 | — | — | deny-all (service-role only) |
| `partner_idempotency_keys` | yes | 0 | — | — | deny-all (service-role only) |
| `partner_sandbox_resources` | yes | 0 | — | — | deny-all (service-role only) |
| `partner_usage_counters` | yes | 0 | — | — | see SEC-4008-adjacent note (`increment_partner_usage` correctly revoked) |
| `partner_user_consents` | yes | 2 | SELECT,UPDATE | — | OK |
| `partner_webhook_deliveries` | yes | 1 | SELECT | — | OK |
| `partner_webhook_endpoints` | yes | 1 | SELECT | secret_encrypted | OK |
| `partners` | yes | 1 | SELECT | — | OK |
| `payment_disputes` | yes | 1 | SELECT | financial/dispute detail | OK |
| `payment_dunning` | yes | 1 | SELECT | financial | OK |
| `payment_events` | yes | 1 | SELECT | payment ledger (financial) | see SEC-4009 |
| `payments` | yes | 1 | ALL | amount,stripe ids | OK |
| `payout_tax_statements` | yes | 2 | SELECT | tax data | OK |
| `permissions` | yes | 1 | SELECT | — | OK (public reference data) |
| `post_submission_events` | yes | 1 | ALL | — | OK |
| `preflight_reviews` | yes | 1 | SELECT | — | OK |
| `pricing_constants` | yes | 2 | ALL,SELECT | — | OK |
| `pricing_country_factors` | yes | 2 | ALL,SELECT | — | OK |
| `pricing_quote_audit` | yes | 1 | SELECT | — | OK |
| `pricing_quotes` | yes | 1 | SELECT | — | OK |
| `pricing_visa_tiers` | yes | 2 | ALL,SELECT | — | OK |
| `privacy_requests` | yes | 0 | — | GDPR request data | deny-all (service-role only) |
| `promotions` | yes | 2 | ALL,SELECT | — | OK |
| `push_subscriptions` | yes | 1 | ALL | — | OK |
| `reconciliation_exceptions` | yes | 1 | SELECT | — | OK |
| `reconciliation_runs` | yes | 1 | SELECT | — | OK |
| `refunds` | yes | 1 | SELECT | financial | OK |
| `reminder_log` | yes | 0 | — | — | deny-all (service-role only) |
| `risk_weights` | yes | 2 | ALL,SELECT | — | OK |
| `role_permissions` | yes | 1 | SELECT | — | OK (public reference data) |
| `roles` | yes | 1 | SELECT | — | OK (public reference data) |
| `submission_sessions` | yes | 1 | ALL | — | OK |
| `subscription_credits` | yes | 1 | SELECT | billing | see SEC-4005 |
| `subscriptions` | yes | 1 | SELECT | billing plan | OK |
| `template_revisions` | yes | 0 | — | — | deny-all (service-role only) |
| `template_sweep_findings` | yes | 0 | — | — | deny-all (service-role only) |
| `user_profiles` | yes | 1 | ALL | phone,address,DOB?,country | OK |
| `user_roles` | yes | 1 | SELECT | role grants | OK |
| `users` | yes | 1 | ALL | email,full_name | OK |
| `voice_consents` | yes | 1 | ALL | consent record | OK |
| `voice_messages` | yes | 2 | INSERT,SELECT | voice file refs | OK |
| `voice_sessions` | yes | 1 | ALL | voice session metadata | OK |
| `voice_transcript_turns` | yes | 2 | ALL,SELECT | transcript content (PII/health-adjacent) | OK |
| `vri_recommendations` | yes | 1 | ALL | recommendation content | OK |
| `vri_scores` | yes | 1 | ALL | risk score | OK |
| `vri_visa_suggestions` | yes | 1 | ALL | — | OK |

No `USING (true)` or `WITH CHECK (true)` predicate was found guarding a
sensitive/PII table's writable command **except** `consultations` (SEC-4006). All
other `USING (true)` SELECT policies are on genuinely public reference data
(`country_frameworks`, `roles`, `permissions`, `role_permissions`,
`pricing_constants/visa_tiers/country_factors`, `consultant_availability`,
`consultant_skills`, `consultant_reviews`, `document_templates`, `form_templates`) —
appropriate.

No policy of the form `auth.uid() IS NOT NULL` (any-logged-in-user-sees-everything)
was found anywhere in the 269 policies (`grep -i "auth.uid() is not null"` → zero
hits).

---

## 2. RLS-policy review — findings

### SEC-4006
Title: `consultations` UPDATE policy has `WITH CHECK (true)` — any participant can rewrite every column, including reassigning the consultant, the applicant, or swapping the meeting link
Severity: HIGH
Affected component: Consultant marketplace / video-consultation scheduling
Affected profile(s): applicant, consultant
Affected page/API: any direct PostgREST `PATCH /rest/v1/consultations?id=eq.<id>` call, and any API route that proxies an update through the user's own JWT
Description: `consultations_participant_write` gates the *read* side of an UPDATE with `USING (auth.uid() = user_id OR <caller is the assigned consultant>)`, but the write side is `WITH CHECK (true)` — unconditionally true. Once a caller passes the `USING` gate on their own consultation row, the `WITH CHECK` clause places **no constraint on the new values**, so every column, including `consultant_id`, `user_id`, `application_id`, `provider`, `meeting_url`, `external_event_id`, `scheduled_start/end`, and `status`, can be set to anything.
Attack scenario: A malicious applicant with a legitimately-booked consultation calls `PATCH /rest/v1/consultations?id=eq.<their-consultation-id>` with `{"meeting_url": "https://attacker-phish.example/meet", "external_event_id": "..."}`. The assigned consultant, trusting the row they already have access to, joins the attacker's meeting link at the scheduled time — a credential-phishing / social-engineering vector against consultant staff. Separately, either participant can set `application_id` to point the consultation at an application they do not own (cross-tenant row-linking), or set `consultant_id` to a consultant_profiles.id of their choosing (unassigning the real consultant / assigning a different one without that consultant's consent).
Business impact: meeting-hijack / phishing vector against consultant staff; ability to relink a consultation to an arbitrary application or reassign it to an arbitrary consultant without the counter-party's consent; data integrity of the marketplace scheduling system.
Evidence:
```
-- supabase/migrations/20260626000000_consultant_marketplace.sql:284-287
create policy consultations_participant_write on public.consultations
  for update using (
    auth.uid() = user_id
    or exists (select 1 from public.consultant_profiles cp where cp.id = consultant_id and cp.user_id = auth.uid())
  ) with check (true);
```
The Aug 9 "hoist auth.uid() into a subquery" perf migration mechanically re-emitted the *same* weakness (it explicitly describes itself as a pure textual transformation, not a security review):
```
-- supabase/migrations/20260809140000_hoist_rls_auth_calls.sql:363-371
drop policy if exists "consultations_participant_write" on public."consultations";
create policy "consultations_participant_write" on public."consultations"
  ...
  using ((((select auth.uid()) = user_id) OR (EXISTS (...))))
  with check (true);
```
Root cause: the `WITH CHECK` clause was left as the default placeholder instead of re-asserting `user_id`/`consultant_id` stayed within the caller's own identity, or restricting the writable columns to `status` (which is presumably the only column a participant should ever change post-booking).
Remediation:
```sql
drop policy if exists "consultations_participant_write" on public.consultations;
create policy "consultations_participant_write" on public.consultations
  for update
  using (
    (select auth.uid()) = user_id
    or exists (select 1 from public.consultant_profiles cp
               where cp.id = consultant_id and cp.user_id = (select auth.uid()))
  )
  with check (
    -- identity/link columns must not move under a participant's own UPDATE
    user_id = (select user_id from public.consultations where id = consultations.id)
    and consultant_id = (select consultant_id from public.consultations where id = consultations.id)
    and application_id is not distinct from (select application_id from public.consultations where id = consultations.id)
    -- only status transitions (and no unauthorized meeting-link swap) are allowed
    and meeting_url is not distinct from (select meeting_url from public.consultations where id = consultations.id)
    and external_event_id is not distinct from (select external_event_id from public.consultations where id = consultations.id)
  );
```
(Better: move all consultation mutation to the service-role API, as was already done for `document_requests` in the same era — see `20260612130000_messaging_p2.sql:143-151` — and `REVOKE UPDATE ON public.consultations FROM authenticated`, keeping only a narrow "cancel" RPC.)
Suggested regression test: attempt to PATCH `meeting_url` and `consultant_id` on a consultation as the non-privileged participant via a `forUser` Supabase client; assert both are rejected (403/`new row violates row-level security policy`).
Confidence: CONFIRMED

### Other policy-shape checks performed (no findings)
- No policy protects SELECT while leaving UPDATE/DELETE/INSERT open on the same table — the `document_requests` table explicitly closes this gap with a comment and a `REVOKE UPDATE ... FROM authenticated` (`supabase/migrations/20260612130000_messaging_p2.sql:122-151`).
- `FOR ALL` policies were individually checked; all resolve to an ownership predicate (`auth.uid() = user_id` or an `EXISTS` against a profile-ownership join) except `consultations` (above).
- All 113 of 143 policies that reference `auth.uid()`/`auth.jwt()` were confirmed to call them, never a client-suppliable column, as the *comparison* operand — i.e. every `X = auth.uid()` pattern, not `X = <request param>`. The exception class (functions that take a caller-supplied uid *parameter* rather than reading `auth.uid()` internally) is covered under §3 (SEC-4008), because that risk lives in the **function**, not in the **policy** that calls it correctly.

---

## 3. SECURITY DEFINER functions — findings

18 `SECURITY DEFINER` functions exist. `search_path` pinning: a hardening migration
(`supabase/migrations/20260806100000_security_audit_db_hardening.sql:111-165`) walks
`pg_proc` for every `public` function lacking (or missing `extensions` from) a pinned
`search_path` and applies `alter function ... set search_path = public, extensions,
pg_temp` dynamically. This retroactively covers every function created **before**
Aug 6 (confirmed for `handle_new_user`, `handle_user_identity_sync`, `audit_append`,
`consume_review_credit`, `redeem_coupon`, `field_provenance_create_version`,
`is_marketplace_admin`, `is_pricing_admin`, `is_risk_admin`, `touch_field_verifications`
— none of these show a literal `SET search_path` in their own `CREATE FUNCTION`
statement, but all predate the sweep). Two functions were created **after** the
sweep and are not covered by it: `is_schengen_member` (not SECURITY DEFINER, reads no
tables — no risk) and `audit_no_mutate` (SEC-4010, low risk). This part of the
picture is genuinely good hygiene.

**The gap the hardening migration did not address is `REVOKE`, not `search_path`.**
PostgreSQL grants `EXECUTE` on every newly created function to `PUBLIC` by default;
Supabase's `anon` and `authenticated` roles are ordinary roles and inherit `PUBLIC`
grants like any other role. A `SECURITY DEFINER` function is therefore callable by an
**unauthenticated** client via `POST /rest/v1/rpc/<function_name>` unless someone
explicitly runs `REVOKE ALL ON FUNCTION ... FROM PUBLIC` (or `FROM anon,
authenticated`). Across all 106 migrations, exactly 3 functions carry that revoke:
`cleanup_stale_anonymous_users`, `ensure_month_partition`, `increment_partner_usage`
(`grep -rn "revoke all on function" supabase/migrations/*.sql` → exactly those 3).
**Six other `SECURITY DEFINER` functions that mutate or return sensitive data were
never revoked and are not trigger-only**, so they are live, unauthenticated RPC
endpoints today (subject to the production-parity caveat in the report header).
Trigger-return-type functions (`handle_new_user`, `handle_user_identity_sync`,
`refresh_consultant_rating`, `enqueue_application_status_changed`) are **not**
exploitable this way — PostgreSQL itself refuses `SELECT fn()` on a function whose
return type is the `trigger` pseudo-type ("trigger functions can only be called as
triggers"), regardless of grants, so those four are excluded below.

### SEC-4001
Title: `audit_append()` is an unrevoked SECURITY DEFINER RPC — any anon/authenticated caller can forge immutable audit-trail entries for any application, attributed to any actor
Severity: CRITICAL
Affected component: Audit / compliance evidence chain (`audit_events`, hash-chained via `audit_chain_state`)
Affected profile(s): anon (no login required), authenticated
Affected page/API: `POST /rest/v1/rpc/audit_append` (PostgREST default RPC exposure)
Description: `public.audit_append(p_application_id, p_event_type, p_actor_id, p_actor_role, p_payload, ...)` is `SECURITY DEFINER`, runs as the function owner (bypassing `audit_events`' RLS, which is owner-read-only with **no INSERT policy** — the schema's entire design assumes this function is the *only* write path), and takes `p_application_id` and `p_actor_id` as **trusted, caller-supplied parameters** rather than deriving them from `auth.uid()`. It was never revoked from `PUBLIC`/`anon`/`authenticated`. `audit_events` is designed to be tamper-evident (`audit_no_mutate` blocks UPDATE/DELETE, and each row is chained via `row_hash`/`prev_hash`) — but the chain only proves internal consistency of whatever was appended, not that what was appended is genuine. Any caller who can reach PostgREST with just the public `anon` key can call this RPC directly.
Attack scenario: An attacker (no account needed) calls `POST /rest/v1/rpc/audit_append` with `p_application_id` = any application UUID (or one belonging to them), `p_actor_id` = another user's or a consultant's UUID, `p_event_type` = e.g. `'consultant_approval'`, and a fabricated `p_payload`/`p_value_hash`. The row is inserted, permanently chained into that application's audit history, and cannot subsequently be distinguished from a legitimate system-generated event by anything the database enforces — the chain hash only proves the sequence wasn't edited *after* insertion, not that the content was authentic *at* insertion. This directly undermines the evidentiary purpose of the table (this is an immigration platform; the audit trail is the record of who-did-what-when for applications going to a government agency).
Business impact: forgeable compliance/legal record; false attribution of actions to real users/consultants; undermines any future legal or regulatory reliance on `audit_events` as a tamper-evident log — the tamper-evidence only defends against post-hoc edits, not fabricated inserts.
Evidence:
```sql
-- supabase/migrations/20260606000004_audit_events.sql:92-154
create or replace function public.audit_append(
  p_application_id        uuid,
  p_event_type           audit_event_type,
  p_actor_id             uuid,
  p_actor_role           audit_actor_role,
  p_payload              jsonb,
  ...
) returns public.audit_events as $$
...
  insert into public.audit_events (
    application_id, seq, event_type, actor_id, actor_role, ...
  ) values (
    p_application_id, v_seq, p_event_type, p_actor_id, p_actor_role, ...
  ) returning * into v_row;
...
$$ language plpgsql security definer;
```
No `revoke` statement for `audit_append` exists anywhere in the migration set —
confirmed via `grep -rn -i "revoke.*audit_append" supabase/migrations/*.sql` (zero
results) against the full "revoke all on function" inventory
(`cleanup_stale_anonymous_users`, `ensure_month_partition`,
`increment_partner_usage` only).
Root cause: the function was written to be called only from the trusted NestJS backend via the service-role client, and that assumption was never enforced at the database grant layer.
Remediation:
```sql
revoke all on function public.audit_append(
  uuid, audit_event_type, uuid, audit_actor_role, jsonb, text, uuid, uuid, text, uuid, text, text, text, text
) from public, anon, authenticated;
```
(Apply the same statement, with the correct signature, to every function in SEC-4001–SEC-4005/SEC-4007 below. Longer-term: default-deny by changing the schema's default privileges — `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` — so a future `CREATE FUNCTION` is safe-by-default and must opt in to client exposure.)
Suggested regression test: as an anon-key client (no `Authorization` header beyond the anon key), `POST /rest/v1/rpc/audit_append` with any parameters and assert `42501 insufficient_privilege` (or PostgREST's `PGRST202`) rather than a 2xx with a row.
Confidence: CONFIRMED (grant behavior is documented, deterministic PostgreSQL default; absence of REVOKE is an exhaustive grep across all 106 migration files — not tested against a live database, since production access is out of scope for this audit).

### SEC-4002
Title: `field_provenance_create_version()` is an unrevoked SECURITY DEFINER RPC — any anon/authenticated caller can forge document-field extraction evidence for any application
Severity: CRITICAL
Affected component: Document/OCR provenance chain (`field_provenance`, `ocr_runs`)
Affected profile(s): anon, authenticated
Affected page/API: `POST /rest/v1/rpc/field_provenance_create_version`
Description: Same shape as SEC-4001. `public.field_provenance_create_version(p_application_id, p_field_key, p_origin, p_value_snapshot, p_value_hash, p_source_document_id, p_source_page, p_source_bbox, p_ocr_run_id, p_confidence, p_confidence_band)` is `SECURITY DEFINER`, atomically supersedes the current provenance row for `(p_application_id, p_field_key)` and inserts a new one — with every identifying value, including `p_application_id`, taken as a trusted parameter. Never revoked.
Attack scenario: A caller invents a plausible `p_application_id`/`p_field_key` pair (or targets their own application) and calls the RPC directly with a fabricated `p_value_snapshot`, `p_confidence` = 0.99, `p_origin` = `'ocr'`, and an arbitrary `p_value_hash`/`p_source_document_id`. This is the exact same append-only chain (`field_provenance_create_version` comment: "Gate 2 / 2E: atomic supersede-then-insert... Append-only versioning") that the verification pipeline (`check-docs-ready.ts`, cross-verification) treats as ground truth about what OCR actually extracted from a real uploaded document. A forged high-confidence row can make an application look "verified" without the underlying document ever having been checked.
Business impact: this is a visa/immigration application platform — forging field-provenance directly undermines the integrity of the documented-evidence pipeline that downstream readiness/VRI scoring and consultant review rely on.
Evidence:
```sql
-- supabase/migrations/20260606000008_field_provenance_versioning.sql:34-70
create or replace function public.field_provenance_create_version(
  p_application_id     uuid,
  p_field_key         text,
  ...
) returns public.field_provenance as $$
...
$$ language plpgsql security definer;
```
No revoke statement found for this function name in any migration.
Root cause: same as SEC-4001 — trusted-caller assumption, not enforced at the grant layer.
Remediation:
```sql
revoke all on function public.field_provenance_create_version(
  uuid, text, text, text, text, uuid, int, jsonb, uuid, numeric, text
) from public, anon, authenticated;
```
Suggested regression test: same pattern as SEC-4001, targeted at this RPC name.
Confidence: CONFIRMED (same basis as SEC-4001)

### SEC-4003
Title: `claim_outbox_batch()` is an unrevoked SECURITY DEFINER RPC — any anon/authenticated caller can read every pending notification's `user_id`/`application_id`/payload across all tenants, and disrupt the delivery pipeline
Severity: CRITICAL
Affected component: Notification outbox (`notification_outbox`)
Affected profile(s): anon, authenticated
Affected page/API: `POST /rest/v1/rpc/claim_outbox_batch`
Description: `notification_outbox` has RLS enabled with **zero policies** — by design, per its own comment ("Service-role writes/reads only... no public policy"), it should be completely unreachable by anon/authenticated. `claim_outbox_batch(p_limit int)` is a `SECURITY DEFINER` function, `returns setof public.notification_outbox`, that atomically claims and returns up to `p_limit` unprocessed rows with `FOR UPDATE SKIP LOCKED`, incrementing `attempts` as a side effect. Because it is never revoked, it completely bypasses the table's intended zero-policy lockdown: any anon-key caller can call it directly and receive the full row set, including `payload` — which the trigger that populates the table (`enqueue_application_status_changed`) builds as `jsonb_build_object('userId', new.user_id, 'applicationId', new.id, 'data', jsonb_build_object('status', new.status))` for **every user in the system** whose application status recently changed, not just the caller's own.
Attack scenario: `POST /rest/v1/rpc/claim_outbox_batch {"p_limit": 1000}` with only the public anon key returns up to 1000 rows of `{userId, applicationId, status}` for arbitrary users — a direct, unauthenticated, cross-tenant PII disclosure requiring no account. Each call also increments `attempts` on the real notification queue and can starve/interfere with the legitimate `OutboxProcessor` drain worker (their `FOR UPDATE SKIP LOCKED` windows compete), a denial-of-service angle on the notification pipeline.
Business impact: unauthenticated, at-scale PII disclosure (user IDs + application IDs + status changes, i.e. which applications exist and their state, for the whole platform); notification-delivery reliability risk.
Evidence:
```sql
-- supabase/migrations/20260704000000_notification_outbox.sql:21-22
alter table public.notification_outbox enable row level security;
-- Service-role writes/reads only (trigger + drain worker); no public policy.
```
```sql
-- supabase/migrations/20260704005000_claim_outbox_batch.sql:6-23
create or replace function public.claim_outbox_batch(p_limit int)
returns setof public.notification_outbox
language sql
security definer
set search_path = public
as $$
  update public.notification_outbox o
     set attempts = o.attempts + 1
   where o.id in (
     select id from public.notification_outbox
      where processed_at is null order by created_at
      for update skip locked limit p_limit
   )
  returning o.*;
$$;
```
No `revoke` statement for `claim_outbox_batch` exists in any migration (grep across all 106 files, zero results).
Root cause: same trusted-caller-via-service-role assumption as SEC-4001/4002, not enforced at the grant layer — and here it is compounded because it defeats a table that was deliberately built as zero-policy-deny-all.
Remediation:
```sql
revoke all on function public.claim_outbox_batch(int) from public, anon, authenticated;
```
Suggested regression test: anon-key `POST /rest/v1/rpc/claim_outbox_batch {"p_limit":10}` must return `42501`/`PGRST202`, not rows. Add to the existing RLS tenant-isolation suite (`apps/api/test/rls-cross-tenant.spec.ts` already exists and is the right home for this).
Confidence: CONFIRMED (same basis as SEC-4001)

### SEC-4004
Title: `bump_delivery_attempt()` is an unrevoked SECURITY DEFINER RPC — any caller can overwrite the status/error of any notification delivery record
Severity: HIGH
Affected component: Notification delivery tracking (`notification_deliveries`)
Affected profile(s): anon, authenticated
Affected page/API: `POST /rest/v1/rpc/bump_delivery_attempt`
Description: `bump_delivery_attempt(p_delivery_id uuid, p_status text, p_error text)` is `SECURITY DEFINER`, `set search_path = public`, and unconditionally updates `notification_deliveries` for the given `p_delivery_id` with no ownership check and no validation that `p_status` is a recognized value (the column-level `check` constraint, if any, is the only backstop). Never revoked.
Attack scenario: A caller enumerates or is handed a `delivery_id` (e.g. from their own notification history via `notification_deliveries_own_select`) and can then arbitrarily flip its `status`/`error` for any delivery ID, including ones they do not own, corrupting delivery-success telemetry and potentially masking a real failed delivery as `'delivered'`.
Business impact: integrity of notification-delivery tracking; potential to hide evidence of missed/failed critical notifications (e.g. application status changes).
Evidence:
```sql
-- supabase/migrations/20260704010000_notification_attempt_rpc.sql:6-22
create or replace function public.bump_delivery_attempt(
  p_delivery_id uuid, p_status text, p_error text default null
) returns void language sql security definer set search_path = public as $$
  update public.notification_deliveries
     set attempts = attempts + 1, status = p_status, error = p_error, updated_at = now()
   where id = p_delivery_id;
$$;
```
No revoke statement found for this function.
Root cause: same pattern as SEC-4001–4003.
Remediation:
```sql
revoke all on function public.bump_delivery_attempt(uuid, text, text) from public, anon, authenticated;
```
Suggested regression test: anon-key call must be rejected; add a positive test that the legitimate service-role worker path still succeeds.
Confidence: CONFIRMED

### SEC-4005
Title: `consume_review_credit(p_user_id, ...)` is an unrevoked SECURITY DEFINER RPC that trusts a caller-supplied `p_user_id` instead of `auth.uid()` — any caller can deplete another paying user's subscription review credits
Severity: HIGH
Affected component: Subscription credits (`subscription_credits`)
Affected profile(s): anon, authenticated
Affected page/API: `POST /rest/v1/rpc/consume_review_credit`
Description: `consume_review_credit(p_user_id uuid, p_application_id uuid)` is `SECURITY DEFINER` and decrements the *given* `p_user_id`'s current-period credit — it does not check `p_user_id = auth.uid()`, and it is not revoked from `PUBLIC`. This is exactly the pattern the audit brief calls out: "Do they take a user id argument they trust instead of using auth.uid()?"
Attack scenario: Any authenticated (even a free/anonymous-guest) user calls `POST /rest/v1/rpc/consume_review_credit {"p_user_id": "<victim-paid-subscriber-uuid>", "p_application_id": "<any-uuid>"}` repeatedly. Each call that finds an active credit period atomically consumes one of the victim's paid review credits — a resource-griefing / denial-of-paid-service attack against another tenant, requiring only that the attacker learn or guess the victim's user UUID (obtainable in-product in several places — e.g. as a consultant's `consultant_id`/counter-party in a shared conversation, or via the enumeration surface in SEC-4008).
Business impact: direct financial/product harm — a paying customer's purchased review credits can be silently exhausted by another party.
Evidence:
```sql
-- supabase/migrations/20260705010000_sp2_subscriptions.sql:38-52
-- SECURITY DEFINER so the app calls it via service-role RPC; the WHERE guard +
-- the table check make over-consumption impossible even under concurrency.
create or replace function public.consume_review_credit(p_user_id uuid, p_application_id uuid)
returns boolean as $$
declare v_id uuid;
begin
  update public.subscription_credits
     set consumed = consumed + 1
   where user_id = p_user_id
     and now() >= period_start and now() < period_end
     and consumed < granted
   returning id into v_id;
  return v_id is not null;
end;
$$ language plpgsql security definer;
```
The comment itself states the intended caller is "the app... via service-role RPC" — that intent was never enforced with a `REVOKE`. No revoke statement exists for this function.
Root cause: same pattern; additionally the function was designed to take an explicit `p_user_id` (reasonable for a trusted service-role caller acting on a webhook/queue item) but that design choice becomes a direct authorization bypass once the function is reachable by an untrusted caller.
Remediation:
```sql
revoke all on function public.consume_review_credit(uuid, uuid) from public, anon, authenticated;
```
If any client-side (as opposed to service-role) call path is ever intended for this function, it must additionally be rewritten to use `(select auth.uid())` instead of trusting `p_user_id`.
Suggested regression test: anon/authenticated-key call must be rejected; add a test that repeatedly calling with another user's id from the legitimate service path is still correctly scoped.
Confidence: CONFIRMED

### SEC-4007
Title: `redeem_coupon()` is an unrevoked SECURITY DEFINER RPC — anyone can exhaust a limited-quantity coupon's redemption pool without completing a purchase
Severity: MEDIUM
Affected component: Discounts/coupons (`coupons`)
Affected profile(s): anon, authenticated
Affected page/API: `POST /rest/v1/rpc/redeem_coupon`
Description: `redeem_coupon(p_coupon_id uuid)` is `SECURITY DEFINER` and unconditionally increments `coupons.redeemed_count` for any active coupon under its `max_redemptions`, with no linkage to an actual completed purchase and no `REVOKE`.
Attack scenario: A competitor or griefer enumerates/discovers a promotional coupon's UUID (coupon IDs may be less sensitive than user IDs, but marketing pages, referral links or the discount_redemptions read path could expose them) and calls the RPC in a loop until `redeemed_count` hits `max_redemptions`, denying the discount to legitimate customers with no purchase ever occurring.
Business impact: marketing/promo abuse, financial impact if the exhausted coupon was tied to a partner/press promotion.
Evidence:
```sql
-- supabase/migrations/20260705020000_sp3_onetime_payments.sql:116-129
-- Atomic redemption counter — respects max_redemptions under concurrency.
create or replace function public.redeem_coupon(p_coupon_id uuid)
returns boolean as $$
declare v_id uuid;
begin
  update public.coupons
     set redeemed_count = redeemed_count + 1, updated_at = now()
   where id = p_coupon_id and active = true
     and (max_redemptions is null or redeemed_count < max_redemptions)
   returning id into v_id;
  return v_id is not null;
end;
$$ language plpgsql security definer;
```
No revoke statement exists for this function.
Root cause: same trusted-caller pattern; lower severity than SEC-4001-4005 because the blast radius is a promo budget, not PII or an evidentiary record.
Remediation:
```sql
revoke all on function public.redeem_coupon(uuid) from public, anon, authenticated;
```
And ensure the real checkout path calls it only after payment confirmation (service-role), not client-side.
Suggested regression test: anon-key call rejected; verify the coupon-checkout integration test still passes via the service-role path.
Confidence: CONFIRMED

### SEC-4008
Title: RLS-recursion-breaking helper functions are directly RPC-callable with a caller-controlled uid/application-id, enabling enumeration that bypasses `applications`' owner-only RLS
Severity: MEDIUM
Affected component: Consultant-visibility helper functions (`is_active_assignee`, `app_has_active_consultant`, `consultant_covers_country`, `app_destination_country`)
Affected profile(s): anon, authenticated
Affected page/API: `POST /rest/v1/rpc/app_destination_country` (worst case; also `is_active_assignee`, `app_has_active_consultant`, `consultant_covers_country`)
Description: These four functions were added specifically to break an RLS-policy recursion cycle (`applications` ⇄ `consultant_assignments`) and are correctly used *inside* other policies with `(select auth.uid())` as the argument — that usage is safe because the RLS engine, not the client, supplies the value. But all four are `SECURITY DEFINER` **and explicitly `GRANT EXECUTE ... TO authenticated, anon`**, and all four take the identity/target as a plain parameter rather than reading it internally. That combination means they are also directly callable via RPC with *attacker-chosen* arguments. Three return booleans (limited disclosure: "is uid X the active assignee of application Y", "does application Y have any active consultant", "does consultant X cover country Y"). The fourth, `app_destination_country(p_app uuid)`, returns the actual `destination_country` **text value** for any application ID — real data, not a boolean — completely bypassing `applications`' owner-only SELECT policy for that one column, given only the application's UUID.
Attack scenario: An attacker who has obtained or guessed an application UUID (e.g. leaked via a referer header, log line, or another lower-severity issue) calls `POST /rest/v1/rpc/app_destination_country {"p_app": "<uuid>"}` with just the anon key and learns which country that application targets — without ever passing the `applications` table's RLS. Combined with SEC-4005 (which requires a *user* UUID rather than an *application* UUID), this class of helper meaningfully lowers the bar for targeted probing once any UUID belonging to another tenant is known.
Business impact: MEDIUM — requires knowledge of a v4 UUID (122 bits of entropy, not practically enumerable at random), so this is a defense-in-depth/side-channel finding rather than a mass-scrape vector, but it is a genuine RLS bypass for real data (destination country) and a confirmed instance of "function trusts a caller-supplied id argument instead of auth.uid()" exactly as called out in the audit brief.
Evidence:
```sql
-- supabase/migrations/20260608000003_fix_visibility_recursion.sql:12-44
create or replace function public.app_has_active_consultant(p_app uuid)
  returns boolean language sql stable security definer set search_path = public as $$ ... $$;
create or replace function public.is_active_assignee(p_app uuid, p_uid uuid)
  returns boolean language sql stable security definer set search_path = public as $$ ... $$;
create or replace function public.consultant_covers_country(p_uid uuid, p_country text)
  returns boolean language sql stable security definer set search_path = public as $$ ... $$;
create or replace function public.app_destination_country(p_app uuid)
  returns text language sql stable security definer set search_path = public as $$
  select destination_country from public.applications where id = p_app;
$$;

grant execute on function public.app_has_active_consultant(uuid) to authenticated, anon;
grant execute on function public.is_active_assignee(uuid, uuid) to authenticated, anon;
grant execute on function public.consultant_covers_country(uuid, text) to authenticated, anon;
grant execute on function public.app_destination_country(uuid) to authenticated, anon;
```
Root cause: the grant was scoped correctly for the RLS-policy use case ("policies need to be able to call this") but PostgREST's default RPC exposure means "grant execute to anon" and "expose as a public unauthenticated endpoint" are the same statement — there is no way in plain Postgres grants to say "callable from a policy context only."
Remediation: PostgREST supports hiding a function from the auto-generated RPC surface independent of its grants by putting it in a schema that is not in `db-schemas`/`PGRST_DB_SCHEMAS`, OR (simpler here, no infra change) keep the boolean helpers as-is (their disclosure is minor and they are load-bearing for existing RLS policies that cannot be trivially rewritten without reintroducing the recursion bug), but change `app_destination_country` to stop returning raw data to a direct caller:
```sql
-- Option A: revoke direct callability, keep it usable from policies by having
-- policies inline the subquery instead (loses recursion-safety benefit, so NOT
-- recommended given 20260608000003's whole point was avoiding this).
-- Option B (recommended): don't return the value to a direct caller — split into
-- an internal-only variant used by policies (owner + `revoke ... from anon`) if
-- Postgres/PostgREST version supports schema-scoped RPC hiding; otherwise accept
-- the boolean-only helpers (is_active_assignee, app_has_active_consultant,
-- consultant_covers_country) as intentional low-sensitivity surface, but stop
-- app_destination_country from being used this way — inline the destination-country
-- lookup back into the two call sites that need it
-- (applications_owner_consultant_admin_select, consultant_assignments_self_insert)
-- via a join instead of calling the text-returning helper, since a boolean
-- (`consultant_covers_country`) is all those two policies actually need.
```
Suggested regression test: anon-key `POST /rest/v1/rpc/app_destination_country` against a known application UUID that the caller does not own; assert it does not leak the country (either by revoking, or by refactoring away the direct dependency).
Confidence: CONFIRMED (the GRANT statements are unambiguous; the RPC-exposure consequence is standard PostgREST behavior, not tested live)

---

## 4. RPCs exposed to anon/authenticated — summary

Directly callable via `POST /rest/v1/rpc/<name>` today, per the grant analysis above
(assuming the migrations that create them have been applied):

| RPC | Grant path | What it does | Finding |
|---|---|---|---|
| `audit_append` | unrevoked PUBLIC default | insert an audit_events row for any application/actor | SEC-4001 CRITICAL |
| `field_provenance_create_version` | unrevoked PUBLIC default | insert/supersede a field_provenance row for any application | SEC-4002 CRITICAL |
| `claim_outbox_batch` | unrevoked PUBLIC default | read+mutate notification_outbox for all tenants | SEC-4003 CRITICAL |
| `bump_delivery_attempt` | unrevoked PUBLIC default | overwrite any notification_deliveries row's status | SEC-4004 HIGH |
| `consume_review_credit` | unrevoked PUBLIC default | consume any user's subscription review credit | SEC-4005 HIGH |
| `redeem_coupon` | unrevoked PUBLIC default | exhaust any coupon's redemption pool | SEC-4007 MEDIUM |
| `app_destination_country` | explicit `grant ... to anon` | return any application's destination_country | SEC-4008 MEDIUM |
| `is_active_assignee` / `app_has_active_consultant` / `consultant_covers_country` | explicit `grant ... to anon` | boolean probes about arbitrary app/consultant pairs | SEC-4008 MEDIUM |
| `is_schengen_member` | explicit `grant ... to anon` | pure literal-set membership test, no data | none — harmless |
| `is_analytics_admin` | unrevoked PUBLIC default, no args | returns caller's own admin-claim boolean | none — harmless (reflects caller's own JWT only) |
| `cleanup_stale_anonymous_users` | REVOKED | — | correctly locked down |
| `ensure_month_partition` | REVOKED | — | correctly locked down |
| `increment_partner_usage` | REVOKED | — | correctly locked down |
| `handle_new_user`, `handle_user_identity_sync`, `refresh_consultant_rating`, `enqueue_application_status_changed` | unrevoked, but `returns trigger` | N/A | not exploitable — Postgres refuses direct calls to trigger functions |

---

## 5. Storage buckets

Four buckets are declared in migrations, **all `public = false`**:

```
supabase/migrations/20260603000001_document_privacy.sql:14-16   -> 'documents'          public=false
supabase/migrations/20260806140000_beta_feedback.sql:49-51       -> 'feedback'           public=false
supabase/migrations/20260811120000_form_templates.sql:36-38      -> 'form-templates'     public=false
supabase/migrations/20260813120000_document_templates.sql:39-41  -> 'document-templates' public=false
```

`documents` (identity/immigration documents) and `feedback` (user screenshots) carry
path-scoped `storage.objects` policies keyed on `auth.uid()::text = (storage.foldername(name))[1]`
(`20260603000001_document_privacy.sql:20-47`, `20260806140000_beta_feedback.sql:53-76`).
`form-templates` and `document-templates` intentionally carry **no** `storage.objects`
policy — both hold only non-user government-published PDFs, both are read exclusively
through service-role-signed URLs, and both explicitly document why (comment:
"Absent policies mean the anon role cannot reach it at all, which is the intent").
Verified this claim is structurally true: RLS on `storage.objects` (a Supabase-managed
table) is enabled by default, so a bucket with zero policies is deny-all, same
reasoning as the 34 zero-policy application tables in §1.

Message/voice attachments (`message_attachments`, `voice_messages`) deliberately add
**no** new `storage.objects` policy either — per
`20260612130000_messaging_p2.sql:1-9`, all reads/writes for those go through
service-role-signed URLs issued by `AttachmentService` only after an explicit
conversation-access check (`apps/api/src/modules/messaging/attachment.service.ts:302-334`,
`apps/api/src/modules/messaging/messaging.service.ts:98-115`) — confirmed by reading
`AttachmentService.getDownloadUrl`/`getVoiceDownloadUrl`, which fetch the row through
`this.supabase.forUser(token)` (RLS-enforced) before minting a signed URL, and
`ensureConversation`, which calls `assertApplicationAccess` before any storage
operation. This is a sound pattern.

**Object key/path construction** (`apps/api/src/modules/messaging/attachment.service.ts:107`):
`` `${ownerUserId}/${applicationId}/messages/${conversation.id}/${Date.now()}-${safeName(input.fileName)}` `` —
not client-controlled beyond the sanitized filename (`safeName` strips to
`[a-zA-Z0-9._-]`), not predictable in a way that matters since storage access never
goes through the user's own JWT for this bucket, and `documents.service.ts`'s
direct-upload path (per `20260603000001_document_privacy.sql`'s comment) uses
`${userId}/${applicationId}/...`, matching the RLS policy's own-uid-prefix check.

**Verdict: no public bucket, no predictable-path-with-no-policy gap found.** One
caveat: this audit can only see buckets declared in `supabase/migrations/`. The very
first document-privacy migration's own comment acknowledges the historical risk this
audit cannot rule out: *"The bucket was previously assumed to exist (created via the
dashboard)"* — if any bucket was created directly via the Supabase dashboard and never
backfilled into a migration, its `public`/policy state is **UNVERIFIED** by this
audit (out of scope: no production/dashboard access).

---

## 6. Service-role key usage

**(a) Reachability from client bundles — CLEAN.** Exhaustive grep for
`SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`, `service_role` across the whole repo
(excluding `node_modules`/`.next`/`dist`) found matches only in: `.env.example`
files (placeholders), `apps/api/test/*` and `apps/api/src/**` (server-side only). Zero
matches in `apps/web`, `apps/mobile/src`, `apps/mobile/app`, or `apps/extension`.
`apps/web/.env.example` has no `NEXT_PUBLIC_*`-prefixed secret-shaped variable
(`NEXT_PUBLIC_*` variables are the only ones baked into the browser bundle by
Next.js). **Verdict: the service-role key is not reachable from any client bundle.**

**(b) Server-side call-site ownership filtering.** `SupabaseService` in
`apps/api/src/modules/shared/supabase/supabase.service.ts:1-95` implements exactly
the pattern this audit brief asks for: `admin` (service-role, documented as
"background jobs / webhooks only") vs. `forUser(accessToken)` (anon key + caller's
JWT, RLS enforced), with an explicit code comment mandating request handlers prefer
`forUser`. 57 call sites use `.admin` across 30 files
(`grep -rn "\.admin\." apps/api/src --include="*.ts" | grep -v spec.ts | wc -l`).
Sampled the highest-traffic and highest-sensitivity files in full:

- `apps/api/src/modules/messaging/attachment.service.ts` — `.admin` used only for (1) resolving the storage-path owner uid after `forUser`-based access has already been asserted via `ensureConversation`→`assertApplicationAccess`, and (2) signing storage URLs after the caller's row-level read access was already confirmed through a `forUser` query. Filtered.
- `apps/api/src/modules/provenance/provenance.repository.impl.ts` — every read is `.eq('application_id', applicationId)` / `.eq('source_document_id', documentId)`-scoped; this is an intentionally service-role-only repository (comment: "Service-role (admin) path") because `field_provenance` has no client-writable policy by design. Caller-supplied `applicationId` scoping is present, but note this repository is exactly the layer SEC-4002 shows can be bypassed entirely by going around the NestJS layer straight to the RPC.
- `apps/api/src/modules/voice/voice.gateway.ts` — `.admin.auth.getUser(token)` used only to validate a handshake token before establishing socket identity; standard pattern.
- `apps/api/src/modules/admin/*`, `apps/api/src/modules/feature-flags/feature-flags.admin.controller.ts`, `apps/api/src/modules/marketplace/marketplace-admin.controller.ts`, `apps/api/src/modules/pricing/pricing.controller.ts` (admin routes) — all confirmed behind `@UseGuards(JwtGuard, RolesGuard) @RequireRole('admin')` (or `PermissionsGuard`/`RequirePermission` for feature flags) at the controller level (`apps/api/src/modules/admin/admin.controller.ts:33-36`, `apps/api/src/modules/pricing/pricing.controller.ts:55-84`).
- `apps/api/src/modules/subscriptions/subscriptions.repository.impl.ts`, `apps/api/src/modules/financial-ops/financial-ops.repository.impl.ts`, `apps/api/src/modules/ledger/ledger.service.ts`, `apps/api/src/modules/reconciliation/reconciliation.service.ts` — all system-of-record writes driven by Stripe webhook payloads (provider IDs as the natural key), not user-suppliable identifiers; appropriate for `.admin`.
- `apps/api/src/modules/privacy/privacy.service.ts` — `.admin.auth.admin.deleteUser(userId)` / storage purge for GDPR erasure; see SEC-4009 for a related schema-level gap this code path will hit.
- `apps/api/src/modules/automation/automation.service.ts:203-224` — `.admin.from('documents')...eq('application_id', applicationId)` before signing a download URL; filtered by application id (ownership of that id by the calling context was not re-traced to its origin in this pass — flagged as a lower-confidence area but no filter is *missing*, just not re-verified end-to-end).

**No call site sampled was found to be missing an ownership/tenant filter.** Given
the volume (57 sites / 30 files), this is a sample, not exhaustive coverage — the
concrete, evidenced gaps found in this audit are instead at the SQL/RPC layer
(§3), which sits *below* all of this NestJS-layer discipline and bypasses it
entirely.

---

## 7. What the anon/publishable key can do — summary

- **Tables:** every table with a real policy exposes exactly what that policy says (see §1); the 34 zero-policy tables are unreachable directly.
- **Storage:** `documents` and `feedback` buckets, own-uid-prefixed paths only; `form-templates`/`document-templates` unreachable directly (service-role-signed URLs only).
- **RPC:** the full table in §4 — most notably `audit_append`, `field_provenance_create_version`, `claim_outbox_batch`, `bump_delivery_attempt`, `consume_review_credit`, `redeem_coupon`, and `app_destination_country`, none of which should be anon/authenticated-reachable given their own design comments.
- **Views:** `section_verification`, `ai_cost_actual_vs_model`, `v_application_funnel`, `application_activity` — all forced to `security_invoker = true` by `20260806120000_views_security_invoker.sql` (loop over every `public` view; see §8). No grant to `anon`/`authenticated` was found for any of the four in the migrations (PostgREST would 42501 on them), matching that migration's own note that only `section_verification` was live-exploitable at the time and has since been fixed.

---

## 8. Grants / privileges / views

No `GRANT ALL ... TO anon` or `TO authenticated` statement of any kind exists in the
migration set — `grep -rn -i "grant" supabase/migrations/*.sql | grep -vi "grant execute"`
returns only two `GRANT SELECT ... TO service_role` statements
(`20260809150000_schema_hygiene_views.sql:62-63`, both service_role-only metadata
views). The broad `anon`/`authenticated` table grants referenced repeatedly in
migration comments ("Supabase's bootstrap issues `grant all on all tables in schema
public to anon, authenticated`") are a **platform default**, not something this
repository's migrations grant — and the repository already contains a fix for the
unreachable-write-privilege surplus this creates:

```sql
-- supabase/migrations/20260809120000_revoke_unused_dml_grants.sql:35-67
-- computes, at apply time, every table where anon/authenticated hold an
-- INSERT/UPDATE/DELETE grant with NO permissive policy that could ever use it,
-- and revokes exactly that surplus. Measured locally: 137 tables carry the
-- grant, 53 have a real write policy, 84 do not.
```
This migration's own header states it is **NOT YET APPLIED TO PRODUCTION**
(BLK-1: no backup). See SEC-4012.

**Views over RLS-protected tables:** confirmed the `security_invoker` sweep
(`20260806120000_views_security_invoker.sql`) applies to every `public` view, not a
hardcoded list, and is paired with a CI lint (`infra/scripts/schema-rebuild-test.sh`,
referenced in the migration comment) that fails the build if a future view forgets
the option. `20260809150000_schema_hygiene_views.sql` adds two further metadata-only
views (`v_client_dml_grants_without_policy`, `v_public_indexes`), both
`security_invoker = true` and `service_role`-only, used to make the DB-003/PERF-007
invariants CI-assertable. This is good, durable engineering — a one-time fix plus a
lint that prevents regression, unlike the SECURITY DEFINER-revoke gap in §3, which has
no equivalent lint.

---

## 9. Append-only / audit tables

Read both requested migrations in full.

- `20260813140000_append_only_cascade_fix.sql`: fixes a **production-confirmed**
  outage (`DELETE FROM auth.users` failing with `audit_events is append-only: DELETE
  not permitted`) by moving `audit_events.application_id`, `evidence_packages.application_id`,
  and `reconciliation_exceptions.run_id` from `ON DELETE CASCADE`/implicit-restrict to
  `ON DELETE SET NULL`, so GDPR Art. 17 erasure (`privacy.service.ts`) can proceed
  without the FK trying to cascade a DELETE into an append-only table.
- `20260813150000_audit_allow_link_anonymisation.sql`: extends `audit_no_mutate()` to
  permit the *one* shape of UPDATE that `ON DELETE SET NULL` produces (a link column
  transitioning non-null → null with every other column byte-identical), via an
  explicit allowlist of FK columns (`application_id, actor_id, document_id,
  ocr_run_id, submission_session_id, consultant_id, run_id, user_id`) rather than a
  generic "any column going to null is fine" rule — correctly rejected as unsafe in
  the migration's own comment, since that would also permit nulling `value_hash` and
  defeat the tamper-evidence the table exists for.

Both migrations are well-reasoned and the fix is sound. **One related table was
missed by this fix:**

### SEC-4009
Title: `payment_events.user_id` still references `auth.users(id)` with no `ON DELETE` action — GDPR erasure will fail for any user with payment history, the same bug class `20260813140000`/`150000` just fixed elsewhere
Severity: MEDIUM
Affected component: Payment ledger (`payment_events`) / privacy erasure (`privacy.service.ts`)
Affected profile(s): any user requesting account deletion who has ever triggered a Stripe webhook event (i.e. almost any paying user)
Affected page/API: GDPR/CCPA "delete my account" flow
Description: `payment_events` carries the same `audit_no_mutate` append-only trigger as `audit_events`/`evidence_packages`/`reconciliation_exceptions` (confirmed: `20260705000000_sp1_payment_foundation.sql:38-47` attaches `audit_no_mutate` to both UPDATE and DELETE). Its `user_id uuid references auth.users(id)` column (`20260705000000_sp1_payment_foundation.sql:28`) has **no `ON DELETE` clause**, which defaults to `NO ACTION` — functionally the same as `RESTRICT` for an immediate (non-deferred) constraint. `20260813140000_append_only_cascade_fix.sql` fixed exactly this shape of bug for three sibling append-only tables but did not include `payment_events`, even though its own header explicitly names it in the code comment listing "every FK column on the append-only tables (audit_events, evidence_packages, payment_events, reconciliation_exceptions)" inside `audit_no_mutate()`'s `link_columns` array (`20260813150000_audit_allow_link_anonymisation.sql:60-73`) — i.e. the anonymization-allowlist fix already anticipates `payment_events.user_id` needing this treatment, but the FK itself was never altered to `ON DELETE SET NULL` to trigger that code path.
Attack scenario: N/A (this is an availability/compliance bug, not an exploit) — `DELETE FROM auth.users WHERE id = '<user-with-a-stripe-event>'` raises `update or delete on table "users" violates foreign key constraint "payment_events_user_id_fkey" on table "payment_events"` before the audit_no_mutate trigger is even reached, identical in effect to the bug fixed for the other three tables.
Business impact: any user who has ever generated a Stripe webhook event (subscription, one-time payment, refund, dispute, etc. — a large fraction of real users on a paid product) cannot have their account erased end-to-end today; `privacy.service.ts`'s deletion path will fail with a 500, same as the pre-20260813140000 behavior for the other tables.
Evidence:
```sql
-- supabase/migrations/20260705000000_sp1_payment_foundation.sql:19-47
create table if not exists public.payment_events (
  ...
  user_id            uuid references auth.users(id),
  ...
);
...
drop trigger if exists payment_events_no_update on public.payment_events;
create trigger payment_events_no_update
  before update on public.payment_events
  for each row execute function public.audit_no_mutate();
drop trigger if exists payment_events_no_delete on public.payment_events;
create trigger payment_events_no_delete
  before delete on public.payment_events
  for each row execute function public.audit_no_mutate();
```
```sql
-- supabase/migrations/20260813150000_audit_allow_link_anonymisation.sql:60-73
  link_columns constant text[] := array[
    'application_id',
    'actor_id',
    'document_id',
    'ocr_run_id',
    'submission_session_id',
    'consultant_id',
    'run_id',
    'user_id'          -- <- already anticipates payment_events.user_id
  ];
```
Root cause: the Aug 13 fix covered the tables that had actually been hit in production testing (per the migration's "FOUND IN PRODUCTION 2026-08-13" framing) but `payment_events` was not exercised by that same test, so its identical FK shape was missed.
Remediation:
```sql
alter table public.payment_events
  drop constraint payment_events_user_id_fkey;
alter table public.payment_events
  add constraint payment_events_user_id_fkey
  foreign key (user_id) references auth.users(id)
  on delete set null;
```
(No RLS-visibility concern here — `payment_events` already has no user-owned SELECT policy, admin-only, so a nulled `user_id` doesn't change any access-control surface, unlike `audit_events`/`evidence_packages` where the comment notes the owner-resolution subquery.)
Suggested regression test: extend whatever test proved the original bug (referenced as "MEASURED: it fails with 'Database error deleting user' (500)") to a synthetic user with a `payment_events` row, and assert deletion succeeds with `user_id` nulled afterward.
Confidence: CONFIRMED

---

## 10. Encryption at rest / secrets / credentials

- **Non-recoverable secrets are hashed, not stored plaintext:** `partner_api_keys.key_hash`/`partner_access_tokens.token_hash`/`partner_authorization_codes.code_hash` are all documented and structured as SHA-256 hashes (`20260806000000_partner_api_platform.sql:16-19, 90-100, 123-135, 144-156`).
- **Recoverable secrets (webhook signing) are encrypted, not hashed:** `partner_webhook_endpoints.secret_encrypted`/`previous_secret_encrypted` are documented as "AES-256-GCM ciphertext... via FieldCryptoService" (`20260806000000_partner_api_platform.sql:16-19, 213-218`). This audit did not review `FieldCryptoService`'s implementation (out of scope — application code, not schema/RLS; flagged as **UNVERIFIED** whether the key-management for that encryption is itself sound, since that lives outside `supabase/migrations/`).
- **No committed connection strings or plaintext credentials:** exhaustive grep for `postgres://user:pass@` and `password = '...'` patterns across all migrations and every `.env.example` in the repo returned zero non-placeholder matches.
- **Backups:** not visible in this repository (infra-level, not schema). The report header's caveat (BLK-1: "production has no backup") is taken directly from two migrations' own text (`20260809120000_revoke_unused_dml_grants.sql:25-27`, and referenced again in `20260809140000_hoist_rls_auth_calls.sql:34`) — this is the codebase's own documented statement, not an inference, but this audit cannot independently verify current backup status (out of scope, no infra/production access). **UNVERIFIED / high-priority operational gap if still true.**
- **Column-level encryption at rest for applicant PII** (passport numbers, DOB, etc., if stored in `application_profiles`/`documents`): not evidenced in the schema — these appear to rely on Postgres's disk-level encryption (platform-dependent, not visible in migrations) rather than application-level column encryption, unlike the webhook-secret column. **UNVERIFIED** whether the underlying self-hosted Postgres volume is encrypted at rest (infra-level, out of scope for a `supabase/migrations/` review).

---

## 11. Process/coverage finding

### SEC-4010
Title: `audit_no_mutate()` was redefined after the org-wide `search_path` hardening sweep and has no pin
Severity: LOW
Affected component: `public.audit_no_mutate()` trigger function
Affected profile(s): none directly exploitable
Affected page/API: n/a (trigger-only, not RPC-reachable)
Description: The Aug 6 hardening migration (`20260806100000_security_audit_db_hardening.sql`) pins `search_path` on every `public` function that lacked one, as a one-time dynamic sweep — it does not run again on later migrations. `audit_no_mutate()` was subsequently `CREATE OR REPLACE`d by `20260813150000_audit_allow_link_anonymisation.sql:55-104` with no `SET search_path` clause. Because it is not `SECURITY DEFINER` (confirmed: `language plpgsql as $$ ... $$;`, no `security definer` keyword) and is only ever invoked as a `BEFORE UPDATE/DELETE` trigger (not directly RPC-callable — same trigger-pseudo-type protection noted in §3/§4), the actual exploitability is effectively nil: there is no attacker-controlled search_path to hijack an invoker-rights function reached only via a trigger fired by whatever role already had UPDATE/DELETE rights. Flagged only because it breaks the project's own stated invariant ("Applied to ALL functions, not only SECURITY DEFINER ones") and there is no lint (unlike the `security_invoker` view check in §8) preventing this class of regression.
Evidence:
```sql
-- supabase/migrations/20260813150000_audit_allow_link_anonymisation.sql:55-58
create or replace function public.audit_no_mutate()
returns trigger
language plpgsql
as $$
```
Root cause: no CI lint equivalent to the view `security_invoker` check exists for function `search_path` pinning, so a later migration can silently regress the invariant the Aug 6 hardening established.
Remediation:
```sql
create or replace function public.audit_no_mutate()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
... (unchanged body)
$$;
```
And add a CI check mirroring the pattern in §8 (`v_client_dml_grants_without_policy`-style view) that asserts every `public` function has a non-null `search_path` in `pg_proc.proconfig`, so this class of regression is caught automatically going forward — this would also have caught SEC-4001–4008's REVOKE gap if the same lint were extended to also assert every SECURITY DEFINER function is revoked from PUBLIC unless explicitly allowlisted.
Suggested regression test: `select proconfig from pg_proc where proname = 'audit_no_mutate'` is non-null and contains `search_path=`.
Confidence: CONFIRMED

### SEC-4011
Title: 34 tables carry RLS-enabled-with-zero-policies; correct by design but undocumented as a class, and one instance (this audit found two: `notification_outbox`, `audit_events`/`field_provenance` families reachable via SEC-4001-4003) shows the "service-role only" assumption is only as strong as "no SECURITY DEFINER function was ever left unrevoked"
Severity: INFO
Affected component: schema-wide pattern
Description: See §1. Individually verified all 34 are intentional (comments consistently state "service-role only" / "no public policy"). This is called out per the audit brief's instruction that "a table with RLS enabled but ZERO policies... is a finding," and because SEC-4001/SEC-4002/SEC-4003 demonstrate concretely that the zero-policy-deny-all guarantee for `audit_events`-adjacent and `notification_outbox` tables is **only as strong as the RPC-grant hygiene in §3** — the table-level control is correct, but it was silently bypassed at the function layer for three of these tables.
Remediation: after applying the REVOKEs in §3, add the lint suggested in SEC-4010 (every SECURITY DEFINER function must be either revoked-from-PUBLIC or on an explicit allowlist with a comment justifying client exposure) so this class of table can be trusted going forward without re-auditing every RPC by hand.
Confidence: CONFIRMED (count and per-table verification), remediation is a recommendation.

### SEC-4012
Title: Two defense-in-depth migrations exist in the repository but self-report as not yet applied to production; live production RLS-performance and grant-hygiene state is unverified by this audit
Severity: INFO
Affected component: `20260809120000_revoke_unused_dml_grants.sql`, `20260809140000_hoist_rls_auth_calls.sql`
Description: Both migrations' own headers state "NOT YET APPLIED TO PRODUCTION. Blocked on BLK-1 — no backup exists there." This audit evaluated the **migration files** (the intended end state), consistent with its read-only, no-production-connection mandate. If these two have still not been applied by the time this report is read, note that: (a) the DB-003 revoke-unused-grants fix (removing dead INSERT/UPDATE/DELETE grants on 84 of 137 tables) has not shipped, meaning those tables still carry surplus (unreachable-by-any-policy, so not independently exploitable, but present) DML grants; (b) the PERF-004 hoist-auth-calls fix (wrapping `auth.uid()`/`auth.jwt()` in `(select ...)` across 113 policies) has not shipped, meaning production RLS policies re-evaluate `auth.uid()` per-row rather than once per statement — a performance, not security, concern, but the migration's own measurement (495ms → 3.7ms) suggests this is materially affecting query latency on `applications` and its joins today.
Remediation: resolve BLK-1 (establish a verified backup/restore procedure for the self-hosted production Postgres) and apply both migrations.
Confidence: UNVERIFIED whether still true — this is a direct quote of the migration authors' own stated status as of authorship, not independently confirmed against production by this audit.

---

## Summary

- **135** tables audited; **135/135 (100%)** have RLS enabled; **0** tables reachable via anon/authenticated with no RLS.
- **34** tables have RLS enabled with zero policies — individually verified as intentional service-role-only design, **except** that three of them (`audit_events`'s and `field_provenance`'s write path, and `notification_outbox` directly) are reachable anyway through an unrevoked SECURITY DEFINER RPC (SEC-4001, SEC-4002, SEC-4003).
- **Storage buckets:** all 4 declared buckets are private with correct path-scoped or service-role-only access; no public bucket found in the migration set (dashboard-created buckets outside migrations are out of scope/unverifiable).
- **Service-role key:** not reachable from any client bundle (`apps/web`, `apps/mobile`, `apps/extension` all clean); server-side usage follows a documented `admin` vs `forUser` split, sampled call sites all ownership-filtered.
- **Findings by severity:** CRITICAL 3, HIGH 3, MEDIUM 3, LOW 1, INFO 3 — total 13 (12 SEC-4001–4012 findings; SEC-4008 covers a 4-function family as one finding).

**CRITICAL:**
- SEC-4001 — `audit_append()` unrevoked SECURITY DEFINER RPC forges the immutable audit/compliance trail
- SEC-4002 — `field_provenance_create_version()` unrevoked SECURITY DEFINER RPC forges document-verification evidence
- SEC-4003 — `claim_outbox_batch()` unrevoked SECURITY DEFINER RPC discloses cross-tenant PII and disrupts notification delivery

**HIGH:**
- SEC-4004 — `bump_delivery_attempt()` unrevoked SECURITY DEFINER RPC allows arbitrary tampering with delivery records
- SEC-4005 — `consume_review_credit()` unrevoked SECURITY DEFINER RPC trusts caller-supplied `p_user_id`, lets anyone deplete another user's paid credits
- SEC-4006 — `consultations` UPDATE policy `WITH CHECK (true)` allows meeting-hijack / cross-tenant reassignment

Full detail, evidence, and remediation SQL for every finding is in the numbered
sections above.
