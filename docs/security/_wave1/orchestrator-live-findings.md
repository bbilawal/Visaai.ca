# Orchestrator — live-verified findings (DAST against local Supabase stack)

These were reproduced with a working exploit against a disposable local copy of
the production schema (143 tables, all migrations applied). Not static-analysis
guesses — the UPDATE succeeded and the row changed. Block SEC-40xx (co-located
with DB agent's SEC-4xxx; deconflicted by sub-range 4090+).

### SEC-4090
Title: Consultant can self-approve KYC / license / payouts and hijack payout account via RLS (direct PostgREST)
Severity: CRITICAL
Affected component: DB RLS — `consultant_profiles_owner_write`
Affected profile(s): consultant (any authenticated user who owns a consultant_profiles row)
Affected page/API: PostgREST `PATCH /rest/v1/consultant_profiles` with the user's own JWT (NEXT_PUBLIC_SUPABASE_URL + anon key are in the browser)
Description: Policy `consultant_profiles_owner_write` is `FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id)`. It grants the row owner write to EVERY column, including trust/verification/payout columns the application never exposes: `kyc_status`, `license_verified`, `payouts_enabled`, `rating_avg`, `rating_count`, `stripe_connect_account_id`, `active_status`. The Supabase client with the user's JWT can call PostgREST directly, bypassing the API's column allowlist.
Attack scenario: Consultant Mallory sends `PATCH /rest/v1/consultant_profiles?user_id=eq.<self>` `{kyc_status:"verified",license_verified:true,payouts_enabled:true,rating_avg:5,rating_count:999,stripe_connect_account_id:"acct_ATTACKER",active_status:"active"}`. All fields update.
Business impact: Fake "verified/licensed" immigration consultants appear in the marketplace with a perfect fabricated rating; payouts routed to an attacker-controlled Connect account. Direct fraud + user-safety harm (unlicensed advice to immigrants).
Evidence: live exploit — before `kyc_status=pending, license_verified=f, payouts_enabled=f, rating=0, acct=(null), active_status=draft`; after `verified, t, t, 5.00/999, acct_ATTACKER_CONTROLLED, active`. UPDATE 1 under `set role authenticated; request.jwt.claims sub=<owner>`.
Root cause: `FOR ALL` owner policy with no column restriction on a table mixing user-editable and system-controlled columns.
Remediation: Split the policy. Owner may only write the profile-content columns (headline, bio, specialization, years_experience, hourly_rate_usd, license_* as *unverified submissions*). Move `kyc_status`, `license_verified`, `payouts_enabled`, `rating_avg`, `rating_count`, `stripe_connect_account_id`, `active_status` to admin/service-role-only writes (either a `WITH CHECK` that pins those columns via a trigger, or column-level `GRANT`/`REVOKE` + a BEFORE UPDATE trigger that rejects owner changes to protected columns).
Suggested regression test: SQL test asserting `set role authenticated` + owner claims → UPDATE of `kyc_status/payouts_enabled/stripe_connect_account_id/rating_avg` affects 0 rows / raises.
Confidence: CONFIRMED (live exploit)

### SEC-4091
Title: Consultation participant can rewrite ownership, target application, and meeting URL via RLS
Severity: CRITICAL
Affected component: DB RLS — `consultations_participant_write`
Affected profile(s): consultant or applicant participant of any consultation
Affected page/API: PostgREST `PATCH /rest/v1/consultations`
Description: Policy `consultations_participant_write` is `FOR UPDATE USING (<is participant>) WITH CHECK (true)`. The `WITH CHECK (true)` lets a participant set ANY column to ANY value, including `user_id`, `application_id`, `meeting_url`, `status`.
Attack scenario: Mallory (consultant on consultation C for Alice's app) sends `PATCH /rest/v1/consultations?id=eq.C` `{user_id:"<Bob>", application_id:"<Bob's app>", meeting_url:"https://attacker/phish", status:"completed"}`. She reassigns the consultation onto a victim's application and injects a phishing meeting link the victim will be shown.
Business impact: Cross-tenant data corruption, phishing-link injection into a trusted UI, billing/records integrity loss, forced "completed" status (may trigger payout/commission).
Evidence: live exploit — before `user_id=Alice, application_id=Alice-app, status=confirmed, url=(null)`; after `user_id=Bob, application_id=Bob-app, status=completed, url=https://attacker.example/phish`. UPDATE 1.
Root cause: `WITH CHECK (true)` on a participant UPDATE policy.
Remediation: Replace `WITH CHECK (true)` with the same participant predicate as USING, AND freeze immutable columns (`user_id`, `consultant_id`, `application_id`, `service_order_id`) via a BEFORE UPDATE trigger or by narrowing the writable columns. Validate `meeting_url` against an allowlist of trusted providers server-side.
Suggested regression test: SQL test asserting a participant cannot change `user_id`/`application_id` and cannot set an off-allowlist `meeting_url`.
Confidence: CONFIRMED (live exploit)

### SEC-4092
Title: Internal pricing margin/COGS readable by anonymous role
Severity: MEDIUM
Affected component: DB RLS — `pricing_quotes.quotes_read`, plus `pricing_constants`, `pricing_country_factors`, `pricing_visa_tiers`
Affected profile(s): anonymous (anon key only, no login)
Affected page/API: PostgREST `GET /rest/v1/pricing_quotes` with anon key
Description: `quotes_read` is `FOR SELECT TO public USING (true)`. `pricing_quotes` exposes `recommended_price, floor_price, ceiling_price, gross_margin, total_cogs, breakdown`. Anyone with the public anon key (shipped in the browser bundle) can read the company's cost structure and margins.
Attack scenario: `curl $SUPABASE_URL/rest/v1/pricing_quotes -H "apikey: <anon>"` returns margin and COGS for every quote.
Business impact: Competitive/commercial exposure of pricing strategy and unit economics. Low security severity, real business-confidentiality issue.
Evidence: policy `quotes_read | SELECT | {public} | true`. (Local DB had 0 seeded quote rows, so the live count returned 0 — the policy grant itself is the exposure.)
Root cause: `USING (true)` public read on a table that is not reference data.
Remediation: Restrict `pricing_quotes` reads to authenticated owners / admins. Keep only genuinely public reference tables (visa tiers, country factors as *displayed* prices) public; do not expose `gross_margin`/`total_cogs` publicly at all — strip those columns from any public-facing view.
Suggested regression test: assert `set role anon` cannot select `gross_margin`/`total_cogs`.
Confidence: CONFIRMED (policy inspected; exposure is the grant)

### SEC-4093
Title: RLS infinite recursion between `applications` and `consultant_assignments` policies (fragile security + availability)
Severity: MEDIUM
Affected component: DB RLS — `applications_owner_consultant_admin_update/select` ↔ `consultant_assignments_owner_read`
Affected profile(s): any authenticated user writing `applications` via their own JWT (direct PostgREST / web server-component path)
Affected page/API: PostgREST `PATCH /rest/v1/applications`
Description: `applications` policies reference `consultant_assignments` (via `is_active_assignee`/`app_has_active_consultant`), and `consultant_assignments_owner_read` does a plain (non-SECURITY-DEFINER) sub-select `select user_id from applications where id=...`. Evaluating one triggers the other, and Postgres raises `infinite recursion detected in policy for relation "applications"`.
Attack scenario: Two-sided. (a) Availability: legitimate user-JWT updates to `applications` error out. (b) Security-fragility: this recursion is currently the ONLY thing preventing SEC-4094 (plan_tier self-escalation) — a "fix" to the recursion that doesn't also address SEC-4094 would silently open a paid-feature bypass.
Business impact: Broken user-scoped writes; a latent entitlement bypass masked by an error rather than a deny.
Evidence: live — `UPDATE public.applications ... ` under `set role authenticated` → `ERROR: infinite recursion detected in policy for relation "applications"`. Policy bodies quoted above.
Root cause: mutually-recursive RLS predicates using non-definer sub-selects.
Remediation: Make the `consultant_assignments` policy read `applications.user_id` through a `SECURITY DEFINER` helper (like the existing `is_active_assignee`) so it does not re-enter `applications` RLS; verify no cycle remains.
Suggested regression test: SQL test that a user-JWT `UPDATE applications SET status=...` on own row succeeds (no recursion) and cannot change `plan_tier`.
Confidence: CONFIRMED (live error)

### SEC-4094
Title: `applications.plan_tier` is owner-writable in principle → paid-tier (expert) entitlement bypass
Severity: HIGH
Affected component: DB RLS — `applications_own_rows` (FOR ALL, WITH CHECK defaults to USING) + `PlanGuard`/`EntitlementService`
Affected profile(s): any applicant
Affected page/API: PostgREST `PATCH /rest/v1/applications?id=eq.<own>`; entitlement consumed by `apps/api/src/modules/auth/plan.guard.ts:48` and `entitlement.service.ts:52`
Description: `PlanGuard` computes access as `effectiveRank = max(PLAN_RANK[applications.plan_tier], subscriptionFloor)`, and `applications.plan_tier` sits on a row the owner can write (the `applications_own_rows FOR ALL` policy permits owner writes to every column). Setting `plan_tier='expert'` yields rank 3 — a tier that subscriptions never grant — bypassing payment for consultant-review/expert features. It is NOT exploitable *today* only because SEC-4093's recursion aborts the UPDATE; that is an accident, not a control.
Attack scenario: applicant issues `PATCH /rest/v1/applications?id=eq.<own> {"plan_tier":"expert"}` with their own JWT (anon key + JWT both public). Once SEC-4093 is fixed without column-pinning, this succeeds and grants the highest paid tier for free.
Business impact: Revenue loss; unpaid access to expert/consultant-review features.
Evidence: `plan.guard.ts:44-62` selects `plan_tier` and ranks it; `entitlement.service.ts:52` `Math.max(appRank, subRank)`; `applications_own_rows | ALL | USING (auth.uid()=user_id)` with no column restriction.
Root cause: security-controlling column (`plan_tier`) co-located on an owner-writable row with no column-level protection.
Remediation: Pin `plan_tier` (and `vri_score`, `status`, `submitted_at`, `monitor_token`) as non-owner-writable via a BEFORE UPDATE trigger that rejects owner changes, OR move plan_tier out of RLS-writable scope. Entitlement must derive from a table the user cannot write (subscriptions/payments verified server-side), not from a self-writable column.
Suggested regression test: SQL test asserting owner cannot change `applications.plan_tier`; API test asserting PlanGuard denies when only self-set plan_tier is present.
Confidence: CONFIRMED (mechanism proven; live exploit currently masked by SEC-4093)

## Negative results (tested, NOT exploitable — documented so they are not re-flagged)
- Fabricated `payments` row: `payments` requires NOT NULL `application_id`; more importantly entitlement (`PlanGuard`/`EntitlementService`) never reads `payments`, so a self-inserted payment grants nothing.
- Self-inserted `subscriptions` row: **blocked** by RLS (`new row violates row-level security policy for table "subscriptions"`). Subscriptions are the trusted entitlement source and are correctly not owner-writable. Good.
- Anonymous read of `pricing_quotes`: policy allows it (SEC-4092) but no user-PII columns exist on that table; impact is commercial-confidential only.
