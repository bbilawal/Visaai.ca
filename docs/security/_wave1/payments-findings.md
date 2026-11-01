# VisaAI Payment / Billing / Entitlement / Money-Movement Security Audit

Scope: `apps/api/src/modules/{billing,billing-analytics,subscriptions,entitlement,pricing,discounts,commission,payouts,ledger,financial-ops,reconciliation,marketplace,consultant,consultations,partner}`, `apps/api/src/modules/shared/payments/**`, `scripts/stripe/**`, `supabase/migrations/**` (RLS is the real enforcement layer for every table these modules touch), and `apps/web` checkout/pricing/billing pages.

Method: static, read-only source review. No file was edited, no Stripe API was called, no live exploit was executed. All findings are derived from the code and SQL actually present in this repository at the reviewed commit. Every secret value shown below is redacted as `[REDACTED]`.

**Headline result:** the NestJS API layer (controllers, DTOs, services) that fronts Stripe is unusually well built — server-side price catalogs, webhook signature verification on the raw body, event-level idempotency, append-only ledger enforced by a DB trigger, admin-gated refunds/coupons/payouts, per-order Stripe idempotency keys, and consistent ownership checks. **The vulnerability is one layer down.** Three core tables (`applications`, `payments`, `consultant_profiles`) are protected by Postgres RLS policies of the form `FOR ALL USING (auth.uid() = user_id)` with **no `WITH CHECK` clause and no column-level restriction**. Because the web app's Supabase client (anon/publishable key + the user's own session JWT) talks to PostgREST directly — and already does so for ordinary reads on these exact tables — any authenticated user can write straight past every NestJS control (PlanGuard, Stripe, webhook verification, admin review) and self-grant plan tier, fabricate a completed payment, or self-approve their own marketplace/payout eligibility. This is answered in detail as SEC-9001/9002/9003 and directly resolves audit question 4.

---

## MONEY FLOW MAP

Every endpoint, webhook, or job that creates, moves, credits, refunds, or authorizes money (or the entitlement money buys), who can invoke it, and what actually verifies it.

| # | Surface | Action | Who can invoke | What verifies it |
|---|---|---|---|---|
| 1 | `POST /billing/checkout` | One-time plan checkout (self_service/copilot/expert) | Authenticated user, `payments_enabled` flag on | Price from server `PLAN_PRICES` catalog (`billing.service.ts:183`); `applicationId` ownership via `.eq('user_id', params.userId)` (`billing.service.ts:174-179`) |
| 2 | `POST /billing/checkout/prefill` | $29 AI-prefill checkout | Authenticated user | `PREFILL_PRICE` constant (`billing.service.ts:32-35`); app ownership check |
| 3 | `POST /billing/checkout/processing-fee` | Per-visa processing fee, optional coupon | Authenticated user | `PricingService.getCheckoutQuote()` server-computed + floor-gated (`billing.service.ts:307-312`); coupon validated server-side via `DiscountService.applyDiscount` |
| 4 | `POST /billing/checkout/addon` | Flat-priced add-on, optional coupon | Authenticated user | `ADDON_PRICES` catalog (`billing.service.ts:382-383`); coupon validated server-side |
| 5 | `POST /billing/checkout/service-order` | Marketplace consultant service purchase | Authenticated user | `SERVICE_PRICES` catalog (`billing.service.ts:513`); commission split computed server-side (`CommissionService.splitFor`); consultant must be `active_status='active'` |
| 6 | `POST /billing/portal` | Stripe customer billing portal session | Authenticated user | `customerId` resolved server-side from `users.stripe_customer_id`, never client-supplied (`billing.service.ts:78-101`) |
| 7 | `GET /billing/history` | Read own payments/add-ons/orders | Authenticated user | Filtered by `.eq('user_id', userId)` (`billing.service.ts:459-477`) |
| 8 | `POST /billing/webhook` | Stripe platform webhook: checkout, subscription, invoice, refund, dispute, payment.failed | Stripe only | HMAC verified via `constructEvent` against `STRIPE_WEBHOOK_SECRET` on the raw body (`stripe-payment.provider.ts:237-253`, `billing.controller.ts:175-183`); `event.id` deduped in append-only `payment_events` |
| 9 | `POST /billing/webhook/connect` | Stripe Connect webhook: `account.updated`, `transfer.reversed` | Stripe only | HMAC via `STRIPE_CONNECT_WEBHOOK_SECRET`, **falls back to `STRIPE_WEBHOOK_SECRET` when unset** (see SEC-9004) |
| 10 | `POST /subscriptions/checkout` | Subscription checkout | Authenticated user | Price resolved server-side from `SUBSCRIPTION_PRICES` catalog by `plan`+`interval` enum (`subscriptions.service.ts:31-38`) |
| 11 | `POST /subscriptions/{change,pause,resume,cancel}` | Mutate own subscription | Authenticated user | Operates only on `repo.getActiveByUser(userId)`-resolved subscription; no client-supplied subscription id (`subscriptions.service.ts:84-120`) |
| 12 | `POST /admin/coupons` | Create discount coupon | Admin only | `RolesGuard` + zod-validated positive percent/amount (`discounts.admin.controller.ts`) |
| 13 | `POST /admin/payments/:id/refund` | Issue refund | Admin only | `RolesGuard`; amount clamped to ≤ original payment; zod-validated positive integer (`financial-ops.controller.ts:22-52`, `refund.service.ts:43-45`) |
| 14 | `POST /admin/payouts/sweep` | Manually trigger the consultant payout sweep | Admin only | Per-order Stripe idempotency key `payout_item_<order_id>`; destination account read from DB, never request (`payouts-admin.controller.ts`, `payouts.service.ts:101-113`) |
| 15 | `payouts-sweep.scheduler` (cron) | Daily automated payout sweep | System only, no HTTP surface | Same engine as #14 |
| 16 | `GET /payouts/onboarding-link` | Mint/resume Stripe Connect Express account | Authenticated user with own consultant profile | Destination account id stored/read server-side only (`connect.service.ts:55-77`) |
| 17 | `GET /payouts/{earnings,history,status,dashboard-link}` | Read own payout state | Authenticated user | Filtered by caller's own `consultant_profiles` row |
| 18 | `POST /payouts/tax-profile` | Upsert own tax identity (W-9/W-8) | Authenticated user | Writes own consultant's tax profile only |
| 19 | `POST /admin/payouts/tax-statements/:year` | Generate 1099-equivalent statements | Admin only | `RolesGuard` |
| 20 | `POST/DELETE /admin/commission-rules` | Create/deactivate commission split rules | Admin only | `RolesGuard` |
| 21 | `PUT /pricing/admin/{constants,visa-tiers,country-factors}/...` | Mutate pricing config that drives all future quotes | Admin only | `RolesGuard` + zod |
| 22 | `POST/PATCH /marketplace/profile`, `PUT .../skills`, `PUT .../availability` | Consultant self-serve profile edit | Authenticated user (own profile) | Nest DTO excludes money/KYC/Stripe/rating fields — **but the underlying RLS policy does not** (SEC-9003) |
| 23 | Direct Supabase REST/JS-SDK `UPDATE public.applications` | Set `plan_tier` and any other column on own application | **Any authenticated end user** (the web app's own Supabase client) | RLS `applications_own_rows`: `FOR ALL USING (auth.uid() = user_id)`, no `WITH CHECK`, no column restriction — **effectively unrestricted** (SEC-9001) |
| 24 | Direct Supabase REST/JS-SDK `INSERT/UPDATE public.payments` | Fabricate a `status='complete'` payment row | **Any authenticated end user** | RLS `payments_own_rows`: same `FOR ALL`/no-`WITH CHECK` shape — **effectively unrestricted** (SEC-9002) |
| 25 | Direct Supabase REST/JS-SDK `UPDATE public.consultant_profiles` | Set `active_status`, `kyc_status`, `payouts_enabled`, `stripe_connect_account_id` on own profile | **Any authenticated consultant** | RLS `consultant_profiles_owner_write`: same shape — **effectively unrestricted** (SEC-9003) |
| 26 | `POST /consultant/applications/:id/{approve,reject}` → `PlanReviewPayoutService.creditExpertReview` | Credits assigned consultant for an Expert-plan review (marketplace order, no separate Stripe charge) | Consultant role + must be the **active assignee** | `ConsultantApprovalService.assertAssigned()` runs before `record()` (`consultant-approval.service.ts:87-103, 273`); idempotent per application+consultant |
| 27 | Webhook → `RefundService.onRefundCreated` | Marks payment refunded; reverses consultant transfer for marketplace orders | Stripe only | Same signature+dedup gate as #8 |
| 28 | Webhook → `PayoutsService.handleTransferReversed` | Requeues affected orders for re-sweep | Stripe Connect webhook only | Same signature+dedup gate as #9 |

Row count: **28**.

---

## Findings

### SEC-9001
Title: `applications` table RLS lets any user self-grant `plan_tier` (full paywall bypass), independent of Stripe/PlanGuard
Severity: CRITICAL
Affected component: Database RLS (`public.applications`), consumed by `apps/api/src/modules/auth/plan.guard.ts` and `apps/api/src/modules/entitlement/entitlement.service.ts`
Affected profile(s): Any authenticated end user (applicant)
Affected page/API: Not an API endpoint — the Supabase PostgREST/JS-SDK interface every browser client already holds
Description: `applications.plan_tier` is the value `PlanGuard` reads to decide whether a caller may use plan-gated features (`narrative` generation, `vri` copilot scoring, etc. — see `RequirePlan` usages). The only intended writer is `BillingService.recordCheckoutCompleted()`, invoked exclusively from the Stripe-webhook path after signature verification (`billing.service.ts:781-787`). However, the table's Row-Level Security policy grants the owning user unrestricted write access:
```sql
-- supabase/migrations/20260531000000_initial_schema.sql:43
create policy "applications_own_rows" on public.applications for all using (auth.uid() = user_id);
```
Re-affirmed (not fixed) in a later RLS-performance pass that specifically touched this policy:
```sql
-- supabase/migrations/20260809140000_hoist_rls_auth_calls.sql:105-110
drop policy if exists "applications_own_rows" on public."applications";
create policy "applications_own_rows" on public."applications"
  as permissive
  for all
  to public
  using (((select auth.uid()) = user_id));
```
`FOR ALL` covers `SELECT`/`INSERT`/`UPDATE`/`DELETE`. Per PostgreSQL semantics, a policy that omits `WITH CHECK` reuses its `USING` clause for the check on `INSERT`/`UPDATE` — so any row where `auth.uid() = user_id` is fully writable, on **every column**, including `plan_tier`. A narrower `applications_owner_consultant_admin_update` policy also exists (`20260809140000_hoist_rls_auth_calls.sql:119-123`), but Postgres RLS policies for the same command are combined with `OR`; the broad `applications_own_rows` policy alone is sufficient to authorize the write regardless of the narrower one.

The web app's browser-side Supabase client is the exact tool needed to exploit this — it already performs direct table reads against `applications` from client components:
```ts
// apps/web/app/[locale]/(dashboard)/billing/page.tsx:64-67
const { data } = await supabase
  .from('applications')
  .select('id, status, created_at')
  .order('created_at', { ascending: false })
```
The same `supabase` client object (built from the public anon key + the user's own session, `apps/web/lib/supabase/client.ts`) can call `.update()` instead of `.select()`.
Attack scenario: A logged-in applicant opens browser devtools on any dashboard page (or issues a `curl` with their own session JWT + the public anon key) and runs:
```js
await supabase.from('applications').update({ plan_tier: 'expert' }).eq('id', myApplicationId)
```
This instantly satisfies `PlanGuard`/`EntitlementService.effectiveRank()` for the `expert` tier (the platform's $250 top tier) on that application — no Stripe charge, no webhook, $0 paid. Every `@RequirePlan`-gated route on that application (narrative/LOE AI drafting, VRI copilot scoring, and any future plan-gated feature) is now unlocked for free, and the platform incurs real OpenAI/compute cost per generation with zero matching revenue.
Business impact: Complete bypass of the platform's core paywall (the "AI-powered immigration application copilot" the product is sold as) for every application any user owns. Also a COGS-abuse vector — plan-gated AI generation calls out to OpenAI per invocation.
Evidence: `supabase/migrations/20260531000000_initial_schema.sql:43`; `supabase/migrations/20260809140000_hoist_rls_auth_calls.sql:105-110, 119-123`; `apps/api/src/modules/auth/plan.guard.ts:44-64` (reads `applications.plan_tier` to authorize); `apps/api/src/modules/billing/billing.service.ts:781-787` (the only intended writer, admin/service-role client, webhook-only); `apps/web/lib/supabase/client.ts:1-2`; `apps/web/app/[locale]/(dashboard)/billing/page.tsx:64-67`.
Root cause: RLS enforcement is row-scoped only (`auth.uid() = user_id`); no `WITH CHECK` expression and no column-level `GRANT`/`REVOKE` restrict which columns an owning user may write. The application layer's payment/entitlement discipline (server-side price catalogs, webhook-only writes) is real but is bypassed entirely by the database's own public REST interface, which every browser client is, by Supabase's design, already authenticated against.
Remediation:
1. Split `applications_own_rows` into narrow, command-specific policies. Keep `FOR SELECT` broad (owner/consultant/admin as already partially done), but replace the `FOR ALL` owner-write policy with an explicit `FOR UPDATE ... WITH CHECK` that excludes trust columns, e.g. via a trigger (`BEFORE UPDATE`) that raises unless `plan_tier IS NOT DISTINCT FROM OLD.plan_tier` for non-admin/non-service-role callers, mirroring the `audit_no_mutate()` pattern already used for `payment_events`.
2. Alternatively (defense in depth, do both): `REVOKE UPDATE (plan_tier) ON public.applications FROM authenticated;` and grant that column only to the `service_role`.
3. Add a regression test that authenticates as a normal user via the anon key + a real session and asserts `UPDATE applications SET plan_tier = 'expert'` is rejected by Postgres, not just that the NestJS API doesn't expose a route for it.
Suggested regression test: Supabase pgTAP or a Node test using `@supabase/supabase-js` with a real user JWT — attempt `supabase.from('applications').update({plan_tier:'expert'}).eq('id', ownAppId)` and assert it fails (RLS violation), and that `plan_tier` is unchanged after the call.
Confidence: CONFIRMED

---

### SEC-9002
Title: `payments` table RLS lets any user fabricate a `status='complete'` payment row, bypassing Stripe and unlocking the one-time form fee for $0
Severity: CRITICAL
Affected component: Database RLS (`public.payments`), consumed by `apps/api/src/modules/prefill/prefill.service.ts` and `apps/api/src/modules/automation/automation.service.ts`
Affected profile(s): Any authenticated end user
Affected page/API: Not an API endpoint — direct Supabase PostgREST/JS-SDK access
Description: The one-time "form fee" paywall — which gates downloading the AI-prefilled PDF and unlocking Chrome-extension portal auto-fill — is enforced entirely by checking for a matching row in `payments`:
```ts
// apps/api/src/modules/prefill/prefill.service.ts:269-278
async hasPaid(db: SupabaseClient, applicationId: string): Promise<boolean> {
  const { data } = await db
    .from('payments')
    .select('id')
    .eq('application_id', applicationId)
    .eq('feature', 'prefill')
    .eq('status', 'complete')
    .limit(1);
  return (data?.length ?? 0) > 0;
}
```
```ts
// apps/api/src/modules/prefill/prefill.service.ts:110-121
private async requirePaid(db: SupabaseClient, applicationId: string): Promise<void> {
  if (!(await this.hasPaid(db, applicationId))) {
    throw new HttpException('Pay the one-time form fee to download or submit this application', HttpStatus.PAYMENT_REQUIRED);
  }
}
```
called from `getPdf`/`getOfficialPdf` (lines 177, 191), and mirrored in `automation.service.ts:248-254` (`hasPaidPrefill`, gating `POST /automation/:applicationId/session` at line 104). The only intended writer of a `complete` `payments` row is `BillingService.recordCheckoutCompleted()`, called exclusively from the verified Stripe webhook. But `payments` carries the identical unrestricted RLS shape as `applications`:
```sql
-- supabase/migrations/20260531000000_initial_schema.sql:227-237
create table public.payments ( ... status text not null default 'pending' check (status in ('pending','complete','failed','refunded')), ... );
alter table public.payments enable row level security;
create policy "payments_own_rows" on public.payments for all using (auth.uid() = user_id);
```
Re-affirmed identically in the RLS-performance migration:
```sql
-- supabase/migrations/20260809140000_hoist_rls_auth_calls.sql:785-790
drop policy if exists "payments_own_rows" on public."payments";
create policy "payments_own_rows" on public."payments"
  as permissive
  for all
  to public
  using (((select auth.uid()) = user_id));
```
Attack scenario: A user calls (via the same browser Supabase client the app already loads, or any HTTP client with their own session JWT + the public anon key):
```js
await supabase.from('payments').insert({
  user_id: myUserId, application_id: myApplicationId,
  feature: 'prefill', status: 'complete', amount_cents: 0, currency: 'usd', provider: 'stripe'
})
```
`hasPaid()`/`hasPaidPrefill()` now return `true` for that application. The user downloads the prefilled PDF and triggers Chrome-extension portal auto-fill (`POST /automation/:applicationId/session`) — the $29 fee is never charged. The same technique fabricates rows for `feature='addon'` or `feature='processing_fee'` that show up in the user's own `GET /billing/history`.
Business impact: Direct, zero-cost bypass of every one-time paid feature gated by a `payments` row check, with no Stripe transaction ever occurring.
Evidence: `supabase/migrations/20260531000000_initial_schema.sql:227-237`; `supabase/migrations/20260809140000_hoist_rls_auth_calls.sql:785-790`; `apps/api/src/modules/prefill/prefill.service.ts:110-121, 177, 191, 269-278`; `apps/api/src/modules/automation/automation.service.ts:102-109, 248-254`.
Root cause: Same as SEC-9001 — `FOR ALL USING (...)` with no `WITH CHECK` and no column-level grant restriction, on a table whose only legitimate writer should be the service-role webhook path.
Remediation:
1. Replace `payments_own_rows` with `FOR SELECT USING (auth.uid() = user_id)` only. There is no legitimate product reason for a client to `INSERT`/`UPDATE`/`DELETE` this table directly — every write already goes through `BillingService` using the `admin` (service-role) client, which bypasses RLS entirely and needs no policy.
2. Add the same `audit_no_mutate()`-style immutability trigger already used on `payment_events` to `payments`, or at minimum a `BEFORE UPDATE`/`BEFORE INSERT` trigger that rejects writes from non-`service_role`.
3. Regression-test as in SEC-9001, targeting `payments`.
Suggested regression test: Authenticate as a real user via `@supabase/supabase-js`, attempt `INSERT`/`UPDATE` on `payments` for a row with that user's `user_id`, assert RLS rejects it; assert `prefill.hasPaid()` still returns `false` afterward.
Confidence: CONFIRMED

---

### SEC-9003
Title: `consultant_profiles` RLS lets a consultant self-approve marketplace listing and self-grant KYC/payout eligibility, contradicting the app's own "never trust the client" design
Severity: HIGH
Affected component: Database RLS (`public.consultant_profiles`), consumed by `apps/api/src/modules/payouts/connect.service.ts`, `apps/api/src/modules/payouts/payouts.engine.ts`, `apps/api/src/modules/marketplace/marketplace-admin.controller.ts`
Affected profile(s): Any authenticated user who has created a consultant profile (self-serve, no approval required to create one at `draft`/`pending_review`)
Affected page/API: Not an API endpoint — direct Supabase PostgREST/JS-SDK access
Description: `consultant_profiles` mixes self-serve fields (headline, bio, hourly rate) with trust/financial fields that the code explicitly documents as system-managed only:
```sql
-- supabase/migrations/20260626000000_consultant_marketplace.sql:33-56 (table)
active_status   text not null default 'draft' check (active_status in ('draft','pending_review','active','suspended')),
kyc_status      text not null default 'none' check (kyc_status in ('none','pending','verified','rejected')),
stripe_connect_account_id text unique,
payouts_enabled boolean not null default false,
```
```ts
// apps/api/src/modules/marketplace/marketplace.dto.ts:8-14
// Money/KYC/Stripe/rating columns are NEVER accepted from the client: those are
// system-managed (commission webhook, Stripe Connect sync, rating rollup
// trigger). `active_status` is restricted to the two self-serve transitions —
// 'active'/'suspended' are admin-only and intentionally not in the enum.
```
```ts
// apps/api/src/modules/payouts/connect.service.ts:36-38
* Stripe. KYC documents live in Stripe; we persist only status, and only from
* the webhook (never the client).
```
That intent is enforced at the NestJS DTO layer (`profileFields` in `marketplace.dto.ts` excludes these columns) but the RLS policy governing the same table is row-scoped only, with no column restriction:
```sql
-- supabase/migrations/20260626000000_consultant_marketplace.sql:222-223
create policy consultant_profiles_owner_write on public.consultant_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
(This one does carry an explicit `WITH CHECK`, but it is identical to `USING` — `auth.uid() = user_id` — so it restricts nothing beyond row ownership.)
Attack scenario: A user signs up as a consultant (self-serve `draft` profile, no admin action required). Via the browser's own Supabase client:
```js
await supabase.from('consultant_profiles').update({
  active_status: 'active', kyc_status: 'verified', license_verified: true
}).eq('user_id', myUserId)
```
The consultant now appears live in the public marketplace (`consultant_profiles_public_read` shows any `active_status='active'` row to everyone) with a fraudulent "verified" KYC/license badge, without ever passing `MarketplaceAdminController`'s admin review queue (`admin/marketplace/consultants/:id/status`). Separately, `GET /payouts/onboarding-link` creates a real (but not necessarily KYC-completed) Stripe Express account and stores its id; the same direct write can set `payouts_enabled: true` on that row. `PayoutsService.sweep()` groups orders by `consultant_profiles(stripe_connect_account_id, payouts_enabled)` (`payouts.repository.impl.ts:101-137`) and will attempt a transfer to that account for any real, paid service order this consultant fulfills — with `payouts_enabled` no longer meaning what the code's own comment says it means ("we only move money once the consultant can actually withdraw it" — `payouts.engine.ts:44-49`). Stripe's own transfers-capability check on the connected account is a remaining backstop for whether money actually moves, but the platform's documented stricter-than-Stripe policy is fully defeated at the DB layer, and the identity-fraud vector (fake `active_status`/`kyc_status`/`license_verified` on an immigration-consulting marketplace) requires no Stripe involvement at all.
Business impact: Bypasses the admin vetting gate for a marketplace of immigration consultants (regulatory/reputational risk — the profile fields include `license_number`/`license_authority`/`license_verified`), and weakens the payout-eligibility control down to whatever Stripe itself still enforces.
Evidence: `supabase/migrations/20260626000000_consultant_marketplace.sql:33-56, 220-225`; `apps/api/src/modules/marketplace/marketplace.dto.ts:8-14, 17-33`; `apps/api/src/modules/payouts/connect.service.ts:34-38`; `apps/api/src/modules/payouts/payouts.engine.ts:44-49`; `apps/api/src/modules/payouts/payouts.repository.impl.ts:101-137`.
Root cause: Same class of gap as SEC-9001/9002 — a single `for all`/row-only RLS policy governs a table whose columns have mixed trust levels; no column-level separation between owner-writable and system-only fields at the database layer.
Remediation:
1. Split `consultant_profiles_owner_write` into a genuinely restricted policy: either (a) move `active_status`(admin transitions)/`kyc_status`/`payouts_enabled`/`stripe_connect_account_id`/`license_verified`/`rating_avg`/`rating_count` into a separate `consultant_trust` table writable only by `service_role`, joined 1:1 to `consultant_profiles`; or (b) add a `BEFORE UPDATE` trigger on `consultant_profiles` that, for non-service-role callers, raises unless those specific columns are unchanged (`NEW.x IS NOT DISTINCT FROM OLD.x`).
2. Column-level `REVOKE UPDATE (active_status, kyc_status, payouts_enabled, stripe_connect_account_id, license_verified, rating_avg, rating_count) ON public.consultant_profiles FROM authenticated;` as defense in depth.
Suggested regression test: As a real consultant user, attempt to set `payouts_enabled=true`/`kyc_status='verified'`/`active_status='active'` directly via the Supabase client; assert rejection and that `sweep()` never selects that consultant.
Confidence: CONFIRMED

---

### SEC-9004
Title: Connect webhook signing secret silently falls back to the platform secret when unset
Severity: LOW
Affected component: `apps/api/src/modules/shared/payments/stripe/stripe-payment.provider.ts`
Affected profile(s): N/A (operator/deployment configuration)
Affected page/API: `POST /billing/webhook/connect`
Description: The task description's stated expectation ("confirm each verifies with its OWN secret") is not fully met — the connect endpoint's secret has a code-level fallback to the platform secret:
```ts
// apps/api/src/modules/shared/payments/stripe/stripe-payment.provider.ts:242-246
const secret =
  kind === 'connect'
    ? (this.config.get('STRIPE_CONNECT_WEBHOOK_SECRET', { infer: true }) ??
      this.config.getOrThrow('STRIPE_WEBHOOK_SECRET', { infer: true }))
    : this.config.getOrThrow('STRIPE_WEBHOOK_SECRET', { infer: true });
```
The `.env.example` documents this as intentional but fragile:
```
# .env.example:100-103
# Falls back to STRIPE_WEBHOOK_SECRET when unset, which is
# only correct if both Stripe endpoints point at the same URL.
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
```
Attack scenario: This is not independently exploitable — Stripe signs each endpoint's deliveries with that endpoint's own configured secret in the Stripe Dashboard, so if `STRIPE_CONNECT_WEBHOOK_SECRET` is left unset while the two endpoints have distinct secrets configured in Stripe, genuine `account.updated`/`transfer.reversed` deliveries simply fail signature verification (denial of service on Connect state sync, not a bypass). The risk is purely a misconfiguration trap: if an operator ever points both Stripe endpoints at the same signing secret to "make the fallback work," the two endpoints become interchangeable for signature-verification purposes (the dedup-by-`event.id` ledger still prevents any double-processing either way).
Business impact: Low — worst case is silent Connect-state desync (stale `kyc_status`/`payouts_enabled`) if the fallback is ever relied upon, not a financial bypass.
Evidence: `apps/api/src/modules/shared/payments/stripe/stripe-payment.provider.ts:242-253`; `.env.example:95-103`.
Root cause: Convenience fallback for single-endpoint deployments, left in for the multi-endpoint production case.
Remediation: In production (`NODE_ENV=production` or equivalent), require `STRIPE_CONNECT_WEBHOOK_SECRET` explicitly and throw at boot if unset, rather than silently reusing the platform secret.
Suggested regression test: Boot the app with `STRIPE_CONNECT_WEBHOOK_SECRET` unset and `NODE_ENV=production`; assert startup fails fast instead of falling back.
Confidence: CONFIRMED (code + config as described); business impact assessment is PLAUSIBLE reasoning about deployment behavior, not observed in a live environment.

---

### SEC-9005
Title: Coupon `max_redemptions` can be exceeded under concurrent checkout (TOCTOU)
Severity: MEDIUM
Affected component: `apps/api/src/modules/discounts/discount.service.ts`, `apps/api/src/modules/billing/billing.service.ts`
Affected profile(s): Any authenticated user with a valid coupon code
Affected page/API: `POST /billing/checkout/processing-fee`, `POST /billing/checkout/addon`
Description: Coupon capacity is checked once, at checkout-session creation:
```ts
// apps/api/src/modules/discounts/discount.service.ts:118-123
if (
  coupon.max_redemptions !== null &&
  coupon.redeemed_count >= coupon.max_redemptions
) {
  throw new BadRequestException('Coupon fully redeemed');
}
```
but the atomic counter increment only happens later, at payment-success time, inside the Stripe webhook handler:
```ts
// apps/api/src/modules/billing/billing.service.ts:809-817 (afterPaid)
if (meta.couponId) {
  await this.discounts.redeem(meta.couponId);
  ...
}
```
`redeem()` does call an atomic Postgres RPC (`discounts.repository.impl.ts:70-76`, `redeem_coupon`), so the counter itself cannot over-count — but the *checkout-time capacity check* and the *charge* are two separate, unsynchronized steps. Multiple users (or one user opening multiple tabs) can each create a Stripe Checkout Session for the same coupon while `redeemed_count` is still below `max_redemptions`, and each can independently complete payment at the discounted price before any of their `redeem()` calls run. `redeem()` returning `false` for the redemptions past the cap is not checked or acted on (`billing.service.ts:810`, return value discarded) — the discounted charge has already succeeded in Stripe by that point.
Attack scenario: A coupon configured for `max_redemptions: 1` (e.g., a single-use promo). Two users start checkout with the code within the same window; both pass the capacity check (`redeemed_count` still 0), both complete payment at the discounted price. The coupon is redeemed twice against a cap of one. `discountedCents` is bounded by the margin-floor guardrail (`discount.service.ts:63-69`), so this is not a below-cost sale, but it is an uncontrolled excess of the intended promotional spend.
Business impact: Bounded revenue leakage proportional to discount size × over-redemption count; scales with how aggressively a coupon code is shared/scripted during a promotion window.
Evidence: `apps/api/src/modules/discounts/discount.service.ts:50-90, 118-123`; `apps/api/src/modules/billing/billing.service.ts:790-817`; `apps/api/src/modules/discounts/discounts.repository.impl.ts:70-76`.
Root cause: Capacity validation (at session creation) and capacity consumption (at payment success) are separated by an unbounded, user-controlled time window (however long the user takes to complete Stripe Checkout), with no server-side hold/reservation in between.
Remediation: Re-validate `redeemed_count < max_redemptions` inside `redeem_coupon`'s atomic RPC at webhook time (it already does the increment atomically — extend it to also refuse and report over-cap), and when `redeem()` returns `false`, either refuse to grant `afterPaid`'s discount-linked side effects or (better) reserve a redemption slot at checkout-session creation (increment then, roll back on Stripe session expiry/cancel) rather than at payment success.
Suggested regression test: Create a coupon with `max_redemptions: 1`; concurrently create two checkout sessions and complete both payment intents in the test harness; assert only one `discount_redemptions` row links to a payment, or that the second charge is refused/flagged.
Confidence: PLAUSIBLE (logic traced through the full code path; not verified against a live race under Stripe test mode)

---

### SEC-9006
Title: `PlanGuard` is mounted with no effect on four controllers (relies entirely on service-level `hasPaid` checks instead)
Severity: INFORMATIONAL
Affected component: `apps/api/src/modules/{forms,prefill,automation,doc-templates}/*.controller.ts`, `apps/api/src/modules/auth/plan.guard.ts`
Affected profile(s): N/A — developer-facing risk, not directly exploitable
Affected page/API: `forms`, `prefill`, `automation`, `document-templates` controllers
Description: `PlanGuard.canActivate()` is a no-op unless the specific route handler carries `@RequirePlan(...)`:
```ts
// apps/api/src/modules/auth/plan.guard.ts:29-34
async canActivate(context: ExecutionContext): Promise<boolean> {
  const requiredPlan = this.reflector.get<PlanTier>(REQUIRED_PLAN_KEY, context.getHandler());
  if (!requiredPlan) return true;
  ...
```
`forms.controller.ts`, `prefill.controller.ts`, `automation.controller.ts`, and `doc-templates.controller.ts` all apply `@UseGuards(JwtGuard, PlanGuard)` at the class level, but none of their handlers declare `@RequirePlan`. This is by design and documented in-line ("Generating/previewing the prefilled form is free; only downloading and portal auto-fill require the one-time form fee (enforced in the service)" — `prefill.controller.ts:40-41`; "Gated by the one-time form fee inside the service (HTTP 402 if unpaid)" — `automation.controller.ts:23`) — the real gate is `hasPaid()`/`requirePaid()` inside the service layer, which this review confirmed is correctly wired (see SEC-9002 for the underlying RLS gap in that same check). This finding is purely about maintainability risk: a future engineer adding a new plan-gated route to one of these four controllers could reasonably assume `PlanGuard` is already doing enforcement work there (it visibly guards the class) and skip adding the actual check, silently shipping an unprotected paid route.
Attack scenario: N/A today — no currently-unprotected route was found. This is a latent-risk/process finding, not an active vulnerability.
Business impact: None currently measurable; risk is to future changes.
Evidence: `apps/api/src/modules/auth/plan.guard.ts:29-34`; `apps/api/src/modules/prefill/prefill.controller.ts:35-49`; `apps/api/src/modules/automation/automation.controller.ts:18-38`; `apps/api/src/modules/forms/forms.controller.ts:22-56`; `apps/api/src/modules/doc-templates/doc-templates.controller.ts:21-46`.
Root cause: Two independent gating mechanisms (subscription-tier `PlanGuard` vs. one-time-fee `hasPaid()`) coexist in the same controllers with only code comments distinguishing which one is actually active.
Remediation: Either remove `PlanGuard` from these four controllers' class decorators (since it does nothing there) and rely purely on the documented service-level checks, or add a lint rule / architecture test asserting every controller importing `PlanGuard` has at least one `@RequirePlan` handler, so the no-op state is caught automatically instead of relying on a comment.
Suggested regression test: A static architecture test (e.g., a Jest test walking Nest's metadata) that fails if any controller applies `PlanGuard` without at least one handler carrying `@RequirePlan`.
Confidence: CONFIRMED

---

### SEC-9007
Title: Subscription webhook silently no-ops on an unrecognized Stripe price id, leaving local subscription status stale
Severity: LOW
Affected component: `apps/api/src/modules/subscriptions/subscriptions.module.ts`
Affected profile(s): Subscribers whose Stripe subscription price is changed outside the app's catalog
Affected page/API: `POST /billing/webhook` → `onSubscriptionChanged`
Description:
```ts
// apps/api/src/modules/subscriptions/subscriptions.module.ts:44-49
onSubscriptionChanged: async (ev) => {
  const s = ev.raw as any;
  const priceId = s.items?.data?.[0]?.price?.id as string | undefined;
  const mapped = catalog && priceId ? planFromPriceId(catalog, priceId) : null;
  if (!mapped) return; // unknown price (flag/catalog mismatch) — skip
```
If a subscription's current Stripe price does not resolve against the local `SUBSCRIPTION_PRICES` catalog (e.g., an admin changes the price directly in the Stripe Dashboard, or the env-configured catalog drifts from what's live in Stripe), the entire event — including a `status: 'canceled'` transition — is dropped. Because `EntitlementService.hasActiveSubscription()` (`entitlement.service.ts:38-50`) trusts the locally-stored `subscriptions.status`, a subscription that was genuinely canceled in Stripe but whose cancellation event carried an unrecognized price id would leave the local row (and therefore entitlement) stuck at its last-known status.
Attack scenario: Not directly attacker-triggered under normal product use (requires an operational catalog/price drift, e.g. during a pricing migration), but worth noting as an availability/correctness gap adjacent to entitlement state.
Business impact: Low-likelihood, ops-triggered stale entitlement (could cut either way — a user could remain entitled past a real cancellation, or a legitimate plan change could fail to register).
Evidence: `apps/api/src/modules/subscriptions/subscriptions.module.ts:37-49`; `apps/api/src/modules/entitlement/entitlement.service.ts:38-50`.
Root cause: The webhook handler's only action for an unmapped price is `return`, with no fallback path for lifecycle-only fields (e.g., `status`) that don't require price mapping.
Remediation: Separate "map the plan" from "update the status" — always upsert `status`/`cancel_at_period_end`/period bounds using the existing row's stored `plan` when the current Stripe price doesn't resolve, only skipping the plan re-mapping itself.
Suggested regression test: Simulate a `customer.subscription.updated` event with `status: 'canceled'` and a price id absent from `SUBSCRIPTION_PRICES`; assert the local subscription row's status still transitions to `canceled`.
Confidence: PLAUSIBLE

---

## Areas reviewed and found sound (no finding)

For completeness, given the emphasis on evidence over padding, these audit questions were investigated in depth and the code was found to correctly implement the control — recorded here so the absence of a corresponding SEC-90xx entry isn't mistaken for "not checked":

- **Webhook raw-body signature verification (Q1):** `main.ts:20-23` sets `rawBody: true`; `billing.controller.ts:175-200` passes `req.rawBody!` (untouched by JSON body-parsing) into `PaymentWebhookService.handle()`, which calls `stripe.webhooks.constructEvent(payload, signature, secret)` (`stripe-payment.provider.ts:248-253`). Platform and Connect endpoints use distinct config keys (`STRIPE_WEBHOOK_SECRET` / `STRIPE_CONNECT_WEBHOOK_SECRET`), modulo the fallback in SEC-9004.
- **Webhook replay/idempotency (Q2):** `PaymentWebhookService.handle()` inserts into `payment_events` keyed on `provider_event_id UNIQUE` before any domain dispatch, and returns early on a `23505` unique-violation (`payment-webhook.service.ts:65-90`, `ledger.service.ts:17-41`). `payment_events` additionally has DB-trigger-enforced immutability (`sp1_payment_foundation.sql:38-47`).
- **Client-controlled money (Q3), within the API layer:** every checkout path resolves price from a server-side constant/catalog (`PLAN_PRICES`, `PREFILL_PRICE`, `ADDON_PRICES`, `SERVICE_PRICES`, `SUBSCRIPTION_PRICES`) or a floor-gated `PricingService` quote; no endpoint accepts `amount`/`price` from the request body. (The RLS gaps in SEC-9001/9002 are a *database-layer* bypass of this discipline, not a flaw in the API-layer discipline itself.)
- **Checkout/subscription/customer ownership (Q5):** `PortalBodyDto` takes only a `returnUrl`; `customerId` is always resolved server-side from `users.stripe_customer_id`. Subscription mutations resolve the subscription via `repo.getActiveByUser(userId)`, never a client-supplied id. `automation.service.ts:294-309` (`getSession`) explicitly joins `applications.user_id` to authorize a client-supplied `sessionId`.
- **Payouts/Connect core engine (Q8):** destination account id is always read from `consultant_profiles.stripe_connect_account_id` (DB), never the request; `kyc_status`/`payouts_enabled` are written only from the verified webhook path inside `ConnectService`/`payouts.engine.ts` (the RLS gap that undermines this at the DB layer is SEC-9003); transfers use a per-order Stripe idempotency key (`payout_item_<service_order_id>`) and `consultant_payout_items.service_order_id` is DB-`UNIQUE`, so a retried/duplicated sweep cannot double-pay an order even under a race.
- **Ledger integrity (Q9):** `payment_events` is append-only via `BEFORE UPDATE`/`BEFORE DELETE` triggers calling `audit_no_mutate()`; RLS grants no `INSERT` policy to `authenticated`/`anon`, so only the service-role client (used exclusively by `LedgerService`) can write it.
- **Secret handling (Q10):** the sole `new Stripe(...)` construction site is `stripe.factory.ts:12-17`, server-side only, reading `STRIPE_SECRET_KEY` from config. No `NEXT_PUBLIC_*` or client-bundle reference to any Stripe secret/webhook-signing value was found in `apps/web`.
- **Refund/coupon/commission authorization (Q7, partial):** coupon creation, commission-rule CRUD, and refund issuance are all `RolesGuard`+`RequireRole('admin')`-gated with zod-validated positive amounts; refunds are clamped to ≤ the original payment. (The coupon *redemption-cap race* is SEC-9005.)
- **Consultant self-payout via decision workflow:** `PlanReviewPayoutService.creditExpertReview` (triggered by application-level approve/reject) is only reachable after `ConsultantApprovalService.assertAssigned()` confirms the caller is the application's active assignee, and is idempotent per application+consultant.

## Areas not exhaustively verified (flagged, not audited to the same depth)

- `partner` module webhook signing (`partner-webhook-signature.ts`) — reviewed at the file-existence level only; not traced end-to-end, since partner webhooks are outbound (VisaAI → partner), not part of the Stripe money-movement path.
- `scripts/stripe/**` — not found under this path in the current checkout; if such scripts exist elsewhere in CI, they were not located.
- Whether Postgres column-level `GRANT`/`REVOKE` exists anywhere *outside* the `supabase/migrations/` directory reviewed (e.g., applied out-of-band against the live database) could not be verified from source alone — SEC-9001/9002/9003 assume the live schema matches the migration history in this repo. Mark as UNVERIFIED against the actual production database state.

---

## Answers to the audit's specific questions

**Q4 — can the browser tell the backend "payment succeeded" and get entitlement without server-side verification?**
Through the NestJS API: **no.** There is no client-callable "confirm success" endpoint, no `session_id`/`payment_intent_id` accepted from the client that grants anything, and the web app's Stripe success-redirect (`billing/page.tsx:96`) just returns to `/` with no confirm call. Every legitimate entitlement/payment-status write goes through `BillingService`, invoked only from the signature-verified Stripe webhook.
Through the database the browser already talks to directly: **yes — trivially.** SEC-9001 and SEC-9002 show that a normal authenticated user, using the same Supabase client instance the web app already initializes in the browser, can write `applications.plan_tier` and fabricate a `payments` row directly, with no Stripe involvement at all. This is the practical, current answer to Q4 for this codebase.

**Money-flow row count:** 28
**Counts by severity:** CRITICAL: 2, HIGH: 1, MEDIUM: 1, LOW: 2, INFORMATIONAL: 1

**CRITICAL/HIGH one-line titles:**
- SEC-9001 (CRITICAL): `applications` RLS lets any user self-grant `plan_tier` — full paywall bypass, no Stripe involved.
- SEC-9002 (CRITICAL): `payments` RLS lets any user fabricate a completed payment, unlocking the $29 form-fee/portal-autofill gate for free.
- SEC-9003 (HIGH): `consultant_profiles` RLS lets a consultant self-approve marketplace listing and spoof KYC/payout eligibility.
