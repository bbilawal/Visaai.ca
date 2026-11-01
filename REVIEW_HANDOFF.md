# Review handoff — VisaAI audit program

Base: `93d2b10~1`. Head: `8b24b8f`. 7 commits, 58 files, +4775/−311.
Last updated after the third fix wave.

**Nothing here is approved.** Codex owns final judgement; this document is
evidence, not a claim of completion.

---

## 1. Checkpoints

| # | Commit | What |
|---|---|---|
| 1 | `93d2b10` | Admin role-change lockout, guest/user counting, registry all-clear |
| 2 | `d44daa2` | Response to REVIEW_FEEDBACK.md — both blockers |
| 3 | `d433bcc`, `d215a58` | Deploy script: ref-lock race, unpushed-commit fail-fast |
| 4 | `7746437` | Five silent failures reporting success |
| 5 | `4344cbb` | Double transfer-reversal, $0 tax statement, four false-empty screens |
| 6 | `8b24b8f` | Two leaking exception filters, Connect claim fail-closed |

**Deployed:** `d215a58` is live (API + web, verified 200 on both origins).
Commits 4–6 (`7746437`, `4344cbb`, `8b24b8f`) are **committed but NOT pushed and
NOT deployed**.

---

## 2. REVIEW_FEEDBACK.md — both blockers

**Blocker 1 (API build).** Fixed with concrete types (`AiUsageRow`, `AiTotals`,
`pageRows<AiUsageRow>`, `reduce<AiTotals>`), no `any`, no unsafe cast.
`pnpm --filter api build` exits 0.

**Blocker 2 (admin predicate vs the gate).** `JwtGuard.resolveAppRole` resolves
admin from three sources in order — signed `app_metadata.role` (which
short-circuits on any valid value), `ADMIN_EMAILS`, then a
`platform_admin`/`super_admin` grant in `user_roles`. `isPlatformAdmin` had only
the first two. It is now a faithful port; source 3 needs a DB read so no caller
may guess it, and `loadRbacAdminIds`/`hasRbacAdminGrantFor` supply it in every
admin decision path.

The short-circuit cuts both ways, which the original review did not call out:
the old OR-predicate counted someone on `ADMIN_EMAILS` whose metadata said
`'user'` as an admin while the gate refused them entry — a phantom padding
`adminCount` that could let the real last admin be removed.

Requested tests exist and assert real behaviour: `platform_admin`, `super_admin`,
`org_admin`/`support_agent` exclusion, and attempted demotion of the last such
admin.

---

## 3. Judge feedback on the working tree — both addressed

**(1) `logDbError` declared but never called.** Codex wired it into all five
error branches and added a `submit` regression test proving the client message
is generic while the raw error is logged. I added the same coverage for
`listMine`, which is the instance that matters: unlike triage/summary it carries
no role or permission gate, so any authenticated user reaches it.

**(2) `ensureAccount` returned the losing account.** Codex made it fail closed —
when the claim is lost AND the follow-up read finds no winner, it throws a
retryable `ServiceUnavailableException` rather than returning the account this
request just created, which would have minted an onboarding link for an orphaned
Stripe account. The exact race/no-winner test exists
(`connect.service.spec.ts:344`).

I did not overwrite either fix. I did fix a typecheck failure they left: 
`svc.x().catch(e => e)` types the result as a union of the resolved value and
the error, so `.getResponse()` did not compile. `nest build` excludes specs, so
the build passed while `tsc --noEmit -p tsconfig.json` failed. Replaced with a
`rejection()` helper that also asserts the call actually rejected.

---

## 4. Verification — commands and unabridged results

```
$ pnpm --filter api build
API_BUILD_EXIT=0

$ cd apps/api && npx tsc --noEmit -p tsconfig.json
(no output)

$ cd apps/api && pnpm test
Test Suites: 1 failed, 16 skipped, 443 passed, 444 of 460 total
Tests:       1 failed, 73 skipped, 3770 passed, 3844 total

$ cd apps/web && npx vitest run
Test Files  81 passed (81)
     Tests  474 passed (474)

$ cd apps/web && npx tsc --noEmit
(no output)

$ git diff --check
DIFF_CHECK_CLEAN
```

The single API failure is `test/intake-gateway-streaming.spec.ts` →
"delivers the guardrail fallback, not the text that streamed"
(`TypeError: Cannot read properties of undefined (reading 'payload')`). It is
**pre-existing** — it was red at `93d2b10` and lives in the intake/LangGraph
module, which this program does not touch.

Test count moved 3627 → 3770 (API) and 463 → 474 (web).
API eslint: 1392 errors vs **1403 at `93d2b10`** — net −11. Every file touched
in wave 3 was compared against its own pre-change baseline and added zero.

---

## 5. Findings fixed, with the evidence

Each was verified against source before acting, and each fix has a test proved
to fail against the old code.

| ID | Sev | Where | Defect |
|---|---|---|---|
| ADMIN-003 | critical | `admin.service.ts` | `POST /admin/users/:id/role` had no last-admin or self-demotion guard; two clicks in the admin table could orphan the platform, unrecoverably (a valid `'user'` shadows the ADMIN_EMAILS fallback) |
| ADMIN-004 | critical | `iam.repository.impl.ts` | A second admin count, disagreeing with `adminCount()`. No `users.status` filter, and the lifecycle path never touches `user_roles` — so a soft-deleted admin's grant row survived and kept counting. One ghost + one live RBAC admin ⇒ revoke guard saw 2, allowed it, left zero admins who could sign in |
| PRIV-003 | critical | `privacy.service.ts` | `POST /me/privacy/delete` is self-service and hard-deletes the auth identity. The only privilege-removal path with no last-admin check, and the only irreversible one |
| REGOPS-002 | critical | `registry-ops.service.ts` | `freshness_sla` is a Postgres `interval` serialized `'30 days'`. `Number('30 days')` is NaN, `!NaN` is true ⇒ the stale-source count was structurally always 0, for the life of the feature. **My own test hid it** by mocking a bare number the DB never returns |
| DOC-001 | critical | `sync-profile.ts` | A failed profile read fell back to `{}`, so the upsert replaced `profile_json` wholesale — erasing every intake answer. Silent: with an empty profile nothing is `skipped`, so the log read "left 0 already answered" |
| REF-001 | critical | `refund.service.ts` | Stripe fires BOTH `charge.refunded` and `refund.created`; the provider maps both to one domain type with the same object id. Two event ids ⇒ both clear the per-event-id ledger gate ⇒ `reverseTransfer` ran twice on one transfer |
| TAX-001 | critical | `payouts.repository.impl.ts` | `sumPaidForYear` dropped `error` ⇒ a transient failure produced a tax statement reporting **$0 income** for a year the consultant was paid. No test had ever called it — every tax test mocked it away |
| PROF-001 | critical | `profile/page.tsx` | A failed `users` read became `initialFullName = ''`; Save writes `full_name` unconditionally ⇒ a user changing only their nationality erased their own name |
| CONN-001 | critical | `connect.service.ts` | Concurrent onboarding minted two real Stripe Connect accounts; the retry did not converge |
| BILL-001 | high | `billing.service.ts` | All three `payments` inserts dropped `error` ⇒ plan granted, customer notified, no payments row |
| PAY-001 | high | `payouts.repository.impl.ts` | Sweep read both tables unbounded. Orders: tail never paid. Items: that is the *exclusion* set, so paid orders re-enter the sweep — Stripe's key covers ~24h, past which a second transfer is really created |
| KPI-001 | high | `supabase-kpi-rollup.reader.ts` | Every read unbounded then aggregated in JS: MRR, active subscribers, cohorts, take rate, funnel, churn |
| PRIV-004 | high | `privacy.service.ts` | A failed export category returned `[]` and the request was still recorded `completed` — GDPR Art. 15/20 incomplete disclosure *plus* a false compliance record |
| ERR-001 | high | 2 exception filters | `else if (err instanceof Error) { message = err.message }` at 500 defeated the platform's documented 5xx genericisation |
| ERR-002 | high | `feedback.service.ts` | Raw Supabase errors into `BadRequestException` (4xx passes through verbatim). `listMine` has no role gate |
| PRICE-001 | high | `pricing/page.tsx` | ISR's "serve the last good render" only engages when the render *throws*; catching and returning `[]` cached an empty pricing page as canonical |
| DASH-002 | med | `admin-dashboard.service.ts` | `ai_usage_events`/`payments` truncated at the 1000-row cap |
| REG-002/003 | med | registry-ops, dashboard | `countriesPublishable` counted `preview`; Consultants tile counted `draft`/`suspended` |
| DEPLOY-003 | med | `scripts/deploy-web.sh` | Ref-lock race with the VPS poller killed deploys; `--api` tested `$1` in the restart branch, so an API build could be produced and never loaded |
| CONFIG-005 | med | `package.json`, `.env.example` | `start:prod` did not set `NODE_ENV`, so *every* production boot refusal was disarmed; a real personal address was the `ADMIN_EMAILS` default; `SUPABASE_ANON_KEY` named with a `NEXT_PUBLIC_` prefix the schema rejects; non-numeric DLQ threshold made `dead > NaN` false, disabling the alarm |

**Cross-cutting cause.** Two shapes account for most of the above: a supabase-js
`{ error }` nobody read, and a PostgREST select nobody bounded. Test fakes were
updated to enforce the real 1000-row cap, because a fake that returns everything
lets the truncation bug pass the very tests written to catch it.

---

## 6. Rejected, with reasons

- **"Payout sweep pays twice immediately."** Imprecise. A per-order Stripe
  idempotency key (`payout_item_<order id>`) dedupes the transfer. The real
  mechanism is that Stripe retains those keys ~24h while the sweep runs daily —
  so the double payment is delayed, not immediate. Fixed on the corrected basis.
- **"The 3 failing web tests are a timing artifact of an `async` wrapper."**
  Wrong. I applied it; all three still failed. The actual trigger was a
  *persistent* `mockImplementation(() => Promise.reject(...))`, which vitest
  reports as an unhandled rejection at teardown even though the component's
  catch handled the single call. `mockImplementationOnce` fixes it. Worth
  recording: this is the one agent finding I would have shipped a wrong fix for.
- **"Parallelise the 12 sequential dashboard round-trips."** Accurate
  measurement, rejected as a change here — it rewrites a health-reporting path
  whose `dbReachable` semantics depend on the current sequencing. Belongs in a
  performance change with before/after numbers.
- **36 further unbounded-read / swallowed-error sites across billing, payouts,
  privacy and document pipelines.** Real-looking, but reported rather than
  verified by me, and far outside any of these commits' blast radius. Listed in
  §7 as tracked work rather than folded in.

---

## 7. Remaining risks — open, with next step

**Operator action, cannot be fixed in-repo:**

1. **Committed secrets, still unrotated.** `docs/security/_wave1/secrets-findings.md`
   documents an OpenAI key and an Upstash Redis token that the audit states are
   byte-identical to values still live in `apps/api/.env`. `git log --since=2026-08-16`
   shows zero commits to those files since. **Next step: rotate at the provider
   consoles.** Nothing in this repo can verify or perform it.
2. **`NODE_ENV` on the VPS.** `start:prod` now sets it, but the live pm2 process
   inherits whatever the untracked `apps/api/.env` holds. **Next step:
   `pm2 env <id> | grep NODE_ENV` on the box.** Until confirmed, treat every
   production boot guard (data residency, OCR region, mock warehouses) as
   possibly disarmed.
3. **API binds all interfaces.** `main.ts` calls `app.listen(port)` with no host,
   so port 4000 is reachable bypassing nginx and TLS — the documented DEPLOY-002.
   **Not changed here**: I cannot verify the blast radius of a loopback bind
   without prod access, and getting it wrong takes the API offline. **Next step:
   confirm nothing but nginx connects to 4000, then `app.listen(port, '127.0.0.1')`.**

**Audits that did not finish (session rate limit, HTTP 429):**

4. **Authorization / RLS / tenancy — never ran.** The highest-value uncompleted
   domain. The checkable rule is CLAUDE.md's: request paths must use
   `SupabaseService.forUser`; `admin` (service-role) is for background/webhook
   paths only. Service-role bypasses RLS entirely, so each request-path use is a
   candidate IDOR. **Next step: enumerate `this.supabase.admin` uses reachable
   from a controller/gateway route and check each for a compensating ownership
   filter.**
5. **Guidance compliance / dead code — never ran.** Notably whether hardcoded
   country logic exists outside `apps/api/src/strategies/`, which CLAUDE.md says
   is the one place it may live.

**Known-real, not yet fixed (evidence recorded, fix not local):**

6. **The webhook idempotency gate closes before the work succeeds.**
   `PaymentWebhookService.handle` records the provider event id *then* dispatches,
   so a handler that throws gets its Stripe retry discarded as a duplicate — no
   entitlement AND no record. This is why BILL-001 logs rather than throws. Fix
   is a status column (`received` → `processed`) on the ledger, which touches
   every webhook type; too broad for this program.
7. **Intake checkpoint lost update.** `sendMessage` does load → LLM invoke →
   whole-blob save with no per-thread lock, while the *start* path already has
   `acquireStartLock` for exactly this. Two concurrent/replayed messages on one
   `applicationId` both load the same checkpoint and the last save wins.
   **Next step: reuse the existing lock primitive around load→invoke→save.**
8. **Duplicate `generated_documents` rows.** `(application_id, doc_type)` has no
   unique constraint, and both the outer `autoGenerateIfReady` check and the
   inner `storePrefill` check are check-then-act. Downstream reads use
   `.maybeSingle()`, which *errors* on two rows — so prefill breaks for that
   application until someone deletes one by hand. **Next step: add the unique
   constraint + `upsert(onConflict)`.** Needs a migration.
9. **Coupon over-redemption.** `max_redemptions` is validated at checkout-session
   creation but only incremented on payment, and the atomic RPC's `false` return
   is discarded — so N concurrent users all get the discounted session and all
   pay. **Next step: reserve at session creation, or raise a reconciliation
   exception when the RPC declines after a real charge.**
10. **36 further unbounded-read / swallowed-error sites.** Top by blast radius:
    `reconciliation.service.ts` (false "missing in ledger"),
    `load-vri-data.ts` (a confident readiness score computed from empty inputs),
    `automation.service.ts` (portal submission with zero documents attached),
    `financial-ops.repository.impl.ts` (dunning counter resets instead of
    continuing).

**Type-level landmines** (no live crash; the next consumer is the risk):
`User.email` typed non-null against a column deliberately nullable for guests;
`AuditEvent.application_id` non-null against a column nulled by GDPR erasure;
`Application` missing `visa_type_id`, `needs_consultant_escalation`.


---

## 9. Authorization / RLS audit (§7.4) — completed by the primary session

The agent for this domain died on the session rate limit, so I ran a bounded
version directly. Mostly negative findings, which are worth recording as
evidence rather than silence.

**Request-path convention holds.** CLAUDE.md requires request paths to use
`SupabaseService.forUser` and reserves service-role for background/webhook/system
paths. Every per-application controller sampled enforces ownership one of two
correct ways — an RLS-scoped `@SupabaseUserClient()` (progress, narrative, vri,
prefill, outcomes, forms, doc-templates, automation) or a class-level
`ApplicationAccessGuard` (preflight). Messaging routes on `JwtGuard` alone but
its service documents RLS as the isolation boundary and uses service-role
narrowly and deliberately (participant self-heal), with the reasoning written
down. **No IDOR found in the sampled request paths.**

**Schema-level RLS is sound.**
- 158 tables created; **0 have user-owned columns (`user_id` / `consultant_id` /
  `owner_user_id`) without RLS enabled.**
- 39 tables have RLS enabled with no policy — deny-all to clients. All are
  service-role-only (analytics rollups, partner tokens, notification outbox,
  feature flags, audit logs, form/document template catalogs). Cross-checked: 
  **`apps/web` reads none of them directly**, so the deny-all is intentional,
  not a silently broken feature.
- Every `using (true)` policy is `for select` on genuinely public reference data
  (RBAC catalog, pricing tiers, visa registry, consultant marketplace listings)
   — with one exception, below.

**One finding: SEC-4092b — `pricing_quotes` grants a read nothing uses.**
`20260816120000` narrowed this table from anon to `authenticated` but left the
body `using (true)`; its own comment called that "still broad". The table carries
`gross_margin`, `total_cogs` and `floor_price` — what the platform's costs and
margins are on every corridor — readable by any signed-up user. It is not a
cross-tenant leak (the table is keyed on visa_type/country_code, not per user),
but it is surplus exposure: `apps/web` never reads it (0 references) and all
three `apps/api` reads go through `supabase.admin`, which bypasses RLS anyway.

Fix written as `supabase/migrations/20260906120000_pricing_quotes_drop_surplus_read.sql`
(+ rollback). It drops the policy, leaving the table service-role-only — which
is what every consumer already assumes. **Not applied**: migrations against prod
are an operator step and the classifier blocks agent prod access.

**Not covered by this pass** (a full agent-run would still add value): partner
and consultant cross-tenant boundaries, the `@AllowAnonymous` route set, and
per-route guard coverage across all 69 controllers.

---

## 8. Exact next step

1. Push and deploy waves 4–6 — they are committed, unpushed, undeployed:
   `cd ~/Desktop/VisaAI/VisaAI && git push origin main`
   then `cd ~/Desktop/VisaAI/VisaAI && scripts/deploy-web.sh --api`
   (two separate short lines — the combined 81-char form wraps in this terminal
   and detaches `--api`, which silently produced three web-only deploys).
2. Operator: apply `20260906120000_pricing_quotes_drop_surplus_read.sql`
   (§9) — written and evidenced, not applied.
3. Operator: rotate the credentials in §7.1 and check `NODE_ENV` in §7.2.

---

## 10. Guidance-claim correction — pending commit

**Finding.** The English readiness UI had been corrected to describe its score
as requirements fit, but the VRI suggestion prompt still asked the model for an
`approval likelihood` and every non-English locale still said optional evidence
improved approval chances. That contradicted the rendered disclaimer and
VisaAI's documented outcome-neutral policy.

**Repair.** `suggest-visa-categories.ts` now instructs the model to rank
published-requirements fit, explicitly says it is neither legal advice nor an
approval probability, and keeps the legacy wire-field name only for API
compatibility. The 14 localized `strengthenHint` pairs now state only that the
evidence is optional/not required. `claims.test.ts` has a multilingual
regression assertion over both hints in every locale; the VRI prompt has its
own regression test.

**Verification run locally (Node 24; release must repeat under supported Node
20):**

```
pnpm --filter api test -- --runInBand test/vri-suggest-language.spec.ts
# 1 suite, 3 tests passed
cd apps/web && pnpm exec vitest run messages/claims.test.ts
# 1 file, 46 tests passed
pnpm --filter api build
# exit 0
git diff --check
# clean
```

This narrows a product claim; it does not establish that the product is lawful
in every jurisdiction. A qualified lawyer/regulated immigration professional
must still review country-specific product behaviour, partnerships, and terms.

---

## 11. Payment webhook retry safety — pending commit

**Finding.** `PaymentWebhookService` previously inserted a unique ledger row
before dispatch. If a handler threw, the provider retry found that row and was
acknowledged as a duplicate, permanently dropping the side effect.

**Repair.** `20260906210000_payment_webhook_processing_state.sql` retains the
immutable `payment_events` receipt and adds a separate processing state machine.
The claim RPC writes the receipt and processing lease in one transaction;
handlers mark the event `processed` only after success and mark it `failed` on
error. Failed events are immediately reclaimable; crashed processing leases are
reclaimable after ten minutes. A concurrent delivery receives a retryable 503,
not a false success. All three SECURITY DEFINER RPCs are service-role-only.
Existing ledger rows are seeded as processed to avoid replaying previously
acknowledged financial effects.

**Verification run locally (Node 24; release must repeat under Node 20):**

```
pnpm --filter api test -- --runInBand \
  src/modules/ledger/ledger.service.spec.ts \
  src/modules/shared/payments/payment-webhook.service.spec.ts
# 2 suites, 16 tests passed
pnpm --filter api build
# exit 0
```

The migration is not applied and this change is not deployed. A production
operator must apply it before the new API code is deployed; deploy API and
migration together so the required RPCs exist before webhooks reach the new
handler.

---

## 12. Generated-document uniqueness — pending commit

**Finding.** `generated_documents` permits multiple rows for one
`(application_id, doc_type)`, although prefill generation and consumers read it
as a singleton with `maybeSingle()`. Concurrent generators could therefore make
the form unreadable until manual repair.

**Repair.** `20260906220000_generated_documents_unique_type.sql` keeps one
legacy row per pair (a user-approved row wins; otherwise the newest row wins),
removes the rest, then adds the database unique constraint. The prefill graph
now uses a single `upsert(..., { onConflict: 'application_id,doc_type' })`, not
a check-then-update/insert race.

**Verification:**

```
pnpm --filter api test -- --runInBand \
  src/modules/prefill/graphs/nodes/store-prefill.spec.ts
# 1 suite, 2 tests passed
pnpm --filter api build
# exit 0
git diff --check
# clean
```

The migration is unapplied and the commit is not deployed. It must be applied
before this API code, otherwise the upsert conflict target does not exist.

---

## 13. Intake message serialization — pending commit

`sendMessage` previously loaded a checkpoint, invoked the graph, then replaced
the checkpoint with no per-application serialization. Two simultaneous turns
could both start from the same state and lose whichever completed first.

`CheckpointService` now provides a token-owned Redis message lease. The intake
service obtains it after authorization and before reading a checkpoint; a
concurrent turn gets a retryable 409 rather than loading/stomping state. Release
uses Redis Lua compare-and-delete, so an expired worker cannot delete a newer
holder's lock. TTL remains the crash recovery path.

Verification: `intake.session-recovery.spec.ts` passes 3 tests (including the
concurrent lease case), API build exits 0, and `git diff --check` is clean.
This is local Node 24 evidence; release must rerun under Node 20.

---

## 14. Intake guardrail delivery — pending commit

The former full-suite failure in `intake-gateway-streaming.spec.ts` was real:
the gateway logged `output.violations.join(...)` before emitting a guardrail
fallback. A malformed/degraded guardrail result with no `violations` array
therefore threw during logging and delivered neither the safe fallback nor the
authoritative closing message. Logging now tolerates absent diagnostic metadata
and labels it `unknown`; fallback delivery remains mandatory.

Verification: `test/intake-gateway-streaming.spec.ts` passes all 9 tests, API
build exits 0, and `git diff --check` is clean.

---

## 15. Consolidated local release evidence — 2026-09-06

The final local verification after all commits in this handoff is green when
run outside the restricted test sandbox (the HTTP webhook fixture requires a
localhost listener):

```
pnpm --filter api test -- --runInBand
# 445 suites passed, 16 skipped; 3777 tests passed, 73 skipped
cd apps/web && pnpm exec vitest run
# 81 files passed; 489 tests passed
pnpm --filter api build
# exit 0
git diff --check && git status --short
# clean
```

All local checks above used Node 24. The package requires Node 20, so this is
not release certification until the same API build and test commands run under
Node 20 in CI/release infrastructure.

### Unresolved release gates (not executable from this repository)

1. Review and apply the two unapplied migrations in this audit before deploying
   their API consumers: `20260906210000_payment_webhook_processing_state.sql`
   and `20260906220000_generated_documents_unique_type.sql`. The existing RLS
   hardening migration `20260906120000_pricing_quotes_drop_surplus_read.sql`
   also remains unapplied.
2. Rotate the live OpenAI and Upstash credentials identified in the secret
   audit; repository code cannot rotate or verify provider-side secrets.
3. Verify VPS `NODE_ENV` and whether anything besides nginx reaches port 4000
   before changing the API bind address.
4. Implement the coupon reservation/expiry/settlement lifecycle before relying
   on `max_redemptions` for a limited promotion.
5. Obtain qualified, jurisdiction-specific legal review of product behaviour,
   partnerships, terms and customer disclosures. No software audit can make a
   universal no-liability or all-jurisdictions acceptance claim.
